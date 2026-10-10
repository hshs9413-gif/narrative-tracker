"""FRED API 경로 테스트 — 네트워크 없이 응답을 흉내 낸다.

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

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import fred_api  # noqa: E402
import fred_catalog  # noqa: E402
import backfill_market_data as bmd  # noqa: E402

KEY = "abcdefghijklmnopqrstuvwxyz012345"  # 형식만 맞춘 가짜 키
D = datetime.date


class FakeResponse:
    def __init__(self, status, payload=None, headers=None, text=None):
        self.status_code = status
        self._payload = payload
        self.headers = headers or {}
        self.text = text if text is not None else json.dumps(payload or {})

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


class FakeSession:
    """응답을 순서대로 돌려주고, 받은 요청을 기록한다."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, dict(params or {})))
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def obs_payload(*pairs):
    return {"count": len(pairs), "observations": [{"date": d, "value": v} for d, v in pairs]}


class QuietTestCase(unittest.TestCase):
    def setUp(self):
        # 재시도 대기·호출 간격은 테스트에서 건너뛴다
        patches = [mock.patch.object(fred_api.time, "sleep"), mock.patch.object(fred_api, "MIN_INTERVAL", 0)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.err = io.StringIO()
        self.out = io.StringIO()
        for ctx in (redirect_stderr(self.err), redirect_stdout(self.out)):
            ctx.__enter__()
            self.addCleanup(ctx.__exit__, None, None, None)


class ApiKeyTest(QuietTestCase):
    def test_missing_key(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(fred_api.api_key())

    def test_malformed_key_is_ignored(self):
        with mock.patch.dict(os.environ, {"FRED_API_KEY": "NOT-A-KEY"}):
            self.assertIsNone(fred_api.api_key())

    def test_valid_key(self):
        with mock.patch.dict(os.environ, {"FRED_API_KEY": f" {KEY}\n"}):
            self.assertEqual(fred_api.api_key(), KEY)

    def test_quotes_around_key_are_stripped(self):
        with mock.patch.dict(os.environ, {"FRED_API_KEY": f'"{KEY}"'}):
            self.assertEqual(fred_api.key_status(), "ok")
            self.assertEqual(fred_api.api_key(), KEY)

    def test_key_status(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(fred_api.key_status(), "missing")
        with mock.patch.dict(os.environ, {"FRED_API_KEY": ""}):
            self.assertEqual(fred_api.key_status(), "missing")
        with mock.patch.dict(os.environ, {"FRED_API_KEY": KEY.upper()}):
            self.assertEqual(fred_api.key_status(), "malformed")
        with mock.patch.dict(os.environ, {"FRED_API_KEY": KEY[:-1]}):
            self.assertEqual(fred_api.key_status(), "malformed")


class ObservationsTest(QuietTestCase):
    def test_parses_values_and_drops_missing(self):
        session = FakeSession(FakeResponse(200, obs_payload(
            ("2026-10-01", "4.12"), ("2026-10-02", "."), ("2026-10-05", "4.20"),
        )))
        s = fred_api.observations("DGS10", D(2026, 10, 1), D(2026, 10, 9), key=KEY, session=session)
        self.assertEqual(list(s.index), [D(2026, 10, 1), D(2026, 10, 5)])
        self.assertEqual(list(s.values), [4.12, 4.20])
        url, params = session.calls[0]
        self.assertTrue(url.endswith("/fred/series/observations"))
        self.assertEqual(params["series_id"], "DGS10")
        self.assertEqual(params["observation_start"], "2026-10-01")
        self.assertEqual(params["observation_end"], "2026-10-09")
        self.assertEqual(params["file_type"], "json")
        self.assertEqual(params["api_key"], KEY)

    def test_empty_window_returns_empty_series(self):
        session = FakeSession(FakeResponse(200, obs_payload()))
        s = fred_api.observations("DGS10", D(2026, 10, 3), D(2026, 10, 4), key=KEY, session=session)
        self.assertEqual(len(s), 0)

    def test_bad_request_fails_fast_without_leaking_key(self):
        session = FakeSession(FakeResponse(400, {"error_code": 400, "error_message": f"Bad Request. series NOPE ({KEY})"}))
        with self.assertRaises(fred_api.FredError) as ctx:
            fred_api.observations("NOPE", D(2026, 1, 1), D(2026, 1, 2), key=KEY, session=session)
        self.assertEqual(len(session.calls), 1)  # 400은 재시도하지 않는다
        self.assertIn("HTTP 400", str(ctx.exception))
        self.assertNotIn(KEY, str(ctx.exception))

    def test_rate_limit_then_success(self):
        session = FakeSession(
            FakeResponse(429, {"error_code": 429, "error_message": "Too Many Requests"}, headers={"Retry-After": "3"}),
            FakeResponse(503, None, text="Service Unavailable"),
            FakeResponse(200, obs_payload(("2026-10-01", "15.1"))),
        )
        s = fred_api.observations("VIXCLS", D(2026, 10, 1), D(2026, 10, 1), key=KEY, session=session)
        self.assertEqual(list(s.values), [15.1])
        self.assertEqual(len(session.calls), 3)

    def test_network_error_message_is_scrubbed(self):
        boom = fred_api.requests.ConnectionError(f"failed: https://api.stlouisfed.org/...&api_key={KEY}")
        session = FakeSession(*([boom] * fred_api.MAX_ATTEMPTS))
        with self.assertRaises(fred_api.FredError) as ctx:
            fred_api.observations("VIXCLS", D(2026, 10, 1), D(2026, 10, 1), key=KEY, session=session)
        self.assertNotIn(KEY, str(ctx.exception))
        self.assertIn("***", str(ctx.exception))
        self.assertEqual(len(session.calls), fred_api.MAX_ATTEMPTS)

    def test_requires_key(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(fred_api.FredError):
                fred_api.observations("VIXCLS", D(2026, 10, 1), D(2026, 10, 1))


class SeriesInfoTest(QuietTestCase):
    def test_keeps_known_fields(self):
        session = FakeSession(FakeResponse(200, {"seriess": [{
            "id": "WALCL", "title": "Assets: Total Assets", "units": "Millions of U.S. Dollars",
            "units_short": "Mil. of U.S. $", "frequency": "Weekly, As of Wednesday", "frequency_short": "W",
            "seasonal_adjustment_short": "NSA", "observation_start": "2002-12-18", "observation_end": "2026-10-07",
            "last_updated": "2026-10-08 15:31:02-05", "popularity": 90, "notes": "long text",
        }]}))
        info = fred_api.series_info("WALCL", key=KEY, session=session)
        self.assertEqual(info["units"], "Millions of U.S. Dollars")
        self.assertEqual(info["last_updated"], "2026-10-08 15:31:02-05")
        self.assertNotIn("notes", info)
        self.assertEqual(set(info), set(fred_api.SERIES_FIELDS))


class FetchSeriesRoutingTest(QuietTestCase):
    def setUp(self):
        super().setUp()
        bmd.SOURCES.clear()

    def fdr_frame(self):
        return pd.DataFrame({"DGS10": [4.1, 4.2]}, index=pd.to_datetime(["2026-10-01", "2026-10-02"]))

    def test_uses_api_when_key_present(self):
        api_series = pd.Series([4.3], index=[D(2026, 10, 1)])
        with mock.patch.dict(os.environ, {"FRED_API_KEY": KEY}), \
                mock.patch.object(fred_api, "observations", return_value=api_series) as api, \
                mock.patch.object(bmd.fdr, "DataReader") as fdr:
            s = bmd.fetch_series("FRED:DGS10", D(2026, 10, 1), D(2026, 10, 2))
        api.assert_called_once()
        fdr.assert_not_called()
        self.assertEqual(list(s.values), [4.3])
        self.assertEqual(bmd.SOURCES["FRED:DGS10"], "fred_api")

    def test_falls_back_to_fdr_on_api_error(self):
        with mock.patch.dict(os.environ, {"FRED_API_KEY": KEY}), \
                mock.patch.object(fred_api, "observations", side_effect=fred_api.FredError("HTTP 500")), \
                mock.patch.object(bmd.fdr, "DataReader", return_value=self.fdr_frame()):
            s = bmd.fetch_series("FRED:DGS10", D(2026, 10, 1), D(2026, 10, 2))
        self.assertEqual(list(s.values), [4.1, 4.2])
        self.assertEqual(bmd.SOURCES["FRED:DGS10"], "fdr")
        self.assertIn("fdr로 재시도", self.err.getvalue())

    def test_falls_back_to_fdr_on_empty_api_result(self):
        with mock.patch.dict(os.environ, {"FRED_API_KEY": KEY}), \
                mock.patch.object(fred_api, "observations", return_value=pd.Series([], dtype="float64")), \
                mock.patch.object(bmd.fdr, "DataReader", return_value=self.fdr_frame()):
            s = bmd.fetch_series("FRED:DGS10", D(2026, 10, 1), D(2026, 10, 2))
        self.assertEqual(len(s), 2)
        self.assertEqual(bmd.SOURCES["FRED:DGS10"], "fdr")

    def test_no_key_uses_fdr_only(self):
        with mock.patch.dict(os.environ, {}, clear=True), \
                mock.patch.object(fred_api, "observations") as api, \
                mock.patch.object(bmd.fdr, "DataReader", return_value=self.fdr_frame()):
            bmd.fetch_series("FRED:DGS10", D(2026, 10, 1), D(2026, 10, 2))
        api.assert_not_called()
        self.assertEqual(bmd.SOURCES["FRED:DGS10"], "fdr")

    def test_non_fred_symbol_never_hits_api(self):
        frame = pd.DataFrame({"Close": [2400.0]}, index=pd.to_datetime(["2026-10-01"]))
        with mock.patch.dict(os.environ, {"FRED_API_KEY": KEY}), \
                mock.patch.object(fred_api, "observations") as api, \
                mock.patch.object(bmd.fdr, "DataReader", return_value=frame):
            s = bmd.fetch_series("KS11", D(2026, 10, 1), D(2026, 10, 2))
        api.assert_not_called()
        self.assertEqual(list(s.values), [2400.0])

    def test_failure_on_both_paths_is_recorded(self):
        with mock.patch.dict(os.environ, {}, clear=True), \
                mock.patch.object(bmd.fdr, "DataReader", side_effect=RuntimeError("blocked")):
            self.assertIsNone(bmd.fetch_series("FRED:DGS10", D(2026, 10, 1), D(2026, 10, 2)))
        self.assertEqual(bmd.SOURCES["FRED:DGS10"], "failed")


class CatalogTest(QuietTestCase):
    SYMBOLS = {"vix": "FRED:VIXCLS", "gold": "GC=F", "fed_assets": "FRED:WALCL"}
    NOW = datetime.datetime(2026, 10, 10, 1, 0, tzinfo=datetime.timezone.utc)

    def test_without_key_keeps_previous_metadata(self):
        previous = {"series": [{"column": "vix", "id": "VIXCLS", "via": "fred_api",
                                "meta": {"units": "Index"}, "meta_fetched_at": "2026-10-09T00:00:00+00:00"}]}
        catalog, ok, failed = fred_catalog.build_catalog(self.SYMBOLS, {"FRED:VIXCLS": "fdr"}, previous, None, self.NOW)
        self.assertFalse(catalog["api_key_configured"])
        by_col = {s["column"]: s for s in catalog["series"]}
        self.assertNotIn("gold", by_col)  # FRED 시리즈만
        self.assertEqual(by_col["vix"]["via"], "fdr")
        self.assertEqual(by_col["vix"]["meta"], {"units": "Index"})
        self.assertIsNone(by_col["fed_assets"]["meta"])
        self.assertIsNone(by_col["fed_assets"]["via"])
        self.assertEqual((ok, failed), (0, 0))

    def test_with_key_refreshes_and_tolerates_failures(self):
        def fetch(series_id):
            if series_id == "WALCL":
                raise fred_api.FredError("HTTP 500")
            return {"id": series_id, "units": "Index"}
        previous = {"series": [{"column": "fed_assets", "id": "WALCL", "meta": {"units": "Millions of U.S. Dollars"}}]}
        catalog, ok, failed = fred_catalog.build_catalog(self.SYMBOLS, {}, previous, fetch, self.NOW)
        by_col = {s["column"]: s for s in catalog["series"]}
        self.assertTrue(catalog["api_key_configured"])
        self.assertEqual(by_col["vix"]["meta"], {"id": "VIXCLS", "units": "Index"})
        self.assertEqual(by_col["vix"]["meta_fetched_at"], "2026-10-10T01:00:00+00:00")
        self.assertEqual(by_col["fed_assets"]["meta"], {"units": "Millions of U.S. Dollars"})  # 실패 → 이전 값
        self.assertEqual((ok, failed), (1, 1))

    def test_metadata_for_changed_series_id_is_dropped(self):
        previous = {"series": [{"column": "vix", "id": "OLDID", "meta": {"units": "x"}}]}
        catalog, _, _ = fred_catalog.build_catalog({"vix": "FRED:VIXCLS"}, {}, previous, None, self.NOW)
        self.assertIsNone(catalog["series"][0]["meta"])

    def test_warns_on_unit_mismatch(self):
        fetch = lambda sid: {"id": sid, "units": "Billions of U.S. Dollars"}  # noqa: E731
        fred_catalog.build_catalog({"fed_assets": "FRED:WALCL"}, {}, {}, fetch, self.NOW)
        self.assertIn("WALCL 단위", self.err.getvalue())

    def test_update_catalog_writes_file(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {}, clear=True):
            path = os.path.join(tmp, "data", "fred_series.json")
            fred_catalog.update_catalog(self.SYMBOLS, {"FRED:VIXCLS": "fdr"}, path=path)
            with open(path, encoding="utf-8") as f:
                saved = json.load(f)
        self.assertEqual([s["column"] for s in saved["series"]], ["vix", "fed_assets"])
        self.assertEqual(saved["api_key_status"], "missing")

    def test_update_catalog_records_malformed_key_without_value(self):
        bad = "Not-A-Real-Key-12345"
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {"FRED_API_KEY": bad}):
            path = os.path.join(tmp, "fred_series.json")
            fred_catalog.update_catalog(self.SYMBOLS, {}, path=path)
            with open(path, encoding="utf-8") as f:
                text = f.read()
        saved = json.loads(text)
        self.assertEqual(saved["api_key_status"], "malformed")
        self.assertFalse(saved["api_key_configured"])
        self.assertNotIn(bad, text)


class CollectorSmokeTest(QuietTestCase):
    """collect_market_data.main()이 CSV를 쓰고 카탈로그까지 남기는지 — 원천 조회는 흉내 낸다."""

    def test_main_writes_csv_and_catalog(self):
        import collect_market_data as cmd

        today = datetime.date.today()
        days = [today - datetime.timedelta(days=n) for n in (3, 2, 1)]

        def fake_fetch(symbol, start, end):
            bmd.SOURCES[symbol] = "fred_api" if symbol.startswith("FRED:") else "fdr"
            return pd.Series([1.0, 2.0, 3.0], index=days)

        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(cmd, "CSV_PATH", os.path.join(tmp, "market_snapshot.csv")), \
                mock.patch.object(fred_catalog, "CATALOG_PATH", os.path.join(tmp, "fred_series.json")), \
                mock.patch.object(cmd, "fetch_series", side_effect=fake_fetch), \
                mock.patch.object(cmd, "fetch_dxy_ice", return_value=pd.Series([100.0], index=days[-1:])), \
                mock.patch.object(cmd, "update_catalog", side_effect=lambda sy, so: fred_catalog.update_catalog(
                    sy, so, path=os.path.join(tmp, "fred_series.json"))), \
                mock.patch.dict(os.environ, {}, clear=True):
            cmd.main()
            with open(os.path.join(tmp, "market_snapshot.csv"), encoding="utf-8") as f:
                lines = f.read().strip().splitlines()
            with open(os.path.join(tmp, "fred_series.json"), encoding="utf-8") as f:
                catalog = json.load(f)

        self.assertEqual(lines[0], ",".join(bmd.COLUMNS))
        self.assertEqual(len(lines), 4)
        fred_cols = [c for c, s in bmd.FDR_SYMBOLS.items() if s.startswith("FRED:")]
        self.assertEqual([s["column"] for s in catalog["series"]], fred_cols)
        self.assertTrue(all(s["via"] == "fred_api" for s in catalog["series"]))


if __name__ == "__main__":
    unittest.main()
