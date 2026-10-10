"""Gemini 내러티브 관리의 규칙 검사·반영, 기사 파싱, 판정 보강(신용 3일 확인·국내 변동성) 테스트 — 네트워크 없음.

실행: python -m unittest discover -s tests -v
"""

import datetime
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import compute_regime  # noqa: E402
import gemini_manage as gm  # noqa: E402
import news_feed  # noqa: E402

TODAY = datetime.date(2026, 10, 11)


def heads():
    return {
        "h1": {"title": "이란, 호르무즈 유조선 공격 확대", "source": "연합뉴스", "date": "2026-10-09", "url": "u1", "group": "iran"},
        "h2": {"title": "유가 100달러 돌파… 중동 확전 우려", "source": "한국경제", "date": "2026-10-08", "url": "u2", "group": "iran"},
        "h3": {"title": "브렌트유 급등", "source": "연합뉴스", "date": "2026-10-08", "url": "u3", "group": "iran"},
        "h4": {"title": "Manufacturing PMI at 54.5%; September 2026 ISM Report", "source": "PR Newswire",
               "date": "2026-10-01", "url": "u4", "group": "pmi"},
        "h5": {"title": "美 국채 10년물 5% 돌파", "source": "매일경제", "date": "2026-10-05", "url": "u5", "group": "market"},
    }


def events():
    return [
        {"id": "iran-war-2026", "name": "이란 전쟁", "layer": "political", "status": "active", "phase": "correction",
         "intensity": "low", "trigger_date": "2026-02-28", "peak_date": "2026-03-21", "keywords": ["호르무즈", "확전"], "notes": "기존"},
        {"id": "old-2024", "name": "끝난 것", "layer": "political", "status": "ended", "phase": "correction",
         "intensity": "low", "trigger_date": "2024-01-01", "keywords": [], "notes": ""},
        {"id": "locked-2026", "name": "잠근 것", "layer": "cyclical", "status": "active", "phase": "shock",
         "intensity": "mid", "trigger_date": "2026-05-01", "keywords": ["a1", "b2"], "notes": "", "auto_lock": True},
    ]


