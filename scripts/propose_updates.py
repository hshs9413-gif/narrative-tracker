"""
주간 내러티브 리뷰 제안 생성기 (Google Gemini API + 검색 그라운딩)

1) 정량 신호를 코드로 계산 (결정론적 — LLM 판단 아님)
   - 언급량 7일 평균 / 역대 정점 대비 비율  → 반감기·휴면 판정
   - 시장 지표 변동폭(VIX, 금, WTI, DXY)     → 강도(상/중/하) 산출
2) Gemini가 Google 검색으로 실제 웹을 조회해 위 판정을 교차 검증하고
   신규 내러티브를 탐지 (검색어와 출처 URL을 함께 반환)
3) 결과를 GitHub Issue로 등록 — events.json은 직접 수정하지 않음 (사람이 승인)

환경변수:
  GEMINI_API_KEY    : Google AI Studio에서 발급 (무료 티어 가능)
  GEMINI_MODEL      : (선택) 기본값 gemini-3.6-flash
  GITHUB_TOKEN      : Actions가 자동 제공
  GITHUB_REPOSITORY : Actions가 자동 제공 (owner/repo)

의존성: requests
"""

import csv
import datetime
import json
import os
import statistics
import sys
from collections import defaultdict

import requests

BASE = os.path.dirname(__file__)
EVENTS_PATH = os.path.join(BASE, "..", "docs", "data", "events.json")
ATTENTION_PATH = os.path.join(BASE, "..", "docs", "data", "attention.csv")
MARKET_PATH = os.path.join(BASE, "..", "docs", "data", "market_snapshot.csv")
SCAN_PATH = os.path.join(BASE, "..", "docs", "data", "scan_keywords.json")

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")
GEMINI_URL = ("https://generativelanguage.googleapis.com/v1beta/models/"
              "{model}:generateContent")


# ────────────────────────── 데이터 로드 ──────────────────────────

def load_csv(path):
    if not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# ────────────────────── 1) 정량 신호 계산 ──────────────────────

def attention_signals(events, attention_rows):
    """이벤트별 언급량 추이에서 반감기/휴면 신호를 계산."""
    by_event = defaultdict(list)
    for r in attention_rows:
        c = to_float(r.get("count"))
        if c is not None:
            by_event[r["event_id"]].append((r["date"], c))

    out = {}
    for e in events:
        series = sorted(by_event.get(e["id"], []))
        if len(series) < 3:
            out[e["id"]] = {"판정": "데이터 부족 — 상태 변경 제안 금지",
                            "관측일수": len(series)}
            continue

        counts = [c for _, c in series]
        recent_avg = statistics.mean(counts[-7:])

        peaks = [statistics.mean(counts[max(0, i - 6):i + 1]) for i in range(len(counts))]
        peak_avg = max(peaks)
        peak_date = series[peaks.index(peak_avg)][0]
        ratio = (recent_avg / peak_avg) if peak_avg else 0

        if ratio < 0.25:
            suggested = "dormant 전환 제안"
        elif ratio < 0.5:
            suggested = "반감기 도달 — 강도 하향 검토"
        else:
            suggested = "active 유지"

        out[e["id"]] = {
            "관측일수": len(counts),
            "최근7일평균": round(recent_avg, 1),
            "정점7일평균": round(peak_avg, 1),
            "정점일": peak_date,
            "정점대비": f"{ratio:.0%}",
            "코드판정": suggested,
        }
    return out


