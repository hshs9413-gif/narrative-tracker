"""상관관계 — 끝나지 않은 주 빼기, 말로 옮기기, 코스피를 받쳐 준 자산 고르기 (네트워크 없음)."""

import os
import sys
import unittest

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import compute_correlation as cc  # noqa: E402


class CorrelationTest(unittest.TestCase):
    def test_unfinished_week_dropped(self):
        d = pd.bdate_range("2026-09-28", "2026-10-14")  # 10/14(수)는 끝나지 않은 주
        s = {"kospi": pd.Series(np.arange(len(d), dtype=float) + 100, index=d)}
        W = cc.weekly_changes(s, pd.Timestamp("2026-10-14"))
        self.assertEqual(W.index[-1], pd.Timestamp("2026-10-09"))

    def test_words(self):
        self.assertEqual(cc.words(0.1), "거의 따로 움직임")
        self.assertEqual(cc.words(-0.5), "반대로 꽤 움직임")
        self.assertEqual(cc.words(0.7), "같이 강하게 움직임")
        self.assertIn("최근엔 같이", cc.describe("코스피", "금", 0.4, -0.3))
        self.assertIn("둘 다 거의 따로", cc.describe("코스피", "금", 0.1, -0.15))

    def test_hedges_flip_sign_for_yields(self):
        rng = np.random.default_rng(0)
        k = rng.normal(size=60)
        idx = pd.date_range("2025-01-03", periods=60, freq="W-FRI")
        W = pd.DataFrame({"kospi": k,
                          "ktb10y": k * 5 + rng.normal(scale=1, size=60),   # 주가 빠질 때 금리도 빠짐 = 채권 가격 오름 → 받쳐 줌
                          "gold": k + rng.normal(scale=0.5, size=60)}, index=idx)  # 같이 빠짐 → 못 받쳐 줌
        out, line = cc.kospi_hedges(W)
        names = {x["asset"]: x["r"] for x in out}
        self.assertLess(names["한국 국채"], -0.2)
        self.assertGreater(names["금"], 0.2)
        self.assertIn("한국 국채", line)
        self.assertNotIn("금(", line)


if __name__ == "__main__":
    unittest.main()