class UpdateRulesTest(unittest.TestCase):
    def test_valid_update_applied_with_note_and_log(self):
        ev = events()
        prop = {"updates": [{"id": "iran-war-2026", "phase": "shock", "intensity": "mid", "peak_date": "2026-04-30",
                             "notes_append": "10월 유조선 공격 확대", "reason": "재격화", "evidence": ["h1", "h2"]}]}
        entries, n = gm.apply_proposal(prop, ev, heads(), [], TODAY, "m")
        self.assertEqual(n, 1)
        e = ev[0]
        self.assertEqual((e["phase"], e["intensity"], e["peak_date"]), ("shock", "mid", "2026-04-30"))
        self.assertIn("[10-11 Gemini] 10월 유조선 공격 확대", e["notes"])
        self.assertEqual(e["last_review"], {"date": "2026-10-11", "by": "gemini"})
        self.assertEqual(entries[0]["changes"]["phase"], ["correction", "shock"])
        self.assertEqual([x["url"] for x in entries[0]["evidence"]], ["u1", "u2"])

    def test_rejections(self):
        cases = [
            ({"id": "iran-war-2026", "intensity": "high", "evidence": ["h1"]}, "한 단계씩"),
            ({"id": "iran-war-2026", "phase": "shock", "evidence": ["h1", "h3"]}, "매체 기사 2개"),  # 같은 매체 두 건
            ({"id": "iran-war-2026", "phase": "shock", "evidence": ["h99"]}, "근거 기사 없음"),
            ({"id": "iran-war-2026", "status": "gone", "evidence": ["h1", "h2"]}, "허용값"),
            ({"id": "old-2024", "status": "active", "evidence": ["h1", "h2"]}, "끝난"),
            ({"id": "locked-2026", "intensity": "low", "evidence": ["h1"]}, "auto_lock"),
            ({"id": "nope", "intensity": "low", "evidence": ["h1"]}, "목록에 없는"),
            ({"id": "iran-war-2026", "peak_date": "2027-01-01", "evidence": ["h1"]}, "peak_date"),
            ({"id": "iran-war-2026", "keywords": ["하나"], "evidence": ["h1"]}, "keywords"),
        ]
        for prop, why in cases:
            entries, n = gm.apply_proposal({"updates": [prop]}, events(), heads(), [], TODAY, "m")
            self.assertEqual(n, 0, prop)
            self.assertIn(why, entries[0]["reject_reason"], prop)

    def test_cooldown_and_limit(self):
        log = [{"date": "2026-10-10", "by": "gemini", "status": "applied", "event_id": "iran-war-2026"}]
        entries, n = gm.apply_proposal({"updates": [{"id": "iran-war-2026", "intensity": "mid", "evidence": ["h1"]}]},
                                       events(), heads(), log, TODAY, "m")
        self.assertEqual(n, 0)
        self.assertIn("이미 바꿈", entries[0]["reject_reason"])
        # 쿨다운 중이어도 메모만은 받는다 (강도 변경은 버림)
        ev = events()
        entries, n = gm.apply_proposal({"updates": [{"id": "iran-war-2026", "intensity": "mid", "notes_append": "유조선 공격 지속",
                                                     "evidence": ["h1"]}]}, ev, heads(), log, TODAY, "m")
        self.assertEqual(n, 1)
        self.assertEqual(ev[0]["intensity"], "low")
        self.assertIn("유조선 공격 지속", ev[0]["notes"])
        # 사람·검증이 손본 것도 쉬게 두고, 규칙 전환은 막지 않는다
        for by, blocked in (("human", True), ("claude", False), ("rule", False)):
            log = [{"date": "2026-10-11", "by": by, "status": "applied", "event_id": "iran-war-2026"}]
            _, n = gm.apply_proposal({"updates": [{"id": "iran-war-2026", "intensity": "mid", "evidence": ["h1"]}]},
                                     events(), heads(), log, TODAY, "m")
            self.assertEqual(n, 0 if blocked else 1, by)

    def test_note_keeps_last_three_gemini_entries(self):
        note = "기본"
        for i in range(5):
            note = gm.append_note(note, f"메모{i}", TODAY)
        self.assertTrue(note.startswith("기본"))
        self.assertNotIn("메모1", note)
        self.assertIn("메모4", note)


class NewEventRulesTest(unittest.TestCase):
    NEW = {"id": "bond-selloff-2026", "name": "글로벌 채권 매도", "layer": "structural", "phase": "shock",
           "intensity": "mid", "trigger_date": "2026-09-15", "assets": ["us10y", "bonds", "nonsense"],
           "keywords": ["국채금리 급등", "채권 매도"], "notes": "10년물 5% 돌파", "evidence": ["h5", "h2", "h1"]}

    def test_new_event_added_active_with_filtered_assets(self):
        ev = events()
        entries, n = gm.apply_proposal({"new_events": [dict(self.NEW)]}, ev, heads(), [], TODAY, "m")
        self.assertEqual(n, 1)
        self.assertEqual(ev[0]["id"], "bond-selloff-2026")
        self.assertEqual(ev[0]["status"], "active")
        self.assertEqual(ev[0]["assets"], ["us10y", "bonds"])
        self.assertEqual(ev[0]["added_by"], "gemini")

    def test_new_event_rejections(self):
        for patch, why in (({"evidence": ["h1", "h2"]}, "3개 이상"), ({"id": "Bad Id"}, "id 형식"),
                           ({"id": "iran-war-2026"}, "이미 있는"), ({"trigger_date": "2025-01-01"}, "최근"),
                           ({"layer": "other"}, "layer")):
            entries, n = gm.apply_proposal({"new_events": [{**self.NEW, **patch}]}, events(), heads(), [], TODAY, "m")
            self.assertEqual(n, 0, patch)
            self.assertIn(why, entries[0]["reject_reason"], patch)


