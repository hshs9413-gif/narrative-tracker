"""회귀분석 — 조사, 계수 계산, 한국·미국 장 시차 맞추기, 미리 맞히기, 기록 (네트워크 없음)."""

import os
import sys
import tempfile
import unittest

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import compute_regression as cg  # noqa: E402


class RegressionTest(unittest.TestCase):
    def test_josa(self):
        self.assertEqual(cg.josa("미 10년물", "이가"), "미 10년물이")
        self.assertEqual(cg.josa("VIX", "이가"), "VIX가")
        self.assertEqual(cg.josa("금", "은는"), "금은")
        self.assertEqual(cg.josa("국고채 10년", "은는"), "국고채 10년은")
        self.assertEqual(cg.josa("원/달러(FRED)", "은는"), "원/달러(FRED)는")
        self.assertEqual(cg.josa("달러인덱스", "이가"), "달러인덱스가")

    def test_ols_recovers_slope(self):
        rng = np.random.default_rng(0)
        x = rng.normal(size=500)
        y = 0.5 + 2.0 * x + rng.normal(scale=0.1, size=500)
        beta, se, r2 = cg.ols(x[:, None], y)
        self.assertAlmostEqual(beta[1], 2.0, places=1)
        self.assertGreater(r2, 0.99)
        self.assertLess(se[1], 0.01)

    def test_korean_close_pairs_with_previous_us_session(self):
        # 미국 금리가 10/7(수) 장에서 10bp 뛰면, 한국 장은 그 뒤인 10/8(목)에 반응한다 — 10/7 한국 장과 짝지으면 안 됨
        us_dates = pd.to_datetime(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"])
        kr_dates = pd.to_datetime(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"])
        levels = {"us10y": pd.Series([4.0, 4.0, 4.1, 4.1], index=us_dates),
                  "kospi": pd.Series([100.0, 100.0, 100.0, 99.0], index=kr_dates)}
        df = cg.paired_changes(levels, "kospi", "us10y")
        self.assertAlmostEqual(df.loc["2026-10-08", "dx"], 10.0)  # 10/7 미국 장의 +10bp
        self.assertAlmostEqual(df.loc["2026-10-07", "dx"], 0.0)   # 10/7 한국 장 땐 아직 10/6 미국 장까지

    def test_same_session_pairs_and_skips_holiday(self):
        d = pd.to_datetime(["2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13"])
        levels = {"dxy_ice": pd.Series([100.0, 101.0, 101.0, 102.0], index=d),
                  # 원/달러 쪽만 10/12에 값이 있고 달러인덱스는 10/12에 새 관측이 없는 경우를 흉내 — 아래에서 10/12 달러인덱스를 뺌
                  "usdkrw_fred": pd.Series([1300.0, 1313.0, 1313.0, 1326.0], index=d)}
        levels["dxy_ice"] = levels["dxy_ice"].drop(pd.Timestamp("2026-10-12"))
        df = cg.paired_changes(levels, "usdkrw_fred", "dxy_ice")
        self.assertNotIn(pd.Timestamp("2026-10-12"), df.index)  # 달러인덱스가 쉰 날은 뺀다
        self.assertAlmostEqual(df.loc["2026-10-09", "dx"], np.log(101 / 100) * 100)

    def test_walk_forward_exact_relation_and_regime_flip(self):
        rng = np.random.default_rng(1)
        x = rng.normal(size=(40, 1))
        oos, hit, tried = cg.walk_forward(x, 3 * x[:, 0])
        self.assertGreater(oos, 0.99)
        self.assertEqual(hit, tried)
        # 앞 구간에서 배운 관계가 뒤에서 뒤집히면 미리 맞히기는 과거 평균보다 못해야 한다(미래 값을 몰래 쓰지 않음)
        n = cg.MIN_TRAIN + 3
        y = np.where(np.arange(n) < cg.MIN_TRAIN, 3 * x[:n, 0], -3 * x[:n, 0])
        oos, _, _ = cg.walk_forward(x[:n], y)
        self.assertLess(oos, 0)

    def test_verdict_words(self):
        self.assertIn("예측력 없음", cg.verdict(-0.1, 10, 20))
        self.assertIn("거의 없음", cg.verdict(0.03, 12, 20))
        self.assertIn("지켜볼 것", cg.verdict(0.2, 15, 20))

    def test_merge_log_adds_new_keys_only(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "r.csv")
            cols = ["key", "계수"]
            self.assertEqual(cg.merge_log(path, cols, [{"key": "2026-10-14 a", "계수": 1}]), 1)
            self.assertEqual(cg.merge_log(path, cols, [{"key": "2026-10-14 a", "계수": 9}]), 0)  # 같은 기준일은 처음 값
            self.assertEqual(cg.merge_log(path, cols, [{"key": "2026-10-15 a", "계수": 2}]), 1)
            with open(path, encoding="utf-8") as f:
                self.assertEqual(f.read(), "key,계수\n2026-10-14 a,1\n2026-10-15 a,2\n")


if __name__ == "__main__":
    unittest.main()
