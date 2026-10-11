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
        self.assertEqual(e["last_review"], {"date": "2026-10-11", "by": "gemini", "verdict": "갱신", "reason": "재격화"})
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

    def test_notes_only_updates_are_not_capped_and_ids_are_stripped(self):
        self.assertEqual(gm.clean_note("5.31%를 기록함(h5, h8)."), "5.31%를 기록함.")
        ev = events() + [dict(events()[0], id=f"x{i}") for i in range(4)]
        props = [{"id": f"x{i}", "notes_append": f"메모{i} [h1]", "evidence": ["h1"]} for i in range(4)]
        entries, n = gm.apply_proposal({"updates": props}, ev, heads(), [], TODAY, "m")
        self.assertEqual(n, 4)
        self.assertTrue(all("[h1]" not in e["notes"] for e in ev))

    def test_field_words_become_korean_with_matching_particles(self):
        self.assertEqual(gm.clean_note("제안은 dormant였으나 active 상태를 유지 (h3, h9)."), "제안은 잠잠이었으나 진행 중 상태를 유지.")
        self.assertEqual(gm.clean_note("ended로 정리, 단계는 correction"), "끝남으로 정리, 단계는 진정")
        self.assertEqual(gm.clean_note("AI active learning, markets in shock"), "AI active learning, markets in shock")

    def test_evidence_ids_in_other_formats(self):
        for ev in (["1", 2], "h1, h2", ["[h1]", "h2"]):
            ids, n_src = gm._evidence(ev, heads())
            self.assertEqual((ids, n_src), (["h1", "h2"], 2), ev)

    def test_cooldown_and_limit(self):
        log = [{"date": "2026-10-10", "by": "gemini", "status": "applied", "event_id": "iran-war-2026",
                "changes": {"intensity": ["low", "mid"]}}]
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
            log = [{"date": "2026-10-11", "by": by, "status": "applied", "event_id": "iran-war-2026",
                    "changes": {"phase": ["shock", "correction"]}}]
            _, n = gm.apply_proposal({"updates": [{"id": "iran-war-2026", "intensity": "mid", "evidence": ["h1"]}]},
                                     events(), heads(), log, TODAY, "m")
            self.assertEqual(n, 0 if blocked else 1, by)

    def test_note_only_changes_do_not_start_cooldown(self):
        log = [{"date": "2026-10-11", "by": "gemini", "status": "applied", "event_id": "iran-war-2026",
                "changes": {"notes": ["…", "메모"]}}]
        _, n = gm.apply_proposal({"updates": [{"id": "iran-war-2026", "intensity": "mid", "evidence": ["h1"]}]},
                                 events(), heads(), log, TODAY, "m")
        self.assertEqual(n, 1)

    def test_same_day_note_is_replaced(self):
        note = gm.append_note("기본", "아침 메모", TODAY)
        note = gm.append_note(note, "다시 돌린 메모", TODAY)
        self.assertNotIn("아침 메모", note)
        self.assertEqual(note.count("[10-11 Gemini]"), 1)

    def test_note_keeps_last_three_gemini_entries(self):
        note = "기본"
        for i in range(5):
            note = gm.append_note(note, f"메모{i}", TODAY + datetime.timedelta(days=i))
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