class PmiTest(unittest.TestCase):
    MANUAL = {"ism_pmi": {"value": 54.6, "as_of": "2026-08-01"}}

    def test_due(self):
        self.assertTrue(gm.pmi_due(self.MANUAL, TODAY))
        self.assertFalse(gm.pmi_due({"ism_pmi": {"as_of": "2026-09-01"}}, TODAY))
        self.assertFalse(gm.pmi_due(self.MANUAL, datetime.date(2026, 10, 1)))

    def test_value_must_appear_in_cited_title(self):
        res, why = gm.check_pmi({"value": 54.5, "month": "2026-09", "evidence": ["h4"]}, heads(), self.MANUAL, TODAY)
        self.assertIsNone(why)
        self.assertEqual((res["value"], res["as_of"], res["url"]), (54.5, "2026-09-01", "u4"))
        _, why = gm.check_pmi({"value": 55.1, "month": "2026-09", "evidence": ["h4"]}, heads(), self.MANUAL, TODAY)
        self.assertIn("제목에", why)
        _, why = gm.check_pmi({"value": 54.5, "month": "2026-08", "evidence": ["h4"]}, heads(), self.MANUAL, TODAY)
        self.assertIn("이미", why)


class NewsFeedTest(unittest.TestCase):
    def test_parse_rss_strips_source_suffix(self):
        xml = b"""<rss><channel>
          <item><title>Oil jumps - Reuters</title><link>https://n/1</link><pubDate>Thu, 08 Oct 2026 10:00:00 GMT</pubDate><source>Reuters</source></item>
          <item><title>No link</title></item>
        </channel></rss>"""
        items = news_feed.parse_rss(xml, 5)
        self.assertEqual(items, [{"title": "Oil jumps", "source": "Reuters", "date": "2026-10-08", "url": "https://n/1"}])
        self.assertEqual(news_feed.or_query(["호르무즈", "유가 급등", "x"]), '호르무즈 OR "유가 급등" OR x')


class RegimeAdditionsTest(unittest.TestCase):
    def test_confirmed_level_needs_three_days_but_escalates_fast(self):
        lv = [("d1", 0), ("d2", 1), ("d3", 0), ("d4", 1), ("d5", 1), ("d6", 1), ("d7", 0)]
        self.assertEqual(compute_regime.confirmed_level(lv, 3, 2), (1, "d6"))
        self.assertEqual(compute_regime.confirmed_level([("a", 0), ("b", 2)], 3, 2), (2, "b"))
        self.assertEqual(compute_regime.confirmed_level([("a", 0), ("b", 1)], 1, 99), (1, "b"))

    def test_kospi_vol_bands_and_staleness(self):
        cfg = {"window": 20, "max_age_days": 10, "bands": [
            {"label": "평상", "level_index": 0, "max": 25}, {"label": "경계", "level_index": 1, "max": 40},
            {"label": "고변동", "level_index": 2, "max": 60}, {"label": "극단", "level_index": 3, "max": None}]}
        start = datetime.date(2026, 9, 1)
        calm = [{"date": (start + datetime.timedelta(days=i)).isoformat(), "kospi": 100 * (1.001 ** i)} for i in range(25)]
        wild = [{"date": (start + datetime.timedelta(days=i)).isoformat(), "kospi": 100 * (1.06 if i % 2 else 0.95)} for i in range(25)]
        today = start + datetime.timedelta(days=26)
        self.assertEqual(compute_regime.compute_kospi_vol(calm, cfg, today)["label"], "평상")
        self.assertEqual(compute_regime.compute_kospi_vol(wild, cfg, today)["label"], "극단")
        stale = compute_regime.compute_kospi_vol(calm, cfg, today + datetime.timedelta(days=30))
        self.assertEqual(stale["label"], "미확인")


if __name__ == "__main__":
    unittest.main()