def market_signals(market_rows):
    """최근 시장 지표 변동폭 — 강도 판정의 정량 앵커."""
    if len(market_rows) < 2:
        return {"판정": "시장 데이터 부족 (2일 이상 필요)"}

    def pct_change(col, lookback):
        if len(market_rows) <= lookback:
            return None
        cur = to_float(market_rows[-1].get(col))
        prev = to_float(market_rows[-1 - lookback].get(col))
        if cur is None or prev is None or prev == 0:
            return None
        return round((cur / prev - 1) * 100, 2)

    sig = {"기준일": market_rows[-1]["date"]}
    for col, label in [("vix", "VIX"), ("gold", "금"), ("wti", "WTI"),
                       ("dxy_ice", "달러DXY"), ("us10y", "미10년물")]:
        d1, d5 = pct_change(col, 1), pct_change(col, 5)
        sig[label] = {"1일": f"{d1}%" if d1 is not None else "—",
                      "5일": f"{d5}%" if d5 is not None else "—"}

    vix1 = pct_change("vix", 1) or 0
    big = sum(1 for c in ("gold", "wti", "dxy_ice") if abs(pct_change(c, 1) or 0) >= 5)
    if vix1 >= 15 or big >= 2:
        sig["코드강도판정"] = "high (상) — VIX 15%+ 급등 또는 2개 이상 자산군 5%+ 변동"
    elif abs(vix1) >= 5 or big >= 1:
        sig["코드강도판정"] = "mid (중) — 특정 자산군 유의미한 변동"
    else:
        sig["코드강도판정"] = "low (하) — 노이즈 수준"
    return sig


def load_scan_keywords():
    if os.path.exists(SCAN_PATH):
        with open(SCAN_PATH, encoding="utf-8") as f:
            return json.load(f)
    return ["연준 금리", "관세 무역전쟁", "지정학 리스크", "인플레이션", "원달러 환율"]


# ────────────────── 2) Gemini 검색 그라운딩 검증 ──────────────────

PROMPT = """당신은 매크로 내러티브 트래커의 주간 리뷰를 담당합니다.
오늘은 {today}입니다. **반드시 Google 검색을 사용해 최신 정보를 직접 확인한 뒤 답하세요.**

## 분류 체계
내러티브는 세 지층으로 나눕니다.
- political (정치/제도): 지정학, 중앙은행 독립성, 관세, 선거 — 불규칙 발생, 다른 층을 왜곡
- cyclical (경기순환): 금리, 인플레, 고용 — 수개월~수년 주기
- structural (구조테마): AI, 탈세계화, 에너지전환 — 수년 주기, 잘 안 뒤집힘

강도 기준:
- high(상): 당일 VIX 15%+ 급등 또는 자산 5%+ 변동, 2개 이상 자산군 동시반응, 헤드라인 2주+ 지속
- mid(중): 특정 자산군 국한 2~5% 변동, 1~2주 지속
- low(하): 1~2% 이내 노이즈, 며칠 내 소멸

## 현재 기록된 이벤트
{events}

## 코드가 계산한 언급량 신호 (Google News 기사 수 기반)
{attention}

## 코드가 계산한 시장 지표 변동
{market}

## 수행할 작업
1. 위 각 이벤트에 대해 **검색으로 현재 상황을 확인**하세요. 코드 판정이 실제 뉴스와 맞는지
   대조하고, 어긋나면 어느 쪽이 맞는지 근거와 함께 밝히세요.
2. 다음 주제들을 검색해 **기록되지 않은 신규 내러티브**가 있는지 확인하세요: {scan}
3. 각 판단의 근거가 된 기사·날짜를 reason에 구체적으로 적으세요.

## 출력 형식
아래 JSON만 출력하세요. 설명·인사말·코드펜스 없이 순수 JSON만 출력합니다.

{{
  "verification": [
    {{"id": "이벤트id", "code_says": "코드 판정 요약",
      "web_says": "검색으로 확인한 실제 상황",
      "agree": true,
      "comment": "일치/불일치 근거. 불일치면 어느 쪽이 맞는지"}}
  ],
  "status_changes": [
    {{"id": "이벤트id", "field": "status|intensity|half_life_date",
      "current": "현재값", "proposed": "제안값",
      "reason": "근거. 확인한 기사 내용과 날짜 포함"}}
  ],
  "new_candidates": [
    {{"name": "내러티브명", "layer": "political|cyclical|structural",
      "intensity": "high|mid|low", "keywords": ["키워드"],
      "trigger_date": "YYYY-MM-DD",
      "reason": "왜 신규 내러티브인지. 확인한 기사 근거 포함"}}
  ],
  "notes": "총평 2~3문장. 여러 층이 겹치는 국면인지 반드시 언급."
}}

## 주의
- 언급량이 '데이터 부족'인 이벤트는 status_changes에 넣지 마세요.
- 검색으로 확인되지 않은 내용은 추측해서 쓰지 마세요. 모르면 comment에 '확인 불가'라고 쓰세요.
- 일회성 단발 뉴스는 신규 내러티브로 제안하지 마세요. 여러 매체 반복 + 자산가격 반응이 필요합니다.
- 오탐이 누락보다 해롭습니다. 애매하면 제안하지 말고 notes에만 언급하세요."""


