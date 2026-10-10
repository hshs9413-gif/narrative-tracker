"""Gemini 무료 모델로 내러티브 목록(events.json)과 PMI 수동값을 매일 관리한다 (수집 워크플로에서 실행).

흐름
  1) 기사 모으기 — 진행 중 내러티브별 키워드 기사 + 급증한 글로벌 워치리스트 기사 + 시장 전반 기사를
     Google News RSS로 직접 받아 h1, h2 … 번호를 붙인다 (news_feed.py). 무료 등급은 검색 그라운딩이 막혀 있다.
  2) Gemini 1회 호출 — 현재 목록·언급량·시장 지표·기사 목록을 주고, 바꿀 것과 새 내러티브를 JSON으로 받는다.
     근거는 기사 번호로만 댈 수 있어 없는 기사를 지어낼 수 없다.
  3) 규칙 검사 후 반영 — 허용 값·근거 수·매체 수·한 번에 바꿀 수 있는 폭·쿨다운을 코드가 확인하고,
     통과한 것만 events.json에 쓴다. 통과 못 한 제안도 이유와 함께 기록한다.
  4) PMI — 새 달 ISM 발표가 나올 때가 되면 기사 제목에서 수치를 뽑게 하고, 그 숫자가 근거 기사 제목에
     그대로 있을 때만 manual_inputs.json에 반영한다.
  5) 기록 — 모든 변경·거절을 docs/data/narrative_log.json에 남긴다(대시보드 '갱신 기록').

실패해도(키 없음·쿼터·응답 이상) 경고만 남기고 0으로 끝난다 — 수집·커밋을 막지 않는다.
사람이 막고 싶은 이벤트는 events.json에서 "auto_lock": true 로 두면 Gemini도 건드리지 않는다.
"""

import csv
import datetime
import json
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))

import gemini_api  # noqa: E402
import news_feed  # noqa: E402

BASE = os.path.join(os.path.dirname(__file__), "..")
DATA = os.path.join(BASE, "docs", "data")
EVENTS_PATH = os.path.join(DATA, "events.json")
LOG_PATH = os.path.join(DATA, "narrative_log.json")
MANUAL_PATH = os.path.join(DATA, "manual_inputs.json")
ATTENTION_PATH = os.path.join(DATA, "attention.csv")
WATCH_PATH = os.path.join(DATA, "watchlist_attention.csv")
SCAN_PATH = os.path.join(DATA, "scan_keywords.json")
MARKET_PATH = os.path.join(DATA, "market_snapshot.csv")
REGIME_PATH = os.path.join(DATA, "regime_state.json")

STATUS = ("active", "dormant", "ended")
PHASE = ("shock", "overshoot", "correction")
INTENSITY = ("low", "mid", "high")
LAYER = ("cyclical", "structural", "political")
ASSETS = ("dollar", "us10y", "bonds", "gold", "oil", "equity", "equity_bigtech", "semiconductor",
          "power_infra", "kospi", "krw", "yen", "vix", "credit")

MAX_UPDATES = 3          # 한 번에 고칠 수 있는 기존 내러티브 수
MAX_NEW = 2              # 한 번에 추가할 수 있는 새 내러티브 수
MAX_OPEN = 12            # active+dormant 상한
COOLDOWN_DAYS = 3        # 같은 내러티브를 Gemini가 다시 바꾸기까지 최소 간격
NEW_EVENT_MAX_AGE = 180  # 새 내러티브 trigger_date는 최근 180일 안
NOTE_MAX = 220
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


# ───────────────────────────── 자료 모으기

