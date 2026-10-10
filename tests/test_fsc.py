"""금융위원회 API 클라이언트(fsc_check용)·FRED 재동기화 테스트 — 네트워크 없이 응답을 흉내 낸다.

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
