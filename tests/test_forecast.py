"""지금 지표 → 다음 예측 — 한·미 장 순서, 새 미국 장 판단, 채점, ^TNX 단위, 장중 값 버리기 (네트워크 없음)."""

import datetime
import os
import sys
import unittest

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import compute_forecast as cf  # noqa: E402
import collect_market_data as cmd  # noqa: E402


def bdays(start, n):
    return pd.bdate_range(start, periods=n)


class ForecastTest(unittest.TestCase):
    def test_normalize_tnx(self):
        s = pd.Series([4.25, 42.5, 4.3])
        self.assertEqual(list(cf.normalize_tnx(s)), [4.25, 4.25, 4.3])

    def test_overnight_frame_uses_us_session_before_korean_session(self):
        # 미국 10/7 장에서 S&P +1% → 한국 10/8 장 변화와 짝 (10/7 한국 장은 미국 10/7 장보다 먼저 닫힘)
        d = pd.to_datetime(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"])
        kospi = pd.Series([100.0, 100.0, 100.0, 101.0], index=d, name="kospi")
        us = pd.DataFrame({"sp500": [100.0, 100.0, 101.0, 101.0], "sox": [50.0, 50.0, 50.0, 50.0]}, index=d)
        df = cf.overnight_frame(kospi, us, ["sp500", "sox"])
        self.assertAlmostEqual(df.loc["2026-10-08", "sp500"], np.log(1.01) * 100)
        self.assertAlmostEqual(df.loc["2026-10-07", "sp500"], 0.0)

    def test_overnight_inputs_fresh_only_after_korean_close(self):
        d = pd.to_datetime(["2026-10-12", "2026-10-13"])
        kospi = pd.Series([100.0, 99.0], index=d, name="kospi")
        us = pd.DataFrame({"sp500": [100.0, 102.0]}, index=d)  # 미국 10/13 장은 한국 10/13 장 뒤에 끝남
        when, inp, fresh = cf.overnight_inputs(kospi, us, ["sp500"])
        self.assertTrue(fresh)
        self.assertEqual(when, pd.Timestamp("2026-10-13"))
        self.assertAlmostEqual(inp["sp500"], np.log(1.02) * 100)  # 한국 10/13 장 전까지 반영된 건 미국 10/12 장
        # 미국 장이 한국 마지막 장보다 앞에서 끝나 있으면(미국 휴장) 새로 알 게 없다
        us_old = pd.DataFrame({"sp500": [100.0]}, index=pd.to_datetime(["2026-10-09"]))
        _, _, fresh = cf.overnight_inputs(kospi, us_old, ["sp500"])
        self.assertFalse(fresh)

    def test_rows_and_record_on_synthetic_relation(self):
        n = cf.TRAIN + 80
        d = bdays("2025-01-01", n)
        rng = np.random.default_rng(3)
        sp = 100 * np.exp(np.cumsum(rng.normal(0, 0.01, n)))
        sox = 100 * np.exp(np.cumsum(rng.normal(0, 0.02, n)))
        tnx = 4 + np.cumsum(rng.normal(0, 0.05, n))
        us = pd.DataFrame({"sp500": sp, "sox": sox, "tnx": tnx}, index=d)
        # 코스피 하루 변화 = 전날 미국 S&P 변화의 0.8배 + 잡음 — 마지막 한국 장은 마지막 미국 장과 같은 날짜(먼저 닫힘)
        sp_ch = np.r_[0, np.diff(np.log(sp))]
        k = 100 * np.exp(np.cumsum(np.r_[0, 0.8 * sp_ch[:-1]] + rng.normal(0, 0.002, n)))
        levels = {"kospi": pd.Series(k, index=d), "ktb10y": pd.Series(3 + np.cumsum(rng.normal(0, 0.03, n)), index=d)}
        rows = cf.overnight_rows(levels, us)
        kospi = next(r for r in rows if r["key"].endswith("코스피"))
        self.assertGreater(kospi["과거_미리맞히기_R2"], 0.5)
        self.assertGreater(kospi["과거_방향적중률"], 0.8)
        self.assertAlmostEqual(kospi["예측"], 0.8 * sp_ch[-1] * 100, delta=0.15)
        self.assertLess(kospi["예측_90%_아래"], kospi["예측"])
        self.assertIn("어젯밤", kospi["지금_지표"])

    def test_score_next_session_and_month(self):
        d = pd.to_datetime(["2026-10-13", "2026-10-14"])
        levels = {"kospi": pd.Series([100.0, 102.0], index=d)}
        row = {"key": "2026-10-13 다음 한국 장 코스피", "기준일": "2026-10-13", "예측": 0.5,
               "예측_90%_아래": -1.0, "예측_90%_위": 1.5, "실제": ""}
        self.assertTrue(cf.score(row, levels))
        self.assertAlmostEqual(row["실제"], round(np.log(1.02) * 100, 3))
        self.assertEqual((row["범위_안"], row["방향_맞음"]), (0, 1))
        self.assertFalse(cf.score(row, levels))  # 이미 채웠으면 그대로
        # 다음 한국 장 값이 아직 없으면 비워 둔다
        row2 = {**row, "key": "2026-10-14 다음 한국 장 코스피", "기준일": "2026-10-14", "실제": ""}
        self.assertFalse(cf.score(row2, levels))

    def test_drop_unfinished_session(self):
        end = datetime.date(2026, 10, 14)
        df = pd.DataFrame({"kospi": [6035.35, 6076.1]}, index=[datetime.date(2026, 10, 13), end])
        rows = {"2026-10-13": {}, "2026-10-14": {"kospi": "6076.1"}}
        out = cmd.drop_unfinished(df, rows, end)
        self.assertEqual(list(out.index), [datetime.date(2026, 10, 13)])
        self.assertNotIn("2026-10-14", rows)


if __name__ == "__main__":
    unittest.main()