def extract_json(text):
    """마크다운 코드펜스나 앞뒤 설명이 섞여 있어도 JSON 객체를 추출."""
    cleaned = text.replace("```json", "").replace("```", "").strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(cleaned[start:end + 1])
        except json.JSONDecodeError:
            pass
    return None


def call_gemini(events, attention, market, scan):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("[WARN] GEMINI_API_KEY 없음 — 정량 신호만 보고합니다.", file=sys.stderr)
        return None, None

    prompt = PROMPT.format(
        today=datetime.date.today().isoformat(),
        events=json.dumps(events, ensure_ascii=False, indent=2),
        attention=json.dumps(attention, ensure_ascii=False, indent=2),
        market=json.dumps(market, ensure_ascii=False, indent=2),
        scan=", ".join(scan),
    )

    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        # 검색 그라운딩 활성화. 검색 도구는 다른 도구와 함께 쓸 수 없으므로 단독 사용.
        "tools": [{"google_search": {}}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 4096},
    }

    try:
        resp = requests.post(
            GEMINI_URL.format(model=GEMINI_MODEL),
            headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
            json=body,
            timeout=180,
        )
        resp.raise_for_status()
        data = resp.json()

        cand = (data.get("candidates") or [{}])[0]
        text = "".join(p.get("text", "") for p in cand.get("content", {}).get("parts", []))

        # 그라운딩 메타데이터에서 실제 검색어와 출처 추출
        meta = cand.get("groundingMetadata", {}) or {}
        sources = []
        for chunk in meta.get("groundingChunks", []) or []:
            web = chunk.get("web") or {}
            if web.get("uri"):
                sources.append({"title": web.get("title", "(제목 없음)"), "uri": web["uri"]})
        grounding = {
            "검색어": meta.get("webSearchQueries", []) or [],
            "출처": sources,
        }
        return extract_json(text), grounding

    except Exception as e:  # noqa: BLE001
        print(f"[WARN] Gemini 호출 실패: {e}", file=sys.stderr)
        if "resp" in dir():
            print(resp.text[:800], file=sys.stderr)
        return None, None


# ────────────────────── 3) GitHub Issue 등록 ──────────────────────