def attention_summary(today, days=14):
    by = defaultdict(list)
    if os.path.exists(ATTENTION_PATH):
        with open(ATTENTION_PATH, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                by[r["event_id"]].append((r["date"], int(float(r["count"] or 0))))
    return {k: [c for _, c in sorted(v)[-days:]] for k, v in by.items()}


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
    """{id: 기사} — 진행 중 내러티브별 + 급증 워치리스트 + 시장 전반"""
    items, seen = [], set()

    def add(group, arts):
        for a in arts:
            key = re.sub(r"\W+", "", a["title"])[:60]
            if key in seen:
                continue
            seen.add(key)
            items.append({**a, "group": group})

    for e in events:
        if e.get("status") == "ended" or not e.get("keywords"):
            continue
        add(e["id"], news_feed.headlines(news_feed.or_query(e["keywords"]), "ko", days=7, limit=8, session=session))
    for kw in rising_watchlist():
        add(f"watch:{kw['id']}", news_feed.headlines(kw["query"], "en", days=7, limit=5, session=session))
    add("market:ko", news_feed.headlines("증시 OR 환율 OR 국채금리 OR 유가", "ko", days=3, limit=10, session=session))
    add("market:en", news_feed.headlines("stocks OR bonds OR oil markets", "en", days=3, limit=10, session=session))
    return {f"h{i + 1}": a for i, a in enumerate(items)}


# ───────────────────────────── 프롬프트

PROMPT = """당신은 거시경제 내러티브 트래커의 관리자입니다. 오늘은 {today}입니다.
아래 [기사] 목록만 근거로 [내러티브 목록]을 최신 상태로 유지하세요. 기사에 없는 사실은 쓰지 마세요.

## 필드 뜻
- status: active(시장에 계속 영향) | dormant(잠잠하지만 재점화 가능) | ended(끝남)
- phase: shock(새 충격·재격화) | overshoot(과열·과잉반응) | correction(진정·정상화)
- intensity(지금의 시장 영향): low | mid | high — high는 관련 자산이 크게 움직이고 주요 매체가 연일 다룰 때만
- layer: cyclical(경기·금리 순환) | structural(수년 단위 구조 테마) | political(정치·지정학)
- assets 허용값: {assets}

## 할 일
1. 진행 중(active/dormant) 내러티브마다 바뀐 게 있는지 판단. 바뀐 것만 updates에 넣으세요.
   - status·phase를 바꾸려면 서로 다른 매체 기사 2개 이상을 근거로.
   - intensity는 한 단계씩만(low↔mid↔high).
   - keywords: 언급량이 매일 100에 가깝게 포화되거나 0에 가까우면 더 구체적인 한국어 검색어 2~4개로 교체 제안.
     몇 주 이상 쓸 수 있는 일반 표현으로(특정 인물 발언·하루짜리 사건 이름 금지).
   - notes_append: 이번에 새로 확인한 사실 한 문장(200자 이내, 날짜 포함). 근거 기사 제목에 있는 사실만 쓰고,
     '사상 최고'·'최초' 같은 표현이나 수치는 제목에 그대로 있을 때만 쓰세요. 추측·과장 금지.
2. 목록에 없는데 여러 매체가 며칠째 다루고 자산 가격도 반응한 새 내러티브가 있으면 new_events에(최대 2개).
   근거 기사 3개 이상(매체 2곳 이상). 일회성 뉴스는 넣지 마세요.
3. 확실하지 않으면 넣지 마세요 — 잘못 바꾸는 것이 안 바꾸는 것보다 해롭습니다.

## 출력 (JSON만)
{{"updates": [{{"id": "기존 id", "status": "...", "phase": "...", "intensity": "...", "peak_date": "YYYY-MM-DD",
   "keywords": ["..."], "notes_append": "...", "reason": "한 문장", "evidence": ["h3", "h7"]}}],
 "new_events": [{{"id": "english-kebab-2026", "name": "한국어 이름(30자 이내)", "layer": "...", "phase": "...",
   "intensity": "...", "trigger_date": "YYYY-MM-DD", "assets": ["..."], "keywords": ["한국어 검색어 2~4개"],
   "notes": "한 문장", "reason": "한 문장", "evidence": ["h1", "h2", "h5"]}}],
 "summary": "오늘 판단 요약 한두 문장"}}
updates의 각 항목에는 바꿀 필드만 넣으세요. 바꿀 게 없으면 빈 배열.

[현재 레짐 판정]
{regime}

[시장 지표]
{market}

[내러티브 목록]
{events}

[최근 14일 언급량(기사 수, 오래된→최근)]
{attention}

[기사] (id: 날짜 · 매체 · 제목 · 묶음)
{headlines}
"""

PMI_PROMPT = """아래 기사 목록에서 미국 ISM 제조업 PMI의 가장 최근 발표치를 찾으세요.
기사 제목에 수치가 그대로 있는 경우만 답하고, 없으면 value를 null로.
JSON만: {{"value": 54.5, "month": "YYYY-MM(지표가 가리키는 달)", "released": "YYYY-MM-DD", "evidence": ["h2"]}}

[기사]
{headlines}
"""


def compact_events(events):
    keep = ("id", "name", "layer", "status", "phase", "intensity", "trigger_date", "peak_date", "assets", "keywords")
    out = []
    for e in events:
        row = {k: e.get(k) for k in keep}
        row["notes"] = (e.get("notes") or "")[-300:]
        out.append(row)
    return out


def format_headlines(heads):
    return "\n".join(f"{hid}: {h['date']} · {h['source']} · {h['title']} · {h['group']}" for hid, h in heads.items())


# ───────────────────────────── 규칙 검사

def _date(s):
    try:
        return datetime.date.fromisoformat(str(s))
    except ValueError:
        return None


def _evidence(ids, heads):
    ok = [i for i in dict.fromkeys(ids or []) if i in heads]
    return ok, len({heads[i]["source"] or heads[i]["url"] for i in ok})


def recent_changes(log, today, days=COOLDOWN_DAYS):
    since = (today - datetime.timedelta(days=days)).isoformat()
    # Gemini 자신의 변경과 사람이 직접 고친 내러티브만 쉬게 둔다 — 출처를 붙인 검증(claude)·규칙 전환은 막지 않음
    # (10/11: 검증 수정까지 막았더니 모든 내러티브가 사흘간 메모 말고는 못 바뀌어 '그대로'로 보였음)
    return {x["event_id"] for x in log if x.get("by") in ("gemini", "human") and x.get("status") == "applied"
            and x.get("date", "") > since and x.get("event_id")}


def check_update(u, events_by_id, heads, cooled, today):
    """(바꿀 필드 dict, 거절 사유 or None)"""
    eid = u.get("id")
    e = events_by_id.get(eid)
    if e is None:
        return None, "목록에 없는 id"
    if e.get("status") == "ended":
        return None, "끝난 내러티브는 바꾸지 않음"
    if e.get("auto_lock"):
        return None, "auto_lock으로 잠김"
    ev, n_src = _evidence(u.get("evidence"), heads)
    if eid in cooled:
        # 쿨다운 중엔 상태·단계·강도·검색어는 그대로 두고, 새로 확인된 사실 메모만 받는다
        note = (u.get("notes_append") or "").strip()
        if note and ev:
            return {"change": {"notes_append": note[:NOTE_MAX]}, "evidence": ev}, None
        return None, f"최근 {COOLDOWN_DAYS}일 안에 이미 바꿈"
    if not ev:
        return None, "근거 기사 없음"
    change = {}
    for field, allowed in (("status", STATUS), ("phase", PHASE), ("intensity", INTENSITY)):
        v = u.get(field)
        if v is None or v == e.get(field):
            continue
        if v not in allowed:
            return None, f"{field} 허용값 아님: {v}"
        change[field] = v
    if ("status" in change or "phase" in change) and n_src < 2:
        return None, "상태·단계 변경은 서로 다른 매체 기사 2개 이상 필요"
    if "intensity" in change and abs(INTENSITY.index(change["intensity"]) - INTENSITY.index(e.get("intensity", "low"))) > 1:
        return None, "강도는 한 단계씩만"
    if u.get("peak_date") and u["peak_date"] != e.get("peak_date"):
        pd = _date(u["peak_date"])
        trig = _date(e.get("trigger_date"))
        if pd is None or pd > today or (trig and pd < trig):
            return None, "peak_date가 유효하지 않음"
        change["peak_date"] = pd.isoformat()
    if u.get("keywords") is not None:
        kws = [k.strip() for k in u["keywords"] if isinstance(k, str) and 2 <= len(k.strip()) <= 20]
        if not 2 <= len(kws) <= 5:
            return None, "keywords는 2~5개(각 2~20자)"
        if kws != e.get("keywords"):
            change["keywords"] = kws
    note = (u.get("notes_append") or "").strip()
    if note:
        change["notes_append"] = note[:NOTE_MAX]
    if not change:
        return None, "바뀐 내용 없음"
    return {"change": change, "evidence": ev}, None


def check_new(n, events_by_id, heads, open_count, today):
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
    ev, n_src = _evidence(n.get("evidence"), heads)
    if len(ev) < 3 or n_src < 2:
        return None, "새 내러티브는 기사 3개 이상·매체 2곳 이상 필요"
    if open_count >= MAX_OPEN:
        return None, f"진행 중 내러티브가 이미 {MAX_OPEN}개"
    event = {"id": nid, "name": name, "layer": n["layer"], "layer_secondary": None, "phase": n["phase"],
             "status": "active", "intensity": n["intensity"], "trigger_date": trig.isoformat(), "peak_date": None,
             "half_life_date": None, "assets": assets, "keywords": kws, "reignition_triggers": [],
             "notes": str(n.get("notes") or "")[:NOTE_MAX], "last_auto": None,
             "added_by": "gemini", "added_on": today.isoformat()}
    return {"event": event, "evidence": ev}, None


def append_note(old, text, today):
    """notes 끝에 '[MM-DD Gemini] …'를 붙이고, Gemini 메모는 최근 3개만 남긴다."""
    base, *gem = (old or "").split("\n[")
    gem = ["[" + g for g in gem] + [f"[{today.strftime('%m-%d')} Gemini] {text}"]
    return "\n".join([base] + gem[-3:]).strip()


def _evi_detail(ids, heads):
    return [{k: heads[i][k] for k in ("title", "source", "date", "url")} for i in ids]


def apply_proposal(proposal, events, heads, log, today, model):
    """검사를 통과한 것만 events에 반영. 반환: (새 로그 항목들, 반영 수)"""
    by_id = {e["id"]: e for e in events}
    cooled = recent_changes(log, today)
    entries, applied = [], 0
    stamp = today.isoformat()

    for u in (proposal.get("updates") or [])[: MAX_UPDATES * 2]:
        res, why = check_update(u, by_id, heads, cooled, today) if isinstance(u, dict) else (None, "형식 오류")
        entry = {"date": stamp, "by": "gemini", "model": model, "event_id": (u or {}).get("id") if isinstance(u, dict) else None,
                 "kind": "update", "reason": str((u or {}).get("reason", ""))[:200] if isinstance(u, dict) else ""}
        if res and applied >= MAX_UPDATES:
            res, why = None, f"한 번에 {MAX_UPDATES}개까지만"
        if res is None:
            entries.append({**entry, "status": "rejected", "reject_reason": why})
            continue
        e = by_id[u["id"]]
        fields = {}
        for k, v in res["change"].items():
            if k == "notes_append":
                fields["notes"] = ["…", v]
                e["notes"] = append_note(e.get("notes"), v, today)
            else:
                fields[k] = [e.get(k), v]
                e[k] = v
        e["last_review"] = {"date": stamp, "by": "gemini"}
        cooled.add(e["id"])
        applied += 1
        entries.append({**entry, "status": "applied", "changes": fields, "evidence": _evi_detail(res["evidence"], heads)})

    open_count = sum(e.get("status") in ("active", "dormant") for e in events)
    added = 0
    for n in proposal.get("new_events") or []:
        res, why = check_new(n, by_id, heads, open_count, today) if isinstance(n, dict) else (None, "형식 오류")
        entry = {"date": stamp, "by": "gemini", "model": model, "event_id": (n or {}).get("id") if isinstance(n, dict) else None,
                 "kind": "new", "name": (n or {}).get("name") if isinstance(n, dict) else None,
                 "reason": str((n or {}).get("reason", ""))[:200] if isinstance(n, dict) else ""}
        if res and added >= MAX_NEW:
            res, why = None, f"새 내러티브는 한 번에 {MAX_NEW}개까지만"
        if res is None:
            entries.append({**entry, "status": "rejected", "reject_reason": why})
            continue
        events.insert(0, res["event"])
        by_id[res["event"]["id"]] = res["event"]
        open_count += 1
        added += 1
        entries.append({**entry, "status": "applied", "evidence": _evi_detail(res["evidence"], heads)})
    return entries, applied + added


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

def main():
    today = datetime.date.today()
    if gemini_api.key_status() != "ok":
        print("::warning title=Gemini 관리 건너뜀::GEMINI_API_KEY가 없음 — 저장소 Settings → Secrets and variables → Actions에 등록")
        return
    events = load_json(EVENTS_PATH, [])
    log = load_json(LOG_PATH, [])
    manual = load_json(MANUAL_PATH, {})
    new_entries, notes = [], []
    # 하루 한 번만 — 수동 실행 뒤 예약 실행이 또 돌아도 같은 날 메모가 겹치지 않게 (GEMINI_FORCE=1이면 다시)
    if not DRY_RUN and os.environ.get("GEMINI_FORCE") != "1" and any(
            x.get("by") == "gemini" and x.get("kind") == "summary" and x.get("date") == today.isoformat() for x in log):
        print(f"::notice title=Gemini 관리::오늘({today}) 이미 검토함 — 건너뜀")
        return

    heads = gather_headlines(events)
    if len(heads) < 5:
        print(f"::warning title=Gemini 관리 건너뜀::기사를 {len(heads)}건밖에 못 받음 (Google News RSS)")
        return
    prompt = PROMPT.format(
        today=today.isoformat(), assets=", ".join(ASSETS),
        regime=json.dumps({k: (load_json(REGIME_PATH, {}).get(k) or {}).get("label") for k in ("growth_inflation", "credit_stress", "policy_stance")}, ensure_ascii=False),
        market=json.dumps(market_summary(), ensure_ascii=False),
        events=json.dumps(compact_events(events), ensure_ascii=False, indent=1),
        attention=json.dumps(attention_summary(today), ensure_ascii=False),
        headlines=format_headlines(heads))
    try:
        r = gemini_api.generate(prompt, max_tokens=8192, json_mode=True, thinking_budget=THINKING_BUDGET)
        proposal = gemini_api.extract_json(r["text"])
        notes.append(gemini_api.usage_line(r))
        if r.get("fallbacks"):
            notes.append("앞 모델 실패: " + " | ".join(x[:90] for x in r["fallbacks"][-2:]))
        if proposal is None:
            why = "출력 토큰 한도에 걸려 답이 잘림" if r.get("finish") == "MAX_TOKENS" else "JSON이 아닌 답"
            print(f"::warning title=Gemini 응답 해석 실패::{why} — {gemini_api.usage_line(r)}; 앞부분 {r['text'][:200]!r}")
            proposal = {}
        entries, n = apply_proposal(proposal, events, heads, log, today, r["model"])
        new_entries += entries
        notes.append(f"모델 {r['model']} · 기사 {len(heads)}건 · 제안 {len(entries)}건 중 반영 {n}건")
        if proposal.get("summary"):
            new_entries.append({"date": today.isoformat(), "by": "gemini", "model": r["model"], "kind": "summary",
                                "status": "info", "reason": str(proposal["summary"])[:300]})
        if n:
            save_json(EVENTS_PATH, events)
    except gemini_api.GeminiError as e:
        print(f"::warning title=Gemini 내러티브 관리 실패::{e}")

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
    detail = "%0A".join(
        [f"반영 · {x.get('event_id') or x.get('kind')}: {x.get('changes') or x.get('name') or ''}" for x in applied]
        + [f"거절 · {x.get('event_id') or x.get('kind')}: {x.get('reject_reason')}" for x in rejected])
    title = "Gemini 관리 (dry-run, 파일 안 씀)" if DRY_RUN else "Gemini 관리"
    summary = next((x["reason"] for x in new_entries if x.get("kind") == "summary"), "")
    print(f"::notice title={title}::{' · '.join(notes) or '호출 없음'}" + (f"%0A요약: {summary}" if summary else "")
          + (f"%0A{detail}" if detail else ""))


if __name__ == "__main__":
    main()