class ReviewVerdictTest(unittest.TestCase):
    """매일 모든 진행 중 내러티브에 판정을 받는 형식(reviews) — 유지·강약·잠잠·재점화·종료·병합"""

    def lineup(self):
        ev = events()
        ev.append({"id": "bond-2026", "name": "채권 매도", "layer": "structural", "status": "active", "phase": "shock",
                   "intensity": "high", "trigger_date": "2026-09-15", "keywords": ["국채금리"], "notes": "기존"})
        ev.append({"id": "quiet-2026", "name": "식은 것", "layer": "cyclical", "status": "dormant", "phase": "correction",
                   "intensity": "low", "trigger_date": "2026-05-01", "half_life_date": "2026-08-01",
                   "dormant_since": "2026-09-01", "keywords": ["조용"], "notes": "기존"})
        return ev

    def run_reviews(self, reviews, ev=None, fade=None, log=None):
        ev = ev or self.lineup()
        entries, n = gm.apply_proposal({"reviews": reviews}, ev, heads(), log or [], TODAY, "m", fade or {})
        return ev, {e["id"]: e for e in ev}, entries, n

    def test_keep_records_review_without_log_line(self):
        ev, by, entries, n = self.run_reviews([{"id": "iran-war-2026", "verdict": "keep", "reason": "흐름 그대로", "evidence": []}])
        self.assertEqual((n, entries), (0, []))
        self.assertEqual(by["iran-war-2026"]["last_review"]["verdict"], "유지")

    def test_up_down_one_step_and_bounds(self):
        _, by, _, n = self.run_reviews([{"id": "iran-war-2026", "verdict": "up", "reason": "r", "evidence": ["h1"]}])
        self.assertEqual((n, by["iran-war-2026"]["intensity"]), (1, "mid"))
        _, _, entries, n = self.run_reviews([{"id": "bond-2026", "verdict": "up", "reason": "r", "evidence": ["h5"]}])
        self.assertEqual(n, 0)
        self.assertIn("이미 가장 강함", entries[0]["reject_reason"])
        _, _, entries, n = self.run_reviews([{"id": "iran-war-2026", "verdict": "강화", "reason": "r", "evidence": []}])
        self.assertIn("근거 기사 없음", entries[0]["reject_reason"])

    def test_dormant_needs_fade_or_two_sources(self):
        r = [{"id": "iran-war-2026", "verdict": "dormant", "reason": "기사 줄어듦", "evidence": []}]
        _, _, entries, n = self.run_reviews(r, fade={"iran-war-2026": {"식음": False}})
        self.assertEqual(n, 0)
        self.assertIn("언급 감소", entries[0]["reject_reason"])
        _, by, entries, n = self.run_reviews(r, fade={"iran-war-2026": {"식음": True, "기사_7일": 1}})
        e = by["iran-war-2026"]
        self.assertEqual((n, e["status"], e["dormant_since"], e["half_life_date"]), (1, "dormant", "2026-10-11", "2026-10-11"))
        self.assertEqual(entries[0]["changes"]["status"], ["active", "dormant"])

    def test_end_by_sources_or_long_quiet(self):
        _, by, _, n = self.run_reviews([{"id": "iran-war-2026", "verdict": "end", "reason": "종전 합의", "evidence": ["h1", "h2"]}])
        e = by["iran-war-2026"]
        self.assertEqual((n, e["status"], e["ended_on"], e["half_life_date"]), (1, "ended", "2026-10-11", "2026-10-11"))
        # 잠잠한 지 40일 + 식음이면 기사 없이도 종료, 반감기는 원래 값 유지
        _, by, _, n = self.run_reviews([{"id": "quiet-2026", "verdict": "종료", "reason": "조용", "evidence": []}],
                                       fade={"quiet-2026": {"식음": True, "잠잠_일수": 40}})
        self.assertEqual((n, by["quiet-2026"]["status"], by["quiet-2026"]["half_life_date"]), (1, "ended", "2026-08-01"))
        _, _, entries, n = self.run_reviews([{"id": "quiet-2026", "verdict": "end", "reason": "조용", "evidence": []}],
                                            fade={"quiet-2026": {"식음": True, "잠잠_일수": 5}})
        self.assertEqual(n, 0)
        self.assertIn("종료는", entries[0]["reject_reason"])

    def test_merge_and_retire_cap(self):
        _, by, entries, n = self.run_reviews([{"id": "quiet-2026", "verdict": "merge", "merge_into": "bond-2026",
                                               "reason": "같은 이야기", "evidence": ["h5"]}])
        self.assertEqual((n, by["quiet-2026"]["status"], by["quiet-2026"]["merged_into"]), (1, "ended", "bond-2026"))
        self.assertIn("'식은 것' 내러티브를 여기로 합침", by["bond-2026"]["notes"])
        _, _, entries, n = self.run_reviews([{"id": "quiet-2026", "verdict": "merge", "merge_into": "old-2024", "reason": "r",
                                              "evidence": ["h5"]}])
        self.assertIn("merge_into", entries[0]["reject_reason"])
        three = [{"id": i, "verdict": "end", "reason": "r", "evidence": ["h1", "h2"]} for i in ("iran-war-2026", "bond-2026", "quiet-2026")]
        _, by, entries, n = self.run_reviews(three)
        self.assertEqual(n, 2)
        self.assertIn("2개까지만", entries[-1]["reject_reason"])

    def test_bad_optional_field_is_dropped_not_fatal(self):
        _, by, entries, n = self.run_reviews([{"id": "iran-war-2026", "verdict": "up", "phase": "shock", "reason": "r",
                                               "evidence": ["h1"]}])
        e = by["iran-war-2026"]
        self.assertEqual((n, e["intensity"], e["phase"]), (1, "mid", "correction"))
        self.assertTrue(entries[0]["dropped"][0].startswith("phase"))

    def test_reignite_and_duplicate_review(self):
        r = [{"id": "quiet-2026", "verdict": "reignite", "reason": "r", "evidence": ["h1", "h2"]},
             {"id": "quiet-2026", "verdict": "keep", "reason": "r"}]
        _, by, entries, n = self.run_reviews(r)
        e = by["quiet-2026"]
        self.assertEqual((n, e["status"], e["half_life_date"]), (1, "active", None))
        self.assertNotIn("dormant_since", e)
        self.assertIn("중복", entries[-1]["reject_reason"])

    def test_fade_stats(self):
        ev = self.lineup()
        series = {"iran-war-2026": [50] * 20 + [5] * 7, "bond-2026": [3] * 3}
        f = gm.fade_stats(ev, {"iran-war-2026": 8, "bond-2026": 1, "quiet-2026": 6}, TODAY, series)
        self.assertEqual(f["iran-war-2026"]["언급_정점대비"], 0.1)
        self.assertTrue(f["iran-war-2026"]["식음"])
        self.assertTrue(f["bond-2026"]["식음"])            # 7일 기사 1건
        self.assertEqual(f["quiet-2026"]["잠잠_일수"], 40)
        self.assertFalse(f["quiet-2026"]["식음"])
        self.assertNotIn("old-2024", f)
        self.assertEqual((f["iran-war-2026"]["제안"], f["quiet-2026"]["제안"]), ("dormant", None))
        self.assertNotIn("locked-2026", [k for k, v in f.items() if v["제안"]])
        f = gm.fade_stats(ev, {"quiet-2026": 0}, TODAY, {})
        self.assertEqual(f["quiet-2026"]["제안"], "end")

    def test_suggestion_applies_unless_rebutted_with_fresh_articles(self):
        fade = {"iran-war-2026": {"식음": True, "기사_7일": 2, "언급_정점대비": 0.2, "제안": "dormant"}}
        # 유지라고만 하고 최근 기사를 못 대면 → 규칙이 잠잠으로
        ev, by, entries, n = self.run_reviews([{"id": "iran-war-2026", "verdict": "keep", "reason": "긴장 지속", "evidence": ["h1"]}],
                                              fade=fade)
        e = by["iran-war-2026"]
        self.assertEqual((n, e["status"], e["last_review"]["by"], e["last_review"]["verdict"]), (1, "dormant", "rule", "잠잠"))
        self.assertIn("잠잠으로", entries[-1]["reason"])
        # 판정을 아예 안 냈어도 제안대로
        _, by, _, _ = self.run_reviews([], fade=fade)
        self.assertEqual(by["iran-war-2026"]["status"], "dormant")
        # 최근 3일 안 서로 다른 매체 2곳으로 반박하면 그대로
        _, by, _, n = self.run_reviews([{"id": "iran-war-2026", "verdict": "keep", "reason": "r", "evidence": ["h1", "h2"]}], fade=fade)
        self.assertEqual((n, by["iran-war-2026"]["status"]), (0, "active"))
        # 끝내자는 제안도 같은 방식 (잠잠한 지 오래된 것)
        _, by, entries, _ = self.run_reviews([], fade={"quiet-2026": {"식음": True, "제안": "end"}})
        self.assertEqual(by["quiet-2026"]["status"], "ended")
        self.assertIn("종료로", entries[-1]["reason"])

    def test_mass_suggestion_is_held_back(self):
        fade = {i: {"식음": True, "제안": "dormant"} for i in ("iran-war-2026", "bond-2026")}
        fade["quiet-2026"] = {"식음": True, "제안": "end"}
        _, by, _, n = self.run_reviews([], fade=fade)  # 열린 3개 중 3개 → 보류
        self.assertEqual((n, by["iran-war-2026"]["status"]), (0, "active"))

    def test_stale_or_repeated_notes_are_dropped(self):
        old = "기존\n[10-10 Gemini] 10/8 뉴욕연은 보고서에서 트럼프 관세가 미국 소비재 물가를 2.9%p 인상한다고 분석."
        self.assertEqual(gm.note_problem("10/8 뉴욕연은 보고서, 트럼프 관세가 미국 소비재 물가를 2.9%p 인상한다고 분석.", old, TODAY),
                         "이미 있는 내용")
        self.assertIn("넘은 사실", gm.note_problem("9/16 FOMC 만장일치 금리 인상으로 독립성 확인", "기존", TODAY))
        self.assertIsNone(gm.note_problem("10/10 호르무즈 유조선 폭발 사고 발생", old, TODAY))
        self.assertIsNone(gm.note_problem("12/30 연말 유동성 경색", "기존", datetime.date(2027, 1, 2)))
        ev, by, entries, n = self.run_reviews([{"id": "iran-war-2026", "verdict": "keep", "reason": "r", "evidence": ["h1"],
                                                "note": "9/2 유조선 공격"}])
        self.assertEqual((n, by["iran-war-2026"]["notes"]), (0, "기존"))