def build_issue_body(attention, market, proposal, grounding):
    L = [f"자동 생성 주간 리뷰 — {datetime.date.today().isoformat()}",
         f"검증 모델: `{GEMINI_MODEL}` (Google 검색 그라운딩 사용)", ""]

    L += ["## 1. 언급량 신호 — 코드 계산", "", "```json",
          json.dumps(attention, ensure_ascii=False, indent=2), "```", ""]
    L += ["## 2. 시장 지표 변동 — 코드 계산", "", "```json",
          json.dumps(market, ensure_ascii=False, indent=2), "```", ""]

    if proposal is None:
        L += ["## 3. 웹 검증", "",
              "API 키 미설정 또는 호출 실패로 생략되었습니다. 위 정량 신호만 참고하세요.", ""]
    else:
        ver = proposal.get("verification", [])
        if ver:
            L += ["## 3. 코드 판정 vs 실제 웹 대조", "",
                  "| 이벤트 | 코드 판정 | 웹 확인 | 일치 | 비고 |", "|---|---|---|---|---|"]
            for v in ver:
                mark = "✅" if v.get("agree") else "⚠️"
                L.append(f"| {v.get('id','')} | {v.get('code_says','')} | "
                         f"{v.get('web_says','')} | {mark} | {v.get('comment','')} |")
            L.append("")

        ch = proposal.get("status_changes", [])
        L += ["## 4. 상태 변경 제안", ""]
        if ch:
            L += ["| 이벤트 | 항목 | 현재 | 제안 | 근거 |", "|---|---|---|---|---|"]
            L += [f"| {c.get('id','')} | {c.get('field','')} | {c.get('current','')} | "
                  f"**{c.get('proposed','')}** | {c.get('reason','')} |" for c in ch]
        else:
            L.append("없음")
        L.append("")

        cd = proposal.get("new_candidates", [])
        L += ["## 5. 신규 내러티브 후보", ""]
        if cd:
            for c in cd:
                L += [f"### {c.get('name','')}",
                      f"- 층위: `{c.get('layer','')}` / 강도: `{c.get('intensity','')}`"
                      f" / 트리거일: `{c.get('trigger_date','')}`",
                      f"- 키워드: {', '.join(c.get('keywords', []))}",
                      f"- 근거: {c.get('reason','')}", ""]
        else:
            L += ["없음", ""]

        if proposal.get("notes"):
            L += ["## 6. 총평", "", proposal["notes"], ""]

    if grounding:
        L += ["## 7. 검증에 사용된 실제 검색 기록", ""]
        if grounding.get("검색어"):
            L += ["**Gemini가 실행한 검색어**", ""]
            L += [f"- `{q}`" for q in grounding["검색어"]]
            L.append("")
        if grounding.get("출처"):
            L += ["**참조한 출처**", ""]
            L += [f"- [{s['title']}]({s['uri']})" for s in grounding["출처"]]
            L.append("")
        if not grounding.get("검색어") and not grounding.get("출처"):
            L += ["검색 기록이 반환되지 않았습니다. 그라운딩이 동작하지 않았을 수 있습니다.", ""]

    L += ["---", "",
          "⚠️ 이 제안은 자동 생성된 것으로 **events.json에 반영되지 않았습니다.**",
          "위 출처 링크로 직접 확인한 뒤 `docs/data/events.json`을 수정하세요.",
          "반영했거나 기각했다면 이 이슈를 닫으면 됩니다."]
    return "\n".join(L)


def create_issue(body):
    token = os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("GITHUB_REPOSITORY")
    if not token or not repo:
        print("[INFO] GitHub 환경변수 없음 — 콘솔 출력합니다.\n")
        print(body)
        return
    try:
        r = requests.post(
            f"https://api.github.com/repos/{repo}/issues",
            headers={"Authorization": f"Bearer {token}",
                     "Accept": "application/vnd.github+json"},
            json={"title": f"주간 내러티브 리뷰 — {datetime.date.today().isoformat()}",
                  "body": body},
            timeout=30,
        )
        r.raise_for_status()
        print(f"[INFO] Issue 생성 완료: {r.json().get('html_url')}")
    except Exception as e:  # noqa: BLE001
        print(f"[WARN] Issue 생성 실패: {e}\n", file=sys.stderr)
        print(body)


def main():
    with open(EVENTS_PATH, encoding="utf-8") as f:
        events = json.load(f)

    attention = attention_signals(events, load_csv(ATTENTION_PATH))
    market = market_signals(load_csv(MARKET_PATH))
    scan = load_scan_keywords()

    proposal, grounding = call_gemini(events, attention, market, scan)
    create_issue(build_issue_body(attention, market, proposal, grounding))


if __name__ == "__main__":
    main()
