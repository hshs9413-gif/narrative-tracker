"""한국은행 ECOS 수집 — 응답 해석·항목 고르기·기존 값 지키기 (네트워크 없음)."""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import collect_korea as ck  # noqa: E402


class KoreaTest(unittest.TestCase):
    def test_parse_rows_skips_blanks(self):
        rows = [{"TIME": "20261008", "DATA_VALUE": "2.75"}, {"TIME": "20261009", "DATA_VALUE": ""},
                {"TIME": "202610", "DATA_VALUE": "1"}, {"TIME": "20261010", "DATA_VALUE": "-1,234.5"}]
        self.assertEqual(ck.parse_rows(rows), [("2026-10-08", 2.75), ("2026-10-10", -1234.5)])

    def test_pick_item_by_name(self):
        items = [{"ITEM_CODE": "A", "ITEM_NAME": "외국인 순매수(코스닥시장)", "CYCLE": "D"},
                 {"ITEM_CODE": "B", "ITEM_NAME": "외국인 순매수(유가증권시장)", "CYCLE": "D"},
                 {"ITEM_CODE": "C", "ITEM_NAME": "외국인 순매수(유가증권시장)", "CYCLE": "M"},
                 {"ITEM_CODE": "D", "ITEM_NAME": "국고채(30년)", "CYCLE": "D"},
                 {"ITEM_CODE": "E", "ITEM_NAME": "국고채(3년)", "CYCLE": "D"}]
        self.assertEqual(ck.pick_item(items, ["외국인", "순매수"], "D")["ITEM_CODE"], "B")
        self.assertEqual(ck.pick_item(items, ["국고채", "3년"], "D")["ITEM_CODE"], "E")
        self.assertEqual(ck.pick_item(items, ["기준금리"], "D", "0101000")["ITEM_CODE"], "0101000")
        self.assertIsNone(ck.pick_item(items, ["없는"], "D"))

    def test_merge_keeps_columns_not_fetched(self):
        existing = {"2026-10-07": {"date": "2026-10-07", "bok_rate": "2.5", "ktb3y": "2.9", "ktb10y": "", "foreign_net": "-100"}}
        rows = ck.merge(existing, {"ktb3y": [("2026-10-07", 3.0), ("2026-10-08", 3.1)]})
        self.assertEqual(rows[0]["bok_rate"], "2.5")      # 못 받은 컬럼은 그대로
        self.assertEqual(rows[0]["ktb3y"], "3")           # 받은 컬럼은 새 값
        self.assertEqual(rows[1], {"date": "2026-10-08", "bok_rate": "", "ktb3y": "3.1", "ktb10y": "", "foreign_net": ""})
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "k.csv")
            ck.write(rows, path)
            self.assertEqual(list(ck.load_existing(path)), ["2026-10-07", "2026-10-08"])

    def test_key_is_scrubbed(self):
        os.environ["ECOS_API_KEY"] = "SECRETKEY123"
        try:
            self.assertEqual(ck._scrub("https://ecos.bok.or.kr/api/StatisticSearch/SECRETKEY123/json"),
                             "https://ecos.bok.or.kr/api/StatisticSearch/***/json")
        finally:
            del os.environ["ECOS_API_KEY"]


if __name__ == "__main__":
    unittest.main()