class CandidateTest(unittest.TestCase):
    def test_candidates_accumulate_by_day_and_expire(self):
        cands = {}
        gm.update_candidates(cands, [{"name": "엔비디아 실적 충격", "why": "w", "evidence": ["h1"]}], heads(), TODAY)
        gm.update_candidates(cands, [{"name": "엔비디아 실적 충격", "why": "w", "evidence": ["h2"]}], heads(), TODAY)
        self.assertEqual(cands["엔비디아실적충격"]["days_seen"], 1)
        nxt = TODAY + datetime.timedelta(days=1)
        ranked = gm.update_candidates(cands, [{"name": "엔비디아 실적충격", "why": "w", "evidence": ["h2"]},
                                              {"name": "근거 없는 것", "evidence": ["h99"]}], heads(), nxt)
        self.assertEqual([(c["name"], c["days_seen"]) for c in ranked], [("엔비디아 실적 충격", 2)])
        gm.update_candidates(cands, [], heads(), TODAY + datetime.timedelta(days=12))
        self.assertEqual(cands, {})

    def test_promoted_candidate_needs_two_articles_and_is_removed(self):
        cands = {"채권매도": {"key": "채권매도", "name": "채권 매도", "first_seen": "2026-10-09", "days_seen": 2, "last_seen": "2026-10-10"}}
        new = dict(NewEventRulesTest.NEW, evidence=["h5", "h2"], from_candidate="채권 매도")
        ev = events()
        entries, n = gm.apply_proposal({"new_events": [new]}, ev, heads(), [], TODAY, "m", {}, cands)
        self.assertEqual(n, 1)
        self.assertEqual(ev[0]["candidate_since"], "2026-10-09")
        self.assertEqual(cands, {})
        _, n = gm.apply_proposal({"new_events": [dict(new, from_candidate=None)]}, events(), heads(), [], TODAY, "m")
        self.assertEqual(n, 0)

    def test_new_event_overlapping_keywords_rejected(self):
        new = dict(NewEventRulesTest.NEW, keywords=["호르무즈", "유조선"])
        entries, n = gm.apply_proposal({"new_events": [new]}, events(), heads(), [], TODAY, "m")
        self.assertEqual(n, 0)
        self.assertIn("검색어가 겹침", entries[0]["reject_reason"])


class AutoTransitionEndTest(unittest.TestCase):
    def test_long_dormant_ends(self):
        import auto_transition as at
        e = {"id": "x", "status": "dormant", "dormant_since": (datetime.date.today() - datetime.timedelta(days=70)).isoformat()}
        series = [(f"d{i:03d}", c) for i, c in enumerate([40] * 20 + [1] * 30)]
        new, why = at.evaluate(e, series)
        self.assertEqual(new, "ended", why)
        e["dormant_since"] = (datetime.date.today() - datetime.timedelta(days=20)).isoformat()
        new, _ = at.evaluate(e, series)
        self.assertIsNone(new)


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
    def test_matches_requires_all_words(self):
        self.assertTrue(news_feed.matches("美 국채금리 급등에 증시 흔들", ["국채금리 급등"]))
        self.assertFalse(news_feed.matches("국채 매입 확대", ["국채금리 급등"]))
        self.assertTrue(news_feed.matches("AI 버블 경고", ["AI 버블"]))

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
