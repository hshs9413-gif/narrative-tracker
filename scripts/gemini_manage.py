"""Gemini 무료 모델로 내러티브 목록(events.json)을 매일 정리하고 PMI 수동값을 채운다 (수집 워크플로에서 실행).

목표 — 목록에 '지금 시장을 움직이는 이야기'만 남게: 새 이야기는 넣고, 식은 이야기는 잠잠·종료로 돌리고, 겹치면 합친다.

흐름
  1) 기사 모으기 (news_feed.py, Google News RSS — 무료 등급은 검색 그라운딩이 막혀 있다)
     · 진행 중 내러티브별 검색어 기사 — 7일 기사 수 자체가 '식었는지'의 근거가 된다
     · 구글 뉴스 경제 주요 기사(한·영) 중 기존 검색어에 안 걸린 것 — 새 이슈 찾기용
     · 급증한 글로벌 워치리스트 기사
     모두 h1, h2 … 번호를 붙여 넘기고, Gemini는 그 번호로만 근거를 댄다 — 없는 기사를 지어낼 수 없다.
  2) Gemini 1회 호출 — 진행 중 내러티브마다 판정(keep·up·down·dormant·reignite·end·merge)을 빠짐없이 받고,
     새 내러티브와 '지켜볼 후보'도 받는다. 매번 모든 항목에 판정을 내리게 해야 식은 이야기가 목록에 계속 남지 않는다
     (10/11까지는 '바뀐 것만 내라'고 해서 메모만 붙고 종료·추가가 한 번도 없었음).
  3) 규칙 검사 후 반영 — 허용 값·근거 기사 수·매체 수·한 번에 바꾸는 폭·쿨다운을 코드가 확인한다.
     잠잠·종료는 '기사가 없다'는 게 근거라 기사 번호를 댈 수 없으므로, 코드가 계산한 언급 감소(7일 기사 수·정점 대비
     언급량)를 근거로 인정한다. 끝난 내러티브는 지우지 않고 status=ended로 남긴다 — 화면 목록에서 빠지고, 지층 단면·
     과거 비교에는 계속 쓰인다.
  4) 후보 — 기준엔 못 미치지만 지켜볼 주제를 narrative_candidates.json에 날짜와 함께 쌓고, 이틀 넘게 이어지면
     조금 낮은 근거 기준으로 새 내러티브에 올릴 수 있다. 10일 동안 다시 안 보이면 지운다.
  5) PMI — 새 달 ISM 발표가 나올 때가 되면 기사 제목에서 수치를 뽑게 하고, 그 숫자가 근거 기사 제목에
     그대로 있을 때만 manual_inputs.json에 반영한다.
  6) 기록 — 모든 변경·거절을 docs/data/narrative_log.json에, 내러티브별 마지막 판정을 events.json last_review에 남긴다.

Gemini는 글을 쓰지 않는다 — 판정(상태·단계·강도)과 기사 번호만 고르고, 화면에는 그 기사의 실제 제목이 실린다
(events.json headline). 10/11까지는 매일 메모를 쓰게 했는데 '2007년 이후 최고치 경신'처럼 기사에 없는 과장·
날짜가 지난 사실이 섞여 들어와 그만뒀다. 판정 이유(reason)는 갱신 기록에만 남는다.

실패해도(키 없음·쿼터·응답 이상) 경고만 남기고 0으로 끝난다 — 수집·커밋을 막지 않는다.
사람이 막고 싶은 이벤트는 events.json에서 "auto_lock": true 로 두면 Gemini도 건드리지 않는다.
"""

import csv
import datetime
import json
import os
import re
import statistics
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))

import gemini_api  # noqa: E402
import news_feed  # noqa: E402

BASE = os.path.join(os.path.dirname(__file__), "..")
DATA = os.path.join(BASE, "docs", "data")
EVENTS_PATH = os.path.join(DATA, "events.json")
LOG_PATH = os.path.join(DATA, "narrative_log.json")
CANDIDATES_PATH = os.path.join(DATA, "narrative_candidates.json")
MANUAL_PATH = os.path.join(DATA, "manual_inputs.json")
ATTENTION_PATH = os.path.join(DATA, "attention.csv")
WATCH_PATH = os.path.join(DATA, "watchlist_attention.csv")
SCAN_PATH = os.path.join(DATA, "scan_keywords.json")
MARKET_PATH = os.path.join(DATA, "market_snapshot.csv")

STATUS = ("active", "dormant", "ended")
PHASE = ("shock", "overshoot", "correction")
INTENSITY = ("low", "mid", "high")
LAYER = ("cyclical", "structural", "political")
ASSETS = ("dollar", "us10y", "bonds", "gold", "oil", "equity", "equity_bigtech", "semiconductor",
          "power_infra", "kospi", "krw", "yen", "vix", "credit")
VERDICT = {"keep": "유지", "up": "강화", "down": "약화", "dormant": "잠잠", "reignite": "재점화", "end": "종료", "merge": "병합"}
VERDICT_ALIAS = {**{v: k for k, v in VERDICT.items()}, "hold": "keep", "maintain": "keep", "strengthen": "up",
                 "weaken": "down", "ended": "end", "close": "end", "reactivate": "reignite", "merged": "merge"}

MAX_UPDATES = 4          # 한 번에 상태·단계·강도·검색어를 바꿀 수 있는 내러티브 수 (메모만 붙이는 건 제한 없음)
MAX_RETIRE = 2           # 한 번에 종료·병합할 수 있는 수
MAX_NEW = 2              # 한 번에 추가할 수 있는 새 내러티브 수
MAX_OPEN = 12            # active+dormant 상한
COOLDOWN_DAYS = 3        # 같은 내러티브를 Gemini가 구조적으로 다시 바꾸기까지 최소 간격
NEW_EVENT_MAX_AGE = 180  # 새 내러티브 trigger_date는 최근 180일 안
FADE_RATIO = 0.35        # 언급량 7일 평균이 정점의 이 비율 이하면 '식음'
FADE_MIN_OBS = 14        # 그 판정에 필요한 최소 관측일
QUIET_HEADLINES = 2      # 내러티브 검색어로 7일 기사가 이 수 이하면 '식음'
END_AFTER_DORMANT = 14   # 잠잠한 채 이 일수가 지나고 계속 식어 있으면 기사 없이도 종료 가능
CANDIDATE_TTL = 10       # 후보가 이 일수 동안 다시 안 보이면 지움
MAX_CANDIDATES = 8
RECENT_ENDED_DAYS = 120  # 프롬프트에 '최근 끝난 것'으로 보여줄 기간 (같은 이야기를 새로 만들지 않게)
FRESH_DAYS = 3           # 식은 내러티브를 '유지'하려면 이 일수 안의 기사(서로 다른 매체 2곳)를 대야 한다
# 판단 전에 생각할 토큰 예산 — 0이면 기사 77건을 훑고 바로 답해 근거 부족으로 아무것도 안 바꾸는 경향(10/11 확인).
# 무료 등급 한도(분당 토큰)에 비해 작아 하루 1회 호출엔 부담이 없다. GEMINI_THINKING 변수로 조정.
THINKING_BUDGET = int(os.environ.get("GEMINI_THINKING", "4096") or 0)
LOG_KEEP = 400
MARKET_COLS = {"vix": "VIX", "hy_oas": "HY OAS(%)", "us10y": "美10년(%)", "breakeven10y": "기대인플레 10년(%)",
               "brent_front": "브렌트($)", "gold": "금($)", "dxy_ice": "달러인덱스", "kospi": "KOSPI", "usdkrw": "원/달러"}


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


