"""금융위원회 API 클라이언트·기업 재무 수집·FRED 재동기화 테스트 — 네트워크 없이 응답을 흉내 낸다.

실행: python -m unittest discover -s tests -v
"""

import datetime
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import fsc_api  # noqa: E402
import collect_financials as cf  # noqa: E402
import resync_fred  # noqa: E402

KEY = "abcDEF123+/xyz=="  # 형식만 흉내 낸 가짜 키 (Decoding 형태)
ENCODED_KEY = "abcDEF123%2B%2Fxyz%3D%3D"

# 2026-10-10 실제 응답(fsc_check.py 주석)에서 옮긴 삼성전자 2025 별도 요약 행
SUMM_ROW = {
    "basDt": "20251231", "crno": "1301110006246", "bizYear": "2025", "fnclDcd": "120",
    "fnclDcdNm": "별도요약재무제표", "enpSaleAmt": "238043009000000", "enpBzopPft": "23603619000000",
    "iclsPalClcAmt": "33436082000000", "enpCrtmNpf": "33686601000000", "enpTastAmt": "358902051000000",
    "enpTdbtAmt": "104571968000000", "enpTcptAmt": "254330083000000", "enpCptlAmt": "897514000000",
    "fnclDebtRto": "41.1166334578", "curCd": "KRW",
}


class FakeResponse:
    def __init__(self, status=200, payload=None, text=None):
        self.status_code = status
        self._payload = payload
        self.text = text if text is not None else json.dumps(payload)

    def json(self):
        return self._payload


class FakeSession:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, dict(params or {})))
        return self.responses.pop(0)


def ok(items, total=None):
    body = {"numOfRows": 100, "pageNo": 1, "totalCount": len(items) if total is None else total,
            "items": {"item": items} if items else ""}
    return FakeResponse(200, {"response": {"header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE."}, "body": body}})


class Quiet(unittest.TestCase):
    def setUp(self):
        for p in (mock.patch.object(fsc_api.time, "sleep"), mock.patch.object(fsc_api, "MIN_INTERVAL", 0)):
            p.start()
            self.addCleanup(p.stop)
        self.err, self.out = io.StringIO(), io.StringIO()
        for ctx in (redirect_stderr(self.err), redirect_stdout(self.out)):
            ctx.__enter__()
            self.addCleanup(ctx.__exit__, None, None, None)


class NumberTest(unittest.TestCase):
    def test_kind_and_format(self):
        self.assertEqual(fsc_api.kind_of("124-81-00998"), "bzno")
        self.assertEqual(fsc_api.kind_of("130111-0006246"), "crno")
        self.assertIsNone(fsc_api.kind_of("12345"))
        self.assertEqual(fsc_api.fmt_bzno("1248100998"), "124-81-00998")
        self.assertEqual(fsc_api.fmt_crno("1301110006246"), "130111-0006246")


class CallTest(Quiet):
    def test_encoded_key_is_decoded_once(self):
        with mock.patch.dict(os.environ, {"DATA_GO_KR_KEY": ENCODED_KEY}):
            self.assertEqual(fsc_api.service_key(), KEY)
        with mock.patch.dict(os.environ, {"DATA_GO_KR_KEY": f'"{KEY}"'}):
            self.assertEqual(fsc_api.service_key(), KEY)

    def test_items_list_single_and_empty(self):
        s = FakeSession(ok([SUMM_ROW, SUMM_ROW]))
        items, total = fsc_api.call("S", "op", {"crno": "1"}, key=KEY, session=s)
        self.assertEqual((len(items), total), (2, 2))
        self.assertEqual(s.calls[0][1]["resultType"], "json")
        self.assertEqual(s.calls[0][1]["serviceKey"], KEY)
        single = FakeResponse(200, {"response": {"header": {"resultCode": "00"},
                                                  "body": {"totalCount": 1, "items": {"item": SUMM_ROW}}}})
        items, _ = fsc_api.call("S", "op", {}, key=KEY, session=FakeSession(single))
        self.assertEqual(items, [SUMM_ROW])
        items, total = fsc_api.call("S", "op", {}, key=KEY, session=FakeSession(ok([])))
        self.assertEqual((items, total), ([], 0))

    def test_xml_auth_error(self):
        xml = ("<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg>"
               "<returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg>"
               "<returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>")
        with self.assertRaises(fsc_api.FscError) as ctx:
            fsc_api.call("S", "op", {}, key=KEY, session=FakeSession(FakeResponse(200, None, xml)))
        self.assertIn("SERVICE_KEY_IS_NOT_REGISTERED_ERROR", str(ctx.exception))

    def test_json_auth_error_on_403(self):
        payload = {"OpenAPI_ServiceResponse": {"cmmMsgHeader": {"errMsg": "SERVICE_KEY_IS_NOT_REGISTERED_ERROR"}}}
        with self.assertRaises(fsc_api.FscError) as ctx:
            fsc_api.call("S", "op", {}, key=KEY, session=FakeSession(FakeResponse(403, payload)))
        self.assertIn("HTTP 403", str(ctx.exception))
        self.assertNotIn(KEY, str(ctx.exception))

    def test_result_code_error(self):
        bad = FakeResponse(200, {"response": {"header": {"resultCode": "10", "resultMsg": "INVALID_REQUEST_PARAMETER_ERROR"}}})
        with self.assertRaises(fsc_api.FscError):
            fsc_api.call("S", "op", {}, key=KEY, session=FakeSession(bad))

    def test_call_all_pages(self):
        s = FakeSession(ok([{"a": 1}] * 2, total=3), ok([{"a": 2}], total=3))
        self.assertEqual(len(fsc_api.call_all("S", "op", {}, num_rows=2, key=KEY, session=s)), 3)


