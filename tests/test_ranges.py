"""한 달 뒤 예상 범위 — 범위 계산, 되짚기에 미래 값이 섞이지 않는지, 기록 채우기 (네트워크 없음)."""

import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import compute_ranges as cr  # noqa: E402


def pts(values, start="2026-01-01"):
    import datetime
    d = datetime.date.fromisoformat(start)
    out = []
    for v in values:
        while d.weekday() >= 5:
            d += datetime.timedelta(days=1)
        out.append((d.isoformat(), v))
        d += datetime.timedelta(days=1)
    return out


class RangeTest(unittest.TestCase):
    def test_band_log_and_bp(self):
        lo, hi = cr.band(100.0, 0.01, "log")
        s = cr.Z * 0.01 * math.sqrt(20)
        self.assertAlmostEqual(lo, 100 * math.exp(-s))
        self.assertAlmostEqual(hi, 100 * math.exp(s))
        self.assertAlmostEqual(lo * hi, 100 * 100)  # 로그 기준 대칭 — 가운데가 지금 값
        lo, hi = cr.band(4.0, 5.0, "bp")  # 하루 5bp
        self.assertAlmostEqual(hi - 4.0, cr.Z * 5 * math.sqrt(20) / 100)
        self.assertAlmostEqual(4.0 - lo, hi - 4.0)

    def test_sigma_needs_window(self):
        vals = [100 + (i % 3) for i in range(cr.WINDOW)]
        self.assertIsNone(cr.daily_sigma(vals, len(vals) - 1, "log"))
        vals.append(101)
        self.assertIsNotNone(cr.daily_sigma(vals, len(vals) - 1, "log"))

    def test_backtest_uses_only_past(self):
        # 평탄하다가 마지막 20거래일에 크게 뛰는 시계열 — 되짚기는 뛰기 전 값만으로 범위를 내므로 빗나가야 한다
        flat = [100 * (1.001 if i % 2 else 0.999) for i in range(cr.WINDOW + 5)]
        jump = flat + [150.0] * cr.HORIZON
        bt = cr.backtest(pts(jump), "log")
        self.assertGreater(bt["above"], 0)
        self.assertEqual(bt["days"], len(jump) - cr.WINDOW - cr.HORIZON)
        # 미래 값을 바꿔도 각 날의 범위(그날까지의 값)는 같아야 한다 — 바뀌는 건 적중 여부뿐
        a = cr.daily_sigma([v for _, v in pts(jump)], cr.WINDOW + 2, "log")
        b = cr.daily_sigma([v for _, v in pts(flat + [90.0] * cr.HORIZON)], cr.WINDOW + 2, "log")
        self.assertEqual(a, b)

    def test_add_weekdays_skips_weekend(self):
        self.assertEqual(cr.add_weekdays("2026-10-09", 1), "2026-10-12")  # 금 → 월
        self.assertEqual(cr.add_weekdays("2026-10-13", 20), "2026-11-10")

    def test_log_adds_once_and_fills_outcome(self):
        series = pts([100.0 + i for i in range(cr.WINDOW + 1)])
        points = {"usdkrw": series}
        item = {"id": "usdkrw", "base_date": series[-1][0], "base": series[-1][1], "lo": 150.0, "hi": 170.0, "due": "x"}
        log = []
        self.assertTrue(cr.update_log(log, [item], points))
        self.assertFalse(cr.update_log(log, [{**item, "lo": 1.0}], points))  # 같은 기준일은 처음 낸 범위 그대로
        self.assertEqual(log[0]["lo"], 150.0)
        self.assertEqual(log[0]["after"], "")
        # 20거래일 뒤 값이 생기면 채운다
        later = series + pts([165.0] * cr.HORIZON, start="2027-01-01")
        self.assertTrue(cr.update_log(log, [], {"usdkrw": later}))
        self.assertEqual(log[0]["after"], 165.0)
        self.assertEqual(log[0]["inside"], 1)
        self.assertEqual(cr.live_stats(log, "usdkrw"), {"n": 1, "inside": 1, "next_due": None})
        self.assertFalse(cr.update_log(log, [], {"usdkrw": later}))  # 다시 돌아도 그대로

    def test_live_stats_reads_csv_strings(self):
        log = [{"key": "a", "id": "kospi", "due": "2026-11-09", "inside": ""},
               {"key": "b", "id": "kospi", "due": "2026-10-01", "inside": "0"},
               {"key": "c", "id": "kospi", "due": "2026-10-02", "inside": "1"}]
        self.assertEqual(cr.live_stats(log, "kospi"), {"n": 2, "inside": 1, "next_due": "2026-11-09"})


if __name__ == "__main__":
    unittest.main()