DRY_RUN = os.environ.get("GEMINI_DRY_RUN") == "1"  # PR 점검용 — 제안·검사 결과만 출력하고 파일은 안 씀


def save_json(path, data):
    if DRY_RUN:
        return
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _date(s):
    try:
        return datetime.date.fromisoformat(str(s))
    except ValueError:
        return None


def is_open(e):
    return e.get("status") in ("active", "dormant")


# ───────────────────────────── 자료 모으기

def attention_series():
    by = defaultdict(list)
    if os.path.exists(ATTENTION_PATH):
        with open(ATTENTION_PATH, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                by[r["event_id"]].append((r["date"], int(float(r["count"] or 0))))
    return {k: [c for _, c in sorted(v)] for k, v in by.items()}


def dormant_since(e):
    """잠잠해진 날 — Gemini·규칙이 남긴 dormant_since, 없으면 규칙 전환 기록(last_auto)에서"""
    if e.get("status") != "dormant":
        return None
    d = _date(e.get("dormant_since") or "")
    if d:
        return d
    auto = e.get("last_auto") or {}
    return _date(auto.get("date") or "") if str(auto.get("change", "")).endswith("->dormant") else None


def fade_stats(events, head_counts, today, series=None):
    """진행 중 내러티브별 '식었나' 지표 — 기사 번호로 댈 수 없는 '기사가 없다'는 근거를 코드가 계산해 준다."""
    series = attention_series() if series is None else series
    out = {}
    for e in events:
        if not is_open(e):
            continue
        vals = series.get(e["id"], [])
        ratio = None
        if len(vals) >= FADE_MIN_OBS:
            roll = [statistics.mean(vals[max(0, i - 6):i + 1]) for i in range(len(vals))]
            if max(roll) >= 5:
                ratio = round(roll[-1] / max(roll), 2)
        n7 = head_counts.get(e["id"])
        since = dormant_since(e)
        days = (today - since).days if since else None
        faded = bool((n7 is not None and n7 <= QUIET_HEADLINES) or (ratio is not None and ratio <= FADE_RATIO))
        # 제안 — 지표로 본 기본 판정. Gemini가 최근 기사로 반박하지 못하면 이대로 반영한다 (apply_proposal)
        suggest = None
        if faded and not e.get("auto_lock"):
            suggest = "dormant" if e.get("status") == "active" else "end" if (days or 0) >= END_AFTER_DORMANT else None
        out[e["id"]] = {"기사_7일": n7, "언급_정점대비": ratio, "잠잠_일수": days, "식음": faded, "제안": suggest}
    return out


def rising_watchlist(top=4):
    """최근 7일 평균이 그 전 21일 평균의 1.5배 이상으로 뛴 글로벌 키워드"""
    if not (os.path.exists(WATCH_PATH) and os.path.exists(SCAN_PATH)):
        return []
    by = defaultdict(list)
    with open(WATCH_PATH, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            by[r["keyword_id"]].append((r["date"], float(r["count"] or 0)))
    meta = {k["id"]: k for k in load_json(SCAN_PATH, {}).get("keywords", [])}
    out = []
    for kid, vals in by.items():
        vals = [v for _, v in sorted(vals)]
        if len(vals) < 21 or kid not in meta:
            continue
        recent, prior = sum(vals[-7:]) / 7, sum(vals[-28:-7]) / max(1, len(vals[-28:-7]))
        if recent >= 10 and prior > 0 and recent / prior >= 1.5:
            out.append((recent / prior, kid))
    return [meta[k] for _, k in sorted(out, reverse=True)[:top]]


def market_summary():
    if not os.path.exists(MARKET_PATH):
        return {}
    with open(MARKET_PATH, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    out = {}
    for col, label in MARKET_COLS.items():
        vals = [(r["date"], _f(r.get(col))) for r in rows if _f(r.get(col)) is not None]
        if len(vals) < 21:
            continue
        (d, v), (_, v20) = vals[-1], vals[-21]
        out[label] = {"값": round(v, 2), "날짜": d, "20거래일 변화율(%)": round((v / v20 - 1) * 100, 1)}
    return out


def gather_headlines(events, session=None):
    """({id: 기사}, {내러티브 id: 7일 기사 수}) — 내러티브별 기사 + 목록 밖 경제 주요 기사 + 급증 워치리스트"""
    items, seen, counts = [], set(), {}

    def add(group, arts):
        for a in arts:
            key = re.sub(r"\W+", "", a["title"])[:60]
            if key in seen:
                continue
            seen.add(key)
            items.append({**a, "group": group})

    open_events = [e for e in events if is_open(e) and e.get("keywords")]
    for e in open_events:
        arts = news_feed.headlines(news_feed.or_query(e["keywords"]), "ko", days=7, limit=8, session=session, strict=True)
        # 중복 제거 전 수 — 다른 묶음과 겹쳐도 그 내러티브 기사는 있었던 것. 못 받았으면 None(식었다는 근거로 안 씀)
        counts[e["id"]] = None if arts is None else len(arts)
        add(e["id"], arts or [])
    # 새 이슈 찾기 — 기존 검색어에 걸리는 기사는 이미 목록에 있는 이야기라 뺀다
    known = [k for e in events if is_open(e) for k in e.get("keywords") or []]
    for lang, limit in (("ko", 30), ("en", 20)):
        add(f"top:{lang}", [a for a in news_feed.top_stories(lang, limit=limit, session=session)
                            if not news_feed.matches(a["title"], known)])
    for kw in rising_watchlist():
        add(f"watch:{kw['id']}", news_feed.headlines(kw["query"], "en", days=7, limit=5, session=session))
    return {f"h{i + 1}": a for i, a in enumerate(items)}, counts


# ───────────────────────────── 프롬프트

PROMPT = """당신은 거시경제 내러티브 트래커의 편집자입니다. 오늘은 {today}입니다.
목록에 '지금 시장을 움직이는 이야기'만 남도록 매일 정리하세요 — 새 이야기는 넣고, 식은 이야기는 잠잠·종료로 돌리고,
겹치는 이야기는 합칩니다. 근거는 아래 [기사]와 각 내러티브의 언급 지표뿐입니다. 기사에 없는 사실은 쓰지 마세요.

## 필드 뜻
- status: active(시장에 계속 영향) | dormant(잠잠하지만 재점화 가능) | ended(끝남)
- phase: shock(새 충격·재격화) | overshoot(과열·과잉반응) | correction(진정·정상화)
- intensity(지금의 시장 영향): low | mid | high — high는 관련 자산이 크게 움직이고 주요 매체가 연일 다룰 때만
- layer: cyclical(경기·금리 순환) | structural(수년 단위 구조 테마) | political(정치·지정학)
- assets 허용값: {assets}
- 언급 지표: 기사_7일 = 그 내러티브 검색어로 찾은 최근 7일 기사 수(최대 8), 언급_정점대비 = 하루 기사 수 7일 평균이
  정점의 몇 배인지(1이면 정점), 잠잠_일수 = dormant가 된 뒤 지난 날, 식음 = 위 지표로 본 코드 판단,
  제안 = 지표로 낸 기본 판정(dormant·end). 제안이 있으면 그대로 따르거나, 다르게 판정하려면 최근 {fresh}일 안의
  서로 다른 매체 기사 2개를 evidence로 대세요 — 대지 못하면 제안대로 반영됩니다.

## 1. reviews — [진행 중 목록]의 내러티브 하나하나에 빠짐없이 한 항목씩
verdict는 다음 중 하나:
- keep: 흐름 그대로
- up / down: 시장 영향이 한 단계 커짐 / 작아짐 (근거 기사 1개 이상)
- dormant: 기사·언급이 눈에 띄게 줄어 잠잠해짐 — 식음이 true면 그 자체가 근거
- reignite: 잠잠하던 것이 다시 여러 매체에 (서로 다른 매체 기사 2개 이상)
- end: 사건이 해소됨(합의·종전·철회·정상화 완료 등, 서로 다른 매체 기사 2개 이상), 또는 잠잠_일수가 {end_after}일을 넘었고 식음이 true
- merge: 다른 진행 중 내러티브와 사실상 같은 이야기 — merge_into에 남길 쪽 id
headline은 필수 — 이 내러티브의 지금 상황을 가장 잘 보여 주는 [기사] 하나의 번호(되도록 최근 3일, 그 내러티브 묶음에서).
화면에는 이 기사 제목이 그대로 실리므로, 다른 이야기를 다룬 기사나 제목이 과장된 칼럼·의견 기사('사상 최고' 등)보다
사실을 전하는 보도 기사를 고르세요. 맞는 기사가 없으면 null.
선택: phase(바뀔 때, 매체 2곳 근거), keywords(기사_7일이 0~2건이거나 언급이 늘 포화일 때, 몇 주 쓸 한국어 검색어 2~4개).
reason은 필수 — 왜 그 판정인지 한 문장. 기사 제목에 있는 사실만 쓰고 수치·'최고'·'최초'는 제목에 그대로 있을 때만.
dormant·active 같은 필드 값이나 h번호 대신 잠잠·진행 중처럼 한국어로.

## 2. new_events — 목록에 없는데 여러 매체가 다루고 자산 가격도 반응한 새 이야기 (최대 2개)
주로 [목록 밖 주요 기사]에서 찾으세요. 근거 기사 4개 이상·매체 3곳 이상이고 그중 2곳은 최근 {fresh}일 기사여야 합니다.
그보다 약하면 candidates에 두세요 — 이틀 넘게 이어진 후보는 기사 2개(최근 {fresh}일 기사 1개 포함)로 올릴 수 있습니다.
기존 내러티브의 일부라면 새로 만들지 마세요. [끝난 내러티브]와 같은 이야기도 새로 만들지 마세요.
일회성 뉴스(기업 실적 하나, 하루짜리 사건)는 넣지 마세요.

## 3. candidates — 아직 기준엔 못 미치지만 내일도 지켜볼 주제 (최대 3개, 근거 기사 1개 이상)
[지켜보는 후보]에 이미 있는 주제면 이름을 글자 그대로 쓰세요. 이틀 넘게 이어진 후보가 기준을 채우면
new_events로 올리고 from_candidate에 그 후보 이름을 쓰세요.

근거가 약하면 keep으로 두세요. 다만 이미 식은 이야기를 진행 중으로 남겨 두는 것도 목록을 틀리게 만드는 오류입니다.

## 출력 (JSON만)
{{"reviews": [{{"id": "기존 id", "verdict": "keep", "headline": "h3", "phase": null, "keywords": null, "merge_into": null,
   "reason": "한 문장", "evidence": ["h3"]}}],
 "new_events": [{{"id": "english-kebab-2026", "name": "한국어 이름(30자 이내)", "layer": "...", "phase": "...",
   "intensity": "...", "trigger_date": "YYYY-MM-DD", "assets": ["..."], "keywords": ["한국어 검색어 2~4개"],
   "reason": "한 문장", "evidence": ["h1", "h2", "h5"], "from_candidate": null}}],
 "candidates": [{{"name": "한국어 이름(30자 이내)", "why": "한 문장", "evidence": ["h40"]}}],
 "summary": "오늘 정리 요약 한두 문장"}}

[시장 지표]
{market}

[진행 중 목록]
{events}

[끝난 내러티브] (다시 만들지 말 것)
{ended}

[지켜보는 후보]
{candidates}

[기사 — 내러티브별] (id: 날짜 · 매체 · 제목 · 묶음)
{headlines}

[기사 — 목록 밖 주요 기사]
{discovery}
"""

PMI_PROMPT = """아래 기사 목록에서 미국 ISM 제조업 PMI의 가장 최근 발표치를 찾으세요.
기사 제목에 수치가 그대로 있는 경우만 답하고, 없으면 value를 null로.
JSON만: {{"value": 54.5, "month": "YYYY-MM(지표가 가리키는 달)", "released": "YYYY-MM-DD", "evidence": ["h2"]}}

[기사]
{headlines}
"""


def compact_events(events, fade=None):
    keep = ("id", "name", "layer", "status", "phase", "intensity", "trigger_date", "peak_date", "keywords")
    out = []
    for e in events:
        if not is_open(e):
            continue
        row = {k: e.get(k) for k in keep}
        row["notes"] = strip_gemini_notes(e.get("notes"))[-240:]
        row.update((fade or {}).get(e["id"], {}))
        out.append(row)
    return out


def ended_brief(events, today):
    rows = []
    for e in events:
        if e.get("status") != "ended":
            continue
        end = _date(e.get("ended_on") or e.get("half_life_date") or "")
        recent = end and (today - end).days <= RECENT_ENDED_DAYS
        rows.append(f"{e['id']}: {e.get('name')}" + (f" (끝남 {end})" if recent else ""))
    return "\n".join(rows) or "(없음)"


def format_headlines(heads, groups=None):
    rows = [f"{hid}: {h['date']} · {h['source']} · {h['title']} · {h['group']}"
            for hid, h in heads.items() if groups is None or groups(h["group"])]
    return "\n".join(rows) or "(없음)"


def build_prompt(today, events, heads, fade, cands):
    # 규칙 판정 라벨('신용 평상' 등)은 넣지 않는다 — 예측력이 없고 10/11처럼 실제와 다른 인상을 줄 수 있어 화면에서도 뺐음
    return PROMPT.format(
        today=today.isoformat(), assets=", ".join(ASSETS), end_after=END_AFTER_DORMANT, fresh=FRESH_DAYS,
        market=json.dumps(market_summary(), ensure_ascii=False),
        events="\n".join(json.dumps(r, ensure_ascii=False) for r in compact_events(events, fade)),
        ended=ended_brief(events, today),
        candidates="\n".join(f"- {c['name']} (처음 {c['first_seen']}, {c['days_seen']}일째): {c.get('why', '')}" for c in cands) or "(없음)",
        headlines=format_headlines(heads, lambda g: not g.startswith("top:")),
        discovery=format_headlines(heads, lambda g: g.startswith("top:")))


# ───────────────────────────── 규칙 검사

PLAIN = {"dormant": "잠잠", "active": "진행 중", "ended": "끝남", "keep": "유지", "reignite": "재점화", "merge": "병합",
         "shock": "충격", "overshoot": "과열", "correction": "진정", "intensity": "강도", "status": "상태", "phase": "단계"}


JOSA = {"였": "이었", "로": "으로", "가": "이", "는": "은", "를": "을", "와": "과", "라": "이라", "다": "이다", "야": "이야"}


def plain(text):
    """독자에게 보이는 문장에 섞인 필드 값(dormant·active…)을 한국어로 — 10/11 '제안은 dormant였으나 … active 상태를' 같은 문장.
    앞뒤가 영어 낱말이면('AI active learning') 영어 문장 속 낱말이라 두고, 한국어 사이에 낀 것만 바꾼다. 조사는 받침에 맞춘다."""
    text = str(text or "")

    def swap(m):
        before, after = text[:m.start()].rstrip()[-1:], text[m.end(1):].lstrip()[:1]
        if re.fullmatch(r"[A-Za-z]", before or "") or re.fullmatch(r"[A-Za-z]", after or ""):
            return m.group(0)
        ko, josa = PLAIN[m.group(1).lower()], m.group(2) or ""
        jong = (ord(ko[-1]) - 0xAC00) % 28
        if josa and jong and not (josa == "로" and jong == 8):
            josa = JOSA[josa]
        return ko + josa

    return re.sub(r"(?<![A-Za-z])(" + "|".join(PLAIN) + r")(?![A-Za-z])(였|로|가|는|를|와|라|다|야)?", swap, text, flags=re.I)


def clean_note(text):
    """메모에 섞여 들어온 기사 번호 '(h5, h8)'·'[h3]'는 독자에게 뜻이 없어 지운다 — 근거는 기록에 링크로 남는다."""
    text = re.sub(r"\s*[\(\[]\s*h\d+(?:\s*[,·]\s*h\d+)*\s*[\)\]]", "", plain(text))
    return re.sub(r"\s{2,}", " ", text).strip()


def _evidence(ids, heads):
    """근거 기사 번호 — 모델마다 'h3'·'3'·3·'[h3]'·'h3, h7'처럼 다르게 써서 숫자만 뽑아 h번호로 맞춘다
    (10/11: flash-lite가 번호 형식을 바꿔 제안 5건이 모두 '근거 없음'으로 거절됐음)."""
    if isinstance(ids, (str, int)):
        ids = [ids]
    norm = []
    for raw in ids or []:
        for n in re.findall(r"\d+", str(raw)):
            norm.append(f"h{int(n)}")
    ok = [i for i in dict.fromkeys(norm) if i in heads]
    return ok, len({heads[i]["source"] or heads[i]["url"] for i in ok})


def _ro(word):
    """받침에 맞춘 '로/으로'"""
    c = ord(word[-1]) - 0xAC00
    return f"{word}로" if not 0 <= c <= 11171 or c % 28 in (0, 8) else f"{word}으로"


def _fresh_sources(ids, heads, today):
    """근거 중 최근 FRESH_DAYS일 안 기사의 서로 다른 매체 수"""
    return len({heads[i]["source"] or heads[i]["url"] for i in ids
                if _date(heads[i].get("date") or "") and (today - _date(heads[i]["date"])).days <= FRESH_DAYS})


def strip_gemini_notes(notes):
    """notes에서 Gemini가 덧붙였던 '[MM-DD Gemini] …' 줄을 뺀다 — 10/11까지 쓰던 메모는 부정확한 게 있어 더 쓰지 않음"""
    return "\n".join(ln for ln in str(notes or "").split("\n") if not re.match(r"\[\d{2}-\d{2} Gemini\]", ln.strip())).strip()


def _structural(changes):
    return any(k not in ("notes", "notes_append") for k in (changes or {}))


def recent_changes(log, today, days=COOLDOWN_DAYS):
    since = (today - datetime.timedelta(days=days)).isoformat()
    # Gemini 자신과 사람이 '구조적으로' 바꾼 내러티브만 쉬게 둔다 — 메모만 붙인 것, 출처를 붙인 검증(claude),
    # 규칙 전환은 막지 않음 (10/11: 메모·검증까지 막았더니 모든 내러티브가 사흘간 못 바뀌어 '그대로'로 보였음)
    return {x["event_id"] for x in log if x.get("by") in ("gemini", "human") and x.get("status") == "applied"
            and x.get("date", "") > since and x.get("event_id") and (x.get("kind") == "new" or _structural(x.get("changes")))}


def _verdict(u):
    v = str(u.get("verdict") or "").strip().lower()
    return VERDICT_ALIAS.get(v, v) or None


class _Reject(Exception):
    pass


def check_update(u, events_by_id, heads, cooled, today, fade=None, retire_left=MAX_RETIRE):
    """판정 하나를 검사한다. 반환 (결과, 거절 사유) — 결과 {"verdict", "change", "evidence", "merge_into", "dropped"}.
    판정(verdict)의 핵심(강도 한 단계·잠잠·재점화·종료·병합)이 규칙에 어긋나면 거절하고, 함께 온 선택 필드(단계·고점일·
    검색어)가 어긋나면 그 필드만 뺀다. verdict 없이 필드만 담은 예전 형식(updates)은 하나라도 어긋나면 통째로 거절.
    keep이고 바뀐 게 없으면 change가 빈 dict."""
    eid = u.get("id")
    e = events_by_id.get(eid)
    if e is None:
        return None, "목록에 없는 id"
    if e.get("status") == "ended":
        return None, "끝난 내러티브는 바꾸지 않음"
    if e.get("auto_lock"):
        return None, "auto_lock으로 잠김"
    verdict = _verdict(u)
    if verdict is not None and verdict not in VERDICT:
        return None, f"verdict 허용값 아님: {u.get('verdict')}"
    strict = verdict is None
    ev, n_src = _evidence(u.get("evidence"), heads)
    f = (fade or {}).get(eid, {})
    change, dropped, target = {}, [], None

    def optional(field, problem, value):
        if problem is None:
            change[field] = value
        elif strict:
            raise _Reject(problem)
        else:
            dropped.append(f"{field}({problem})")

    try:
        # ── 핵심: 판정이 가리키는 상태·강도
        status, intensity = (u.get("status"), u.get("intensity")) if strict else (None, None)
        if verdict in ("up", "down"):
            i = INTENSITY.index(e.get("intensity", "low")) + (1 if verdict == "up" else -1)
            if not 0 <= i < len(INTENSITY):
                raise _Reject("이미 가장 강함" if verdict == "up" else "이미 가장 약함")
            intensity = INTENSITY[i]
        elif verdict == "dormant":
            status = "dormant"
        elif verdict == "reignite":
            status = "active"
        elif verdict in ("end", "merge"):
            status = "ended"
        if verdict == "merge":
            target = str(u.get("merge_into") or "").strip()
            t = events_by_id.get(target)
            if not t or target == eid or not is_open(t):
                raise _Reject("merge_into가 진행 중인 다른 내러티브가 아님")
            change["merged_into"] = target

        if status is not None and status != e.get("status"):
            if status not in STATUS:
                raise _Reject(f"status 허용값 아님: {status}")
            if status == "dormant" and n_src < 2 and not f.get("식음"):
                raise _Reject("잠잠 전환은 언급 감소(코드 지표) 또는 서로 다른 매체 기사 2개 이상 필요")
            if status == "active" and n_src < 2:
                raise _Reject("재점화는 서로 다른 매체 기사 2개 이상 필요" if ev else "근거 기사 없음")
            if status == "ended":
                if retire_left <= 0:
                    raise _Reject(f"종료·병합은 한 번에 {MAX_RETIRE}개까지만")
                quiet_long = e.get("status") == "dormant" and (f.get("잠잠_일수") or 0) >= END_AFTER_DORMANT and f.get("식음")
                if not (n_src >= 2 or quiet_long or (verdict == "merge" and ev)):
                    raise _Reject(f"종료는 끝났다는 기사(매체 2곳 이상), 또는 {END_AFTER_DORMANT}일 넘게 잠잠하고 언급도 줄었을 때만")
            change["status"] = status
        if intensity and intensity != e.get("intensity") and change.get("status") != "ended":
            if intensity not in INTENSITY:
                raise _Reject(f"intensity 허용값 아님: {intensity}")
            if abs(INTENSITY.index(intensity) - INTENSITY.index(e.get("intensity", "low"))) > 1:
                raise _Reject("강도는 한 단계씩만")
            if not ev:
                raise _Reject("근거 기사 없음")
            change["intensity"] = intensity

        # ── 선택 필드
        phase = u.get("phase")
        if phase and phase != e.get("phase") and change.get("status") != "ended":
            optional("phase", f"허용값 아님: {phase}" if phase not in PHASE else
                     "근거 기사 없음" if not ev else
                     "상태·단계 변경은 서로 다른 매체 기사 2개 이상 필요" if n_src < 2 else None, phase)
        if u.get("peak_date") and u["peak_date"] != e.get("peak_date"):
            pd, trig = _date(u["peak_date"]), _date(e.get("trigger_date"))
            optional("peak_date", "근거 기사 없음" if not ev else
                     "peak_date가 유효하지 않음" if pd is None or pd > today or (trig and pd < trig) else None,
                     pd.isoformat() if pd else None)
        if u.get("keywords"):
            kws = [k.strip() for k in u["keywords"] if isinstance(k, str) and 2 <= len(k.strip()) <= 20]
            if kws != e.get("keywords"):
                optional("keywords", "keywords는 2~5개(각 2~20자)" if not 2 <= len(kws) <= 5 else
                         "근거 기사 없음" if not ev else None, kws)
    except _Reject as why:
        return None, str(why)

    # 대표 기사 — 화면에 제목이 그대로 실린다. 그 내러티브 묶음의 기사만 받는다(다른 이야기 기사가 걸리지 않게)
    hl = _evidence(u.get("headline"), heads)[0][:1] if u.get("headline") else []
    headline = hl[0] if hl and heads[hl[0]].get("group") == eid else None

    if eid in cooled and _structural(change):
        return None, f"최근 {COOLDOWN_DAYS}일 안에 이미 바꿈"
    if not change and strict:
        return None, "바뀐 내용 없음"
    return {"verdict": verdict or "update", "change": change, "evidence": ev, "merge_into": target, "dropped": dropped,
            "headline": headline}, None


def _overlap(kws, events, today):
    """새 내러티브 검색어가 진행 중이거나 최근 끝난 내러티브와 겹치면 그 내러티브"""
    want = {k.replace(" ", "") for k in kws}
    for x in events:
        if not is_open(x):
            end = _date(x.get("ended_on") or x.get("half_life_date") or "")
            if not end or (today - end).days > RECENT_ENDED_DAYS:
                continue
        if want & {k.replace(" ", "") for k in x.get("keywords") or []}:
            return x
    return None


def check_new(n, events_by_id, heads, open_count, today, candidates=None):
    nid = str(n.get("id", "")).strip()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,39}", nid):
        return None, "id 형식(영문 소문자·숫자·하이픈) 아님"
    if nid in events_by_id:
        return None, "이미 있는 id"
    name = str(n.get("name", "")).strip()
    if not 2 <= len(name) <= 30:
        return None, "name은 2~30자"
    for field, allowed in (("layer", LAYER), ("phase", PHASE), ("intensity", INTENSITY)):
        if n.get(field) not in allowed:
            return None, f"{field} 허용값 아님"
    trig = _date(n.get("trigger_date"))
    if trig is None or trig > today or (today - trig).days > NEW_EVENT_MAX_AGE:
        return None, f"trigger_date는 최근 {NEW_EVENT_MAX_AGE}일 안의 날짜"
    assets = [a for a in n.get("assets") or [] if a in ASSETS]
    kws = [k.strip() for k in n.get("keywords") or [] if isinstance(k, str) and 2 <= len(k.strip()) <= 20]
    if not assets or not 2 <= len(kws) <= 4:
        return None, "assets 1개 이상·keywords 2~4개 필요"
    dup = _overlap(kws, events_by_id.values(), today)
    if dup:
        return None, f"'{dup.get('name')}'와 검색어가 겹침 — 새로 만들지 말고 그 내러티브를 갱신"
    # 바로 추가하려면 근거가 넉넉하고 최근 3일 기사가 있어야 한다 — 이틀 넘게 이어진 후보는 기준을 낮춘다
    # (10/11: 10/4~10/6 기사 3건만으로 하루짜리 후보 '러시아 페스트'가 바로 진행 중 내러티브로 들어갔음)
    cand = (candidates or {}).get(cand_key(n.get("from_candidate") or ""))
    need, src, fresh = (2, 2, 1) if cand and cand.get("days_seen", 0) >= 2 else (4, 3, 2)
    ev, n_src = _evidence(n.get("evidence"), heads)
    if len(ev) < need or n_src < src or _fresh_sources(ev, heads, today) < fresh:
        return None, (f"새 내러티브는 기사 {need}개 이상·매체 {src}곳 이상, 그중 최근 {FRESH_DAYS}일 기사 매체 {fresh}곳 이상 필요"
                      " — 못 미치면 후보로")
    if open_count >= MAX_OPEN:
        return None, f"진행 중 내러티브가 이미 {MAX_OPEN}개"
    event = {"id": nid, "name": name, "layer": n["layer"], "layer_secondary": None, "phase": n["phase"],
             "status": "active", "intensity": n["intensity"], "trigger_date": trig.isoformat(), "peak_date": None,
             "half_life_date": None, "assets": assets, "keywords": kws, "reignition_triggers": [],
             "notes": "", "last_auto": None,
             "added_by": "gemini", "added_on": today.isoformat()}
    if cand:
        event["candidate_since"] = cand.get("first_seen")
    latest = max(ev, key=lambda i: heads[i].get("date") or "")
    event["headline"] = {k: heads[latest][k] for k in ("title", "source", "date", "url")}
    return {"event": event, "evidence": ev, "candidate": cand_key(n.get("from_candidate") or "") if cand else None}, None


def _evi_detail(ids, heads):
    return [{k: heads[i][k] for k in ("title", "source", "date", "url")} for i in ids]


def _set_status(e, status, today):
    if status == "dormant":
        e["dormant_since"] = today.isoformat()
        e["half_life_date"] = e.get("half_life_date") or today.isoformat()
    elif status == "active":
        e.pop("dormant_since", None)
        e["half_life_date"] = None
    elif status == "ended":
        e["ended_on"] = today.isoformat()
        e["half_life_date"] = e.get("half_life_date") or today.isoformat()
        e.pop("dormant_since", None)
    e["status"] = status


def apply_proposal(proposal, events, heads, log, today, model, fade=None, candidates=None):
    """검사를 통과한 것만 events에 반영. 반환: (새 로그 항목들, 반영 수).
    판정마다 events[i]["last_review"]에 날짜·판정·이유를 남긴다 — 바꾼 게 없어도 '오늘 봤고 유지'가 화면에 보이게."""
    by_id = {e["id"]: e for e in events}
    cooled = recent_changes(log, today)
    entries, applied, retired, noted, seen, rebutted = [], 0, 0, 0, set(), {}
    stamp = today.isoformat()
    items = [u for u in (proposal.get("reviews") or []) + (proposal.get("updates") or [])]
    n_open = sum(is_open(e) for e in events)

    for u in items[: n_open + MAX_UPDATES]:
        if not isinstance(u, dict):
            entries.append({"date": stamp, "by": "gemini", "model": model, "event_id": None, "kind": "update",
                            "reason": "", "status": "rejected", "reject_reason": "형식 오류"})
            continue
        eid = u.get("id")
        entry = {"date": stamp, "by": "gemini", "model": model, "event_id": eid, "kind": "update",
                 "verdict": _verdict(u), "reason": clean_note(u.get("reason", ""))[:200]}
        if eid not in seen and entry["verdict"] in (None, "keep", "up", "down", "reignite"):
            ev_ids, _ = _evidence(u.get("evidence"), heads)
            rebutted[eid] = _fresh_sources(ev_ids, heads, today) >= 2
        if eid in seen:
            entries.append({**entry, "status": "rejected", "reject_reason": "같은 내러티브 중복 판정"})
            continue
        seen.add(eid)
        res, why = check_update(u, by_id, heads, cooled, today, fade, MAX_RETIRE - retired)
        if res and res["change"].get("status") != "ended" and _structural(res["change"]) and applied >= MAX_UPDATES:
            res, why = None, f"한 번에 {MAX_UPDATES}개까지만"
        if res is None:
            entries.append({**entry, "status": "rejected", "reject_reason": why})
            continue
        e = by_id[eid]
        verdict = res["verdict"]
        e["last_review"] = {"date": stamp, "by": "gemini", "verdict": VERDICT.get(verdict, "갱신"),
                            "reason": entry["reason"][:160]}
        if res.get("headline"):
            e["headline"] = _evi_detail([res["headline"]], heads)[0]
        if not res["change"]:
            continue  # 유지 — 기록 줄은 만들지 않고 last_review만
        fields = {}
        for k, v in res["change"].items():
            if k == "status":
                fields[k] = [e.get(k), v]
                _set_status(e, v, today)
            else:
                fields[k] = [e.get(k), v]
                e[k] = v
        cooled.add(eid)
        if res["change"].get("status") == "ended":
            retired += 1
        elif _structural(res["change"]):
            applied += 1
        noted += 1
        entries.append({**entry, "status": "applied", "changes": fields, "evidence": _evi_detail(res["evidence"], heads),
                        **({"dropped": res["dropped"]} if res["dropped"] else {})})

    # 지표가 '식었다'고 본 내러티브를 Gemini가 최근 기사로 반박하지 못했으면 제안대로 — 판정을 안 냈어도 마찬가지.
    # 한 번에 절반 넘게 식었다고 나오면 지표 쪽(기사 수집) 문제일 가능성이 커서 이번엔 적용하지 않는다
    suggested = [k for k, f in (fade or {}).items() if f.get("제안")]
    if len(suggested) > max(2, n_open // 2):
        print(f"::warning title=식음 제안 보류::{len(suggested)}/{n_open}개가 한꺼번에 식었다고 나옴 — 기사 수집 이상 가능성, 이번엔 제안 미적용")
        fade = {}
    for eid, f in (fade or {}).items():
        sug, e = f.get("제안"), by_id.get(eid)
        if not sug or e is None or e.get("auto_lock") or not is_open(e) or eid in cooled or rebutted.get(eid):
            continue
        new = "dormant" if sug == "dormant" else "ended"
        if e["status"] == new or (new == "ended" and retired >= MAX_RETIRE):
            continue
        reason = (f"언급이 줄었는데(7일 기사 {f.get('기사_7일')}건, 정점 대비 {f.get('언급_정점대비')}) Gemini가 이어진다는 "
                  f"최근 {FRESH_DAYS}일 기사(매체 2곳)를 대지 않아 {_ro(VERDICT[sug])}")
        old = e["status"]
        _set_status(e, new, today)
        e["last_review"] = {"date": stamp, "by": "rule", "verdict": VERDICT[sug], "reason": reason[:160]}
        entries.append({"date": stamp, "by": "rule", "event_id": eid, "kind": "update", "verdict": sug, "status": "applied",
                        "reason": reason, "changes": {"status": [old, new]}})
        retired += new == "ended"
        noted += 1

    open_count = sum(is_open(e) for e in events)
    added = 0
    for n in proposal.get("new_events") or []:
        res, why = check_new(n, by_id, heads, open_count, today, candidates) if isinstance(n, dict) else (None, "형식 오류")
        entry = {"date": stamp, "by": "gemini", "model": model, "event_id": (n or {}).get("id") if isinstance(n, dict) else None,
                 "kind": "new", "name": (n or {}).get("name") if isinstance(n, dict) else None,
                 "reason": clean_note((n or {}).get("reason", ""))[:200] if isinstance(n, dict) else ""}
        if res and added >= MAX_NEW:
            res, why = None, f"새 내러티브는 한 번에 {MAX_NEW}개까지만"
        if res is None:
            entries.append({**entry, "status": "rejected", "reject_reason": why})
            continue
        res["event"]["last_review"] = {"date": stamp, "by": "gemini", "verdict": "추가", "reason": entry["reason"][:160]}
        events.insert(0, res["event"])
        by_id[res["event"]["id"]] = res["event"]
        open_count += 1
        added += 1
        if res.get("candidate") and candidates is not None:
            candidates.pop(res["candidate"], None)
        entries.append({**entry, "status": "applied", "evidence": _evi_detail(res["evidence"], heads)})
    return entries, noted + added


# ───────────────────────────── 지켜보는 후보

def cand_key(name):
    return re.sub(r"[\s\W_]+", "", str(name or "")).lower()[:40]


def update_candidates(cands, proposed, heads, today):
    """cands: {key: 후보} (제자리 수정). 오늘 제안된 후보를 쌓고, 오래 안 보인 것은 지운다. 반환: 정렬된 목록"""
    for c in (proposed or [])[:3]:
        if not isinstance(c, dict):
            continue
        name = str(c.get("name", "")).strip()[:30]
        ev, _ = _evidence(c.get("evidence"), heads)
        key = cand_key(name)
        if len(key) < 2 or not ev:
            continue
        cur = cands.get(key)
        if cur is None:
            cur = cands[key] = {"key": key, "name": name, "first_seen": today.isoformat(), "days_seen": 0, "last_seen": ""}
        if cur["last_seen"] != today.isoformat():
            cur["days_seen"] += 1
        cur.update(last_seen=today.isoformat(), why=clean_note(c.get("why", ""))[:160], evidence=_evi_detail(ev[:3], heads))
    for k in [k for k, c in cands.items() if (today - _date(c["last_seen"])).days > CANDIDATE_TTL]:
        cands.pop(k)
    ranked = sorted(cands.values(), key=lambda c: (c["last_seen"], c["days_seen"]), reverse=True)[:MAX_CANDIDATES]
    keep = {c["key"] for c in ranked}
    for k in [k for k in cands if k not in keep]:
        cands.pop(k)
    return ranked


# ───────────────────────────── PMI

def pmi_due(manual, today):
    """ISM은 매달 첫 영업일에 전달 지표를 낸다 — 전달 값이 아직 없고 오늘이 2일 이후면 확인할 때."""
    as_of = _date((manual.get("ism_pmi") or {}).get("as_of"))
    first = today.replace(day=1)
    prev_month = (first - datetime.timedelta(days=1)).replace(day=1)
    return today.day >= 2 and (as_of is None or as_of < prev_month)


def check_pmi(p, heads, manual, today):
    if not isinstance(p, dict) or p.get("value") is None:
        return None, "수치 없음"
    try:
        v = round(float(p["value"]), 1)
    except (TypeError, ValueError):
        return None, "수치 형식 오류"
    month = _date(f"{p.get('month', '')}-01")
    ev, _ = _evidence(p.get("evidence"), heads)
    if not ev:
        return None, "근거 기사 없음"
    if not any(re.search(rf"(?<![\d.]){re.escape(str(v))}(?![\d])", heads[i]["title"]) and "PMI" in heads[i]["title"].upper() for i in ev):
        return None, f"근거 기사 제목에 PMI {v}가 그대로 없음"
    if not 30 <= v <= 70 or month is None or month >= today.replace(day=1):
        return None, "수치·달 범위 이상"
    old = manual.get("ism_pmi") or {}
    old_as_of = _date(old.get("as_of"))
    if old_as_of and month <= old_as_of:
        return None, "이미 같은 달 또는 더 최근 값이 있음"
    if old.get("value") is not None and abs(v - float(old["value"])) > 6:
        return None, "전달 대비 6포인트 넘게 차이 — 사람 확인 필요"
    h = heads[ev[0]]
    return {"value": v, "as_of": month.isoformat(),
            "source": f"ISM Manufacturing PMI — {h['source']} '{h['title']}' ({h['date']}), Gemini 추출·제목 일치 확인",
            "url": h["url"], "updated_by": "gemini", "updated_on": today.isoformat()}, None


# ───────────────────────────── 실행

KST = datetime.timezone(datetime.timedelta(hours=9))


def run_stamp():
    """언제·어떻게 돌았나 — 화면 '마지막 자동 점검' 줄용. trigger: schedule(예약) · workflow_dispatch(수동) · local"""
    return {"at": datetime.datetime.now(KST).isoformat(timespec="minutes"),
            "trigger": os.environ.get("GITHUB_EVENT_NAME") or "local"}


def review_narratives(today, events, log, notes):
    """내러티브 정리 한 번 — 반환: 새 로그 항목들 (events·후보 파일은 제자리 수정·저장)"""
    heads, head_counts = gather_headlines(events)
    if len(heads) < 5:
        print(f"::warning title=Gemini 관리 건너뜀::기사를 {len(heads)}건밖에 못 받음 (Google News RSS)")
        return []
    fade = fade_stats(events, head_counts, today)
    cands = {c["key"]: c for c in load_json(CANDIDATES_PATH, []) if isinstance(c, dict) and c.get("key")}
    prompt = build_prompt(today, events, heads, fade, sorted(cands.values(), key=lambda c: c["last_seen"], reverse=True))
    r = gemini_api.generate(prompt, max_tokens=8192, json_mode=True, thinking_budget=THINKING_BUDGET)
    proposal = gemini_api.extract_json(r["text"])
    notes.append(gemini_api.usage_line(r))
    if r.get("fallbacks"):
        notes.append("앞 모델 실패: " + " | ".join(x[:90] for x in r["fallbacks"][-2:]))
    if not isinstance(proposal, dict):
        why = "출력 토큰 한도에 걸려 답이 잘림" if r.get("finish") == "MAX_TOKENS" else "JSON이 아닌 답"
        print(f"::warning title=Gemini 응답 해석 실패::{why} — {gemini_api.usage_line(r)}; 앞부분 {r['text'][:200]!r}")
        proposal = {}

    entries, n = apply_proposal(proposal, events, heads, log, today, r["model"], fade, cands)
    ranked = update_candidates(cands, proposal.get("candidates"), heads, today)
    reviewed = {e["id"]: (e.get("last_review") or {}).get("verdict") for e in events
                if (e.get("last_review") or {}).get("date") == today.isoformat() and (e.get("last_review") or {}).get("by") in ("gemini", "rule")}
    missing = [e["id"] for e in events if is_open(e) and e["id"] not in reviewed and not e.get("auto_lock")]
    tally = defaultdict(int)
    for v in reviewed.values():
        tally[v] += 1
    notes.append(f"모델 {r['model']} · 기사 {len(heads)}건(목록 밖 {sum(h['group'].startswith('top:') for h in heads.values())})"
                 f" · 판정 {dict(tally)} · 반영 {n}건 · 후보 {len(ranked)}개" + (f" · 판정 빠짐 {missing}" if missing else ""))
    if proposal.get("summary") or reviewed:
        entries.append({"date": today.isoformat(), "by": "gemini", "model": r["model"], "kind": "summary", "status": "info",
                        "reason": clean_note(proposal.get("summary") or "")[:300], "reviews": reviewed,
                        "candidates": [c["name"] for c in ranked], **run_stamp()})
    if reviewed or n:
        save_json(EVENTS_PATH, events)
    save_json(CANDIDATES_PATH, ranked)
    return entries


def main():
    # 한국 날짜 — 예약 실행이 한국시간 새벽~오전에 흩어져 돌아도(UTC로는 날짜가 바뀌기도 함) 하루 한 번만 정리하게
    today = datetime.datetime.now(KST).date()
    if gemini_api.key_status() != "ok":
        print("::warning title=Gemini 관리 건너뜀::GEMINI_API_KEY가 없음 — 저장소 Settings → Secrets and variables → Actions에 등록")
        return
    events = load_json(EVENTS_PATH, [])
    log = load_json(LOG_PATH, [])
    manual = load_json(MANUAL_PATH, {})
    new_entries, notes = [], []
    # 하루 한 번만 — 수동 실행 뒤 예약 실행이 또 돌아도 같은 날 판정이 겹치지 않게 (GEMINI_FORCE=1이면 다시).
    # 실패 기록(status=error)은 세지 않는다 — 쿼터 등으로 실패했으면 같은 날 다음 실행이 다시 시도한다
    if not DRY_RUN and os.environ.get("GEMINI_FORCE") != "1" and any(
            x.get("by") == "gemini" and x.get("kind") == "summary" and x.get("status") == "info"
            and x.get("date") == today.isoformat() for x in log):
        print(f"::notice title=Gemini 관리::오늘({today}) 이미 검토함 — 건너뜀")
        return

    try:
        new_entries += review_narratives(today, events, log, notes)
    except gemini_api.GeminiError as e:
        print(f"::warning title=Gemini 내러티브 관리 실패::{e}")
        # 화면 '마지막 자동 점검' 줄에 실패도 보이게 — 이유는 짧게(모델 이름·HTTP 코드 정도)
        new_entries.append({"date": today.isoformat(), "by": "gemini", "kind": "summary", "status": "error",
                            "reason": "Gemini 호출 실패 — " + ("하루 한도 소진" if "한도" in str(e) or "429" in str(e) else str(e)[:120]),
                            **run_stamp()})

    if pmi_due(manual, today) or os.environ.get("GEMINI_FORCE_PMI") == "1":
        pmi_heads = {f"h{i + 1}": {**a, "group": "pmi"} for i, a in enumerate(
            news_feed.headlines("ISM manufacturing PMI", "en", days=10, limit=10)
            + news_feed.headlines("ISM 제조업 PMI", "ko", days=10, limit=5))}
        try:
            r = gemini_api.generate(PMI_PROMPT.format(headlines=format_headlines(pmi_heads)), max_tokens=512, json_mode=True,
                                    thinking_budget=0)
            res, why = check_pmi(gemini_api.extract_json(r["text"]), pmi_heads, manual, today)
            entry = {"date": today.isoformat(), "by": "gemini", "model": r["model"], "kind": "pmi", "event_id": None}
            if res:
                old = manual.get("ism_pmi") or {}
                manual["ism_pmi"] = {**old, **res}
                save_json(MANUAL_PATH, manual)
                new_entries.append({**entry, "status": "applied", "changes": {"ism_pmi": [old.get("value"), res["value"]]},
                                    "reason": f"{res['as_of'][:7]} ISM 제조업 PMI {res['value']}",
                                    "evidence": [{"title": "", "source": "", "date": "", "url": res["url"]}]})
                notes.append(f"PMI {res['value']} ({res['as_of'][:7]}) 반영")
            else:
                new_entries.append({**entry, "status": "rejected", "reject_reason": why})
                notes.append(f"PMI 미반영: {why}")
        except gemini_api.GeminiError as e:
            print(f"::warning title=Gemini PMI 확인 실패::{e}")

    if new_entries:
        save_json(LOG_PATH, (log + new_entries)[-LOG_KEEP:])
    applied = [x for x in new_entries if x.get("status") == "applied"]
    rejected = [x for x in new_entries if x.get("status") == "rejected"]
    summary = next((x for x in new_entries if x.get("kind") == "summary"), {})
    detail = "%0A".join(
        [f"반영 · {x.get('event_id') or x.get('kind')} [{x.get('verdict') or x.get('kind')}]: {x.get('changes') or x.get('name') or ''}"
         for x in applied]
        + [f"거절 · {x.get('event_id') or x.get('kind')} [{x.get('verdict') or x.get('kind')}]: {x.get('reject_reason')}" for x in rejected]
        + [f"판정 · {k}: {v}" for k, v in (summary.get("reviews") or {}).items()]
        + [f"후보 · {c}" for c in summary.get("candidates") or []])
    title = "Gemini 관리 (dry-run, 파일 안 씀)" if DRY_RUN else "Gemini 관리"
    print(f"::notice title={title}::{' · '.join(notes) or '호출 없음'}" + (f"%0A요약: {summary.get('reason')}" if summary.get("reason") else "")
          + (f"%0A{detail}" if detail else ""))


if __name__ == "__main__":
    main()