class ResolveTest(Quiet):
    def test_crno_without_outline_access(self):
        with mock.patch.object(fsc_api, "call", side_effect=fsc_api.FscError("SERVICE_KEY_IS_NOT_REGISTERED_ERROR")):
            info = cf.resolve("130111-0006246", None)
        self.assertEqual(info, {"crno": "1301110006246", "bzno": None, "name": None})

    def test_crno_with_outline(self):
        item = {"crno": "1301110006246", "bzno": "1248100998", "corpNm": "삼성전자(주)"}
        with mock.patch.object(fsc_api, "call", return_value=([item], 1)):
            info = cf.resolve("1301110006246")
        self.assertEqual(info, {"crno": "1301110006246", "bzno": "1248100998", "name": "삼성전자(주)"})

    def test_bzno_direct_filter(self):
        item = {"crno": "1301110006246", "bzno": "124-81-00998", "corpNm": "삼성전자(주)"}
        with mock.patch.object(fsc_api, "call", return_value=([item], 1)):
            info = cf.resolve("1248100998")
        self.assertEqual(info["crno"], "1301110006246")
        self.assertEqual(info["name"], "삼성전자(주)")

    def test_bzno_filter_ignored_falls_back_to_name(self):
        unrelated = [{"crno": "1", "bzno": "9999999999", "corpNm": "다른회사"}]
        hit = {"crno": "1301110006246", "bzno": "1248100998", "corpNm": "삼성전자(주)"}

        def fake(service, op, params, **kw):
            if "bzno" in params:
                return unrelated, 1_200_000  # 조건 무시 → 전체 목록
            return [{"crno": "2", "bzno": "1111111111", "corpNm": "삼성전자서비스"}, hit], 2

        with mock.patch.object(fsc_api, "call", side_effect=fake):
            info = cf.resolve("124-81-00998", "삼성전자")
        self.assertEqual(info["crno"], "1301110006246")

    def test_bzno_without_name_explains(self):
        with mock.patch.object(fsc_api, "call", return_value=([], 1_200_000)):
            with self.assertRaises(fsc_api.FscError) as ctx:
                cf.resolve("1248100998")
        self.assertIn("회사명", str(ctx.exception))

    def test_bzno_without_outline_access_explains(self):
        with mock.patch.object(fsc_api, "call", side_effect=fsc_api.FscError("SERVICE_KEY_IS_NOT_REGISTERED_ERROR")):
            with self.assertRaises(fsc_api.FscError) as ctx:
                cf.resolve("1248100998", "삼성전자")
        self.assertIn("기업기본정보", str(ctx.exception))

    def test_bad_number(self):
        with self.assertRaises(fsc_api.FscError):
            cf.resolve("12-34")


