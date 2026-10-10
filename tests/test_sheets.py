"""구글 시트 전송(push_to_sheets) 설정 오류 확인 — 네트워크 없이 돈다.

실행: python -m unittest discover -s tests -v
"""

import io
import os
import sys
import unittest
from contextlib import redirect_stdout
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import push_to_sheets  # noqa: E402

DEPLOY_ID = "AKfycb" + "x" * 66  # 웹 앱 배포 ID 모양 (72자)


class TokenCheckTest(unittest.TestCase):
    def run_main(self, url, token):
        out = io.StringIO()
        with mock.patch.dict(os.environ, {"SHEETS_WEBAPP_URL": url, "SHEETS_TOKEN": token}), \
                mock.patch.object(push_to_sheets.requests, "post") as post, redirect_stdout(out), \
                self.assertRaises(SystemExit):
            push_to_sheets.main()
        post.assert_not_called()  # 잘못된 토큰이면 보내지 않는다
        return out.getvalue()

    def test_deploy_id_as_token_is_reported_as_annotation(self):
        url = f"https://script.google.com/macros/s/{DEPLOY_ID}/exec"
        self.assertIn("::error title=Google Sheets 전송 실패::", self.run_main(url, DEPLOY_ID))
        # 다른 배포의 ID를 넣은 경우도 같은 안내
        other = "AKfycb" + "y" * 66
        self.assertIn("스크립트 속성의 TOKEN", self.run_main(url, other))


    def test_bare_deploy_id_becomes_url(self):
        self.assertEqual(push_to_sheets.webapp_url(f" {DEPLOY_ID}\n"), f"https://script.google.com/macros/s/{DEPLOY_ID}/exec")
        full = f"https://script.google.com/macros/s/{DEPLOY_ID}/exec"
        self.assertEqual(push_to_sheets.webapp_url(full), full)
        self.assertIn("웹 앱 주소가 아님", self.run_main("script.google.com/macros", "tok"))



class CheckSheetTest(unittest.TestCase):
    TABLES = {
        "market_snapshot": [["date", "vix", "gold"], ["2026-10-01", 16.39, 1.0], ["2026-10-02", 15.31, 2.0]],
        "attention": [["date", "event_id", "count"], ["2026-10-02", "a", 3.0]],
        "events": [["id"], ["a"]],
    }

    def sheet(self, snapshot_rows, attention_rows):
        tabs = {"market_snapshot": [["date", "vix", "gold"]] + snapshot_rows,
                "attention": [["date", "event_id", "count"]] + attention_rows}
        return lambda tab: {"ok": True, "rows": tabs[tab]}

    def test_all_match(self):
        get = self.sheet([["2026-10-01", "16.39", "1"], ["2026-10-02", "15.31", "2"]], [["2026-10-02", "a", "3"]])
        lines, problems = push_to_sheets.check_sheet("u", self.TABLES, get=get)
        self.assertEqual(problems, [])
        self.assertIn("market_snapshot 2행 (마지막 2026-10-02)", lines[0])
        self.assertIn("다른 칸 0", lines[0])

    def test_missing_row_and_different_vix(self):
        get = self.sheet([["2026-10-01", "14.21", "1"]], [["2026-10-02", "a", "3"]])
        _, problems = push_to_sheets.check_sheet("u", self.TABLES, get=get)
        self.assertTrue(any("1행이 시트에 없음" in p for p in problems))
        self.assertTrue(any("2026-10-01 vix 시트 14.21/CSV 16.39" in p for p in problems))

    def test_dates_shown_by_sheet_locale_compare_equal(self):
        self.assertEqual(push_to_sheets._num("2026. 9. 28"), "2026-09-28")
        self.assertEqual(push_to_sheets._num("2026-09-28"), "2026-09-28")
        self.assertEqual(push_to_sheets._num("15.310"), 15.31)

    def test_missing_column_reported(self):
        tables = {"regime_log": [["date", "vix", "vix_asof"], ["2026-10-02", 16.39, "2026-10-01"]]}
        get = lambda tab: {"ok": True, "rows": [["date", "vix"], ["2026-10-02", "16.39"]]}
        _, problems = push_to_sheets.check_sheet("u", tables, get=get)
        self.assertTrue(any("시트에 없는 열 vix_asof" in p for p in problems))

    def test_unreadable_tab(self):
        get = lambda tab: {"ok": False, "error": "no such tab"}
        _, problems = push_to_sheets.check_sheet("u", self.TABLES, get=get)
        self.assertIn("market_snapshot: 시트에서 읽지 못함 (no such tab)", problems)


if __name__ == "__main__":
    unittest.main()