class CollectTest(Quiet):
    def test_summary_normalization(self):
        with mock.patch.object(fsc_api, "call_all", return_value=[SUMM_ROW, {**SUMM_ROW, "fnclDcd": "110", "fnclDcdNm": "연결요약재무제표"}]):
            rows = cf.fetch_summary("1301110006246")
        self.assertEqual([r["basis"] for r in rows], ["별도", "연결"])
        r = rows[0]
        self.assertEqual(r["revenue"], 238043009000000)
        self.assertEqual(r["net_income"], 33686601000000)
        self.assertEqual(r["debt_ratio"], 41.1166)
        self.assertEqual(r["year"], "2025")

    def test_accounts_basis(self):
        item = {"fnclDcd": "FS_ifrs-full_ConsolidatedMember", "acitId": "ifrs-full_Assets", "acitNm": "자산총계",
                "crtmAcitAmt": "514531948000000", "pvtrAcitAmt": "455905980000000", "bpvtrAcitAmt": ""}
        with mock.patch.object(fsc_api, "call_all", return_value=[item]):
            rows = cf.fetch_accounts("getBs_V2", "1", "2024")
        self.assertEqual(rows[0]["basis"], "연결")
        self.assertIsNone(rows[0]["before_previous"])

    def test_main_writes_files_and_keeps_previous_on_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = os.path.join(tmp, "companies.json")
            out = os.path.join(tmp, "financials")
            os.makedirs(out)
            with open(cfg, "w", encoding="utf-8") as f:
                json.dump([{"crno": "1301110006246", "bzno": "1248100998", "name": "삼성전자"},
                           {"crno": "1111111111111", "bzno": None, "name": "옛회사"}], f)
            with open(os.path.join(out, "index.json"), "w", encoding="utf-8") as f:
                json.dump({"companies": [{"crno": "1111111111111", "name": "옛회사", "years": ["2020", "2022"]}]}, f)

            def fake_call_all(service, op, params, **kw):
                if params.get("crno") == "1111111111111":
                    raise fsc_api.FscError("HTTP 500")
                if op == "getSummFinaStat_V2":
                    return [SUMM_ROW, {**SUMM_ROW, "bizYear": "2024"}]
                return [{"fnclDcd": "PL_ifrs-full_SeparateMember", "acitNm": "매출액", "crtmAcitAmt": "1"}]

            with mock.patch.object(cf, "CONFIG_PATH", cfg), mock.patch.object(cf, "OUT_DIR", out), \
                    mock.patch.object(fsc_api, "call_all", side_effect=fake_call_all), \
                    mock.patch.dict(os.environ, {"DATA_GO_KR_KEY": KEY}), \
                    mock.patch.object(sys, "argv", ["collect_financials.py"]):
                code = cf.main()
            with open(os.path.join(out, "index.json"), encoding="utf-8") as f:
                index = json.load(f)
            with open(os.path.join(out, "1301110006246.json"), encoding="utf-8") as f:
                data = json.load(f)
        self.assertEqual(code, 1)  # 한 곳 실패
        self.assertEqual({c["crno"] for c in index["companies"]}, {"1301110006246", "1111111111111"})
        self.assertEqual(data["balance_sheet"]["year"], "2025")
        self.assertEqual(len(data["summary"]), 2)
        self.assertIn("::warning", self.out.getvalue())


class ResyncTest(unittest.TestCase):
    def test_compare_daily_and_step(self):
        D = datetime.date
        rows = [
            {"date": "2024-12-24", "vix": "15.0", "fedrate": "4.5"},
            {"date": "2024-12-25", "vix": "15.0", "fedrate": "4.5"},  # 휴장일 — FRED 관측 없음
            {"date": "2024-12-26", "vix": "", "fedrate": "4.5"},
            {"date": "2024-12-27", "vix": "16.0", "fedrate": "4.5"},
        ]
        fred = {D(2024, 12, 24): 15.001, D(2024, 12, 26): 14.5, D(2024, 12, 27): 16.2}
        changes, stats = resync_fred.compare(rows, "vix", fred)
        self.assertEqual(stats, {"same": 1, "differ": 1, "filled": 1, "cleared": 1})
        self.assertIn(("2024-12-25", "15.0", ""), changes)
        # 계단형은 FRED 관측이 없는 날 값을 지우지 않는다
        changes, stats = resync_fred.compare(rows, "fedrate", {D(2024, 12, 24): 4.5})
        self.assertEqual(stats["cleared"], 0)


if __name__ == "__main__":
    unittest.main()
