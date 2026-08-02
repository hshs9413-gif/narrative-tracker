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
  GEMINI_MODEL      : (선택) 미설정 시 gemini-3.5-flash부터 순차 시도
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
WATCHLIST_ATT = os.path.join(BASE, "..", "docs", "data", "watchlist_attention.csv")

# 무료 티어 모델을 품질 순으로 시도한다 (2026-07 기준 무료 티어 확인된 모델들).
# 429(limit:0)가 나오는 모델은 자동으로 건너뛰므로 상위 모델부터 시도해도 안전하다.
# GEMINI_MODEL 변수를 설정하면 그 모델을 최우선 시도한다.
MODEL_CANDIDATES = [
    os.environ.get("GEMINI_MODEL"),
    "gemini-3.5-flash",       # 최신, 무료 일 1,500회 — 품질 최우선
    "gemini-3-flash",         # 구글 권장 무료 기본 모델
    "gemini-2.5-flash",       # 구세대 폴백 (일 250회)
    "gemini-3.1-flash-lite",  # 경량 폴백 (15 RPM)
    "gemini-2.5-flash-lite",  # 최후 폴백 (일 1,000회)
]
MODEL_CANDIDATES = [m for m in MODEL_CANDIDATES if m]
GEMINI_MODEL = MODEL_CANDIDATES[0]
GEMINI_URL = ("https://generativelanguage.googleapis.com/v1beta/models/"
              "{model}:generateContent")

# 실패 원인을 Issue 본문에 그대로 싣기 위해 진단 메시지를 모아둔다.
DIAG = []


def diag(msg):
    print(msg)
    DIAG.append(str(msg))


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
        """결측치를 건너뛰고 유효값끼리 비교한다.
        FRED는 1~2일 발행 지연이 있어 최근 행에 빈 칸이 흔하다."""
        vals = [(r["date"], to_float(r.get(col))) for r in market_rows]
        vals = [(d, v) for d, v in vals if v is not None]
        if len(vals) <= lookback:
            return None
        cur = vals[-1][1]
        prev = vals[-1 - lookback][1]
        if prev == 0:
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


def load_watchlist():
    """scan_keywords.json (신형식 dict). 구형식이면 문자열 리스트를 변환."""
    if not os.path.exists(SCAN_PATH):
        return []
    with open(SCAN_PATH, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) and "keywords" in data:
        return data["keywords"]
    if isinstance(data, list):   # 구형식 호환
        return [{"id": f"kw{i}", "label": s, "query": s, "layer": "?"}
                for i, s in enumerate(data)]
    return []


def watchlist_spikes(keywords):
    """워치리스트 언급량 급등 감지 — 투기수요·신규 트렌드가 붙기 시작하는 신호.

    기준: 최근 3일 평균이 (a) 20건 이상이고 (b) 직전 기준선의 2배 이상.
    기준선이 5건 미만(거의 무보도)이었다가 20건+ 튀면 '신규 등장'으로 간주.
    데이터 5일 미만이면 판정하지 않고 수집 상태만 보고한다.
    """
    label_of = {k["id"]: k.get("label", k["id"]) for k in keywords}
    layer_of = {k["id"]: k.get("layer", "?") for k in keywords}

    series = defaultdict(list)
    for r in load_csv(WATCHLIST_ATT):
        c = to_float(r.get("wcount")) or to_float(r.get("count"))
        if c is not None:
            series[r["keyword_id"]].append((r["date"], c))

    if not series:
        return {"상태": "워치리스트 데이터 수집 전 (매일 자동 수집됨)"}

    days_max = max(len(v) for v in series.values())
    if days_max < 5:
        return {"상태": f"수집 {days_max}일차 — 급등 판정에 5일 이상 필요"}

    spikes = []
    for kid, pts in series.items():
        pts.sort()
        counts = [c for _, c in pts]
        if len(counts) < 5:
            continue
        recent3 = statistics.mean(counts[-3:])
        base = statistics.mean(counts[-17:-3])
        if recent3 >= 20 and (base < 5 or recent3 >= base * 2):
            spikes.append({
                "id": kid,
                "키워드": label_of.get(kid, kid),
                "층위": layer_of.get(kid, "?"),
                "최근3일평균": round(recent3, 1),
                "기준선": round(base, 1),
                "배율": round(recent3 / base, 1) if base >= 1 else "신규",
            })
    spikes.sort(key=lambda s: (s["배율"] if isinstance(s["배율"], float) else 99),
                reverse=True)
    if not spikes:
        return {"상태": "급등 키워드 없음", "관측일수": days_max}
    return {"급등": spikes[:8], "관측일수": days_max}


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
2. 다음 글로벌 워치리스트 주제들을 검색해 **기록되지 않은 신규 내러티브**가 있는지 확인하세요: {scan}

## 코드가 감지한 워치리스트 급등 신호 (글로벌 매체 기사량 기반)
{watchlist}

급등 목록에 있는 키워드는 신규 내러티브 후보로 **우선 검토**하세요. 검색으로 실체를
확인하고, 일회성 뉴스인지 자산가격 반응이 동반된 트렌드인지 구분하세요.
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


def call_gemini(events, attention, market, scan, watchlist):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        diag("[WARN] GEMINI_API_KEY 환경변수가 비어 있습니다. Secrets 등록 여부와 이름(GEMINI_API_KEY)을 확인하세요.")
        return None, None

    prompt = PROMPT.format(
        today=datetime.date.today().isoformat(),
        events=json.dumps(events, ensure_ascii=False, indent=2),
        attention=json.dumps(attention, ensure_ascii=False, indent=2),
        market=json.dumps(market, ensure_ascii=False, indent=2),
        scan=", ".join(scan),
        watchlist=json.dumps(watchlist, ensure_ascii=False, indent=2),
    )

    def build_body(model, disable_thinking=True):
        """Gemini 2.5+ 는 thinking이 기본 활성이고 그 토큰이 maxOutputTokens에서
        차감된다. 예산이 작으면 추론이 전부 소진해 본문이 비고 그라운딩도 나오지 않는다.
        thinkingConfig는 반드시 generationConfig 안에 중첩해야 적용된다."""
        gen = {"temperature": 0.2, "maxOutputTokens": 16384}
        if disable_thinking:
            if "pro" in model:
                gen["thinkingConfig"] = {"thinkingBudget": 128}   # Pro는 0을 거부함
            else:
                gen["thinkingConfig"] = {"thinkingBudget": 0}     # Flash 계열은 완전 비활성
        return {
            "contents": [{"parts": [{"text": prompt}]}],
            # 검색 그라운딩. 검색 도구는 다른 도구와 함께 쓸 수 없어 단독 사용.
            "tools": [{"google_search": {}}],
            "generationConfig": gen,
        }

    data = None
    used_model = None
    headers = {"x-goog-api-key": api_key, "Content-Type": "application/json"}
    for model in MODEL_CANDIDATES:
      for disable_thinking in (True, False):     # thinkingConfig 거부 모델 대비
        try:
            diag(f"[INFO] 모델 시도: {model} (thinking {'off' if disable_thinking else 'default'})")
            resp = requests.post(
                GEMINI_URL.format(model=model),
                headers=headers,
                json=build_body(model, disable_thinking),
                timeout=180,
            )
            if resp.status_code == 200:
                data = resp.json()
                used_model = model
                diag(f"[INFO] 성공: {model}")
                break

            # 실패 원인을 그대로 노출한다 (429의 limit 값 확인용)
            diag(f"[WARN] {model} → HTTP {resp.status_code}")
            diag(f"       {resp.text[:400]}")
            if resp.status_code == 429:
                diag("       → 429는 쿼터 문제입니다. limit이 0이면 해당 모델이 무료 티어 대상이 아니고, "
                     "그 외에는 분당/일일 호출 한도 초과입니다.")
            elif resp.status_code == 400:
                diag("       → 400은 요청 형식 또는 모델명 오류입니다.")
            elif resp.status_code in (401, 403):
                diag("       → 401/403은 API 키 자체의 문제입니다(무효/권한없음).")
                return None, None
        except Exception as e:  # noqa: BLE001
            diag(f"[WARN] {model} 호출 예외: {e}")
      if data is not None:
        break

    if data is None:
        diag("[WARN] 모든 모델 시도 실패 — 정량 신호만 보고합니다.")
        return None, None

    globals()["GEMINI_MODEL"] = used_model
    try:
        cand = (data.get("candidates") or [{}])[0]
        text = "".join(p.get("text", "") for p in cand.get("content", {}).get("parts", []))

        # 진단 로그: 응답이 비면 원인을 바로 알 수 있게 남긴다
        usage = data.get("usageMetadata", {}) or {}
        diag(f"[INFO] finishReason={cand.get('finishReason')} "
             f"thoughts={usage.get('thoughtsTokenCount')} "
             f"output={usage.get('candidatesTokenCount')} "
             f"textLen={len(text)}")
        if cand.get("finishReason") == "MAX_TOKENS" and not text.strip():
            diag("[WARN] thinking이 출력 토큰을 모두 소진했습니다.")

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
        parsed = extract_json(text)
        if parsed is None:
            diag(f"[WARN] JSON 파싱 실패. 응답 앞부분: {text[:400]!r}")
        return parsed, grounding

    except Exception as e:  # noqa: BLE001
        diag(f"[WARN] 응답 처리 실패: {e}")
        return None, None


# ────────────────────── 3) GitHub Issue 등록 ──────────────────────

def build_issue_body(attention, market, watchlist, proposal, grounding):
    L = [f"자동 생성 주간 리뷰 — {datetime.date.today().isoformat()}",
         f"검증 모델: `{GEMINI_MODEL}` (Google 검색 그라운딩 사용)", ""]

    L += ["## 1. 언급량 신호 — 코드 계산", "", "```json",
          json.dumps(attention, ensure_ascii=False, indent=2), "```", ""]
    L += ["## 2. 시장 지표 변동 — 코드 계산", "", "```json",
          json.dumps(market, ensure_ascii=False, indent=2), "```", ""]

    L += ["## 2.5 글로벌 워치리스트 급등 신호 — 코드 계산", ""]
    if "급등" in watchlist:
        L += ["| 키워드 | 층위 | 최근3일 | 기준선 | 배율 |", "|---|---|---|---|---|"]
        for s in watchlist["급등"]:
            L.append(f"| {s['키워드']} | {s['층위']} | {s['최근3일평균']} | "
                     f"{s['기준선']} | {s['배율']} |")
        L += ["", f"(관측 {watchlist.get('관측일수','?')}일 기준. "
              "글로벌 주요 매체 가중 기사량으로 산출)", ""]
    else:
        L += [watchlist.get("상태", "정보 없음"), ""]

    if proposal is None:
        L += ["## 3. 웹 검증 — 실패", "",
              "Gemini 검증이 완료되지 않았습니다. 아래 진단 로그에서 원인을 확인하세요.", "",
              "```", *(DIAG or ["(진단 정보 없음)"]), "```", "",
              "**원인별 조치**", "",
              "| 로그 내용 | 원인 | 조치 |",
              "|---|---|---|",
              "| `GEMINI_API_KEY 환경변수가 비어 있습니다` | Secret 미등록/이름 불일치 | Settings → Secrets에 `GEMINI_API_KEY` 등록 |",
              "| `HTTP 429` + `limit: 0` | 해당 모델이 무료 티어 대상 아님 | 자동으로 다음 모델을 시도함. 전부 실패 시 결제 계정 연결 필요 |",
              "| `HTTP 429` (그 외) | 분당/일일 호출 한도 초과 | 10분 후 1회만 재실행 |",
              "| `HTTP 400` | 요청 형식 또는 모델명 오류 | `GEMINI_MODEL` 변수 삭제 후 재실행 |",
              "| `HTTP 401` / `403` | 키가 무효하거나 권한 없음 | AI Studio에서 키 재발급 |",
              "| `textLen=0` | 응답 본문 없음 | thinking 토큰 소진. 코드 수정 필요 |",
              ""]
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
    kws = load_watchlist()
    scan = [f"{k.get('label','')}({k.get('query','')})" for k in kws] or ["연준 금리", "관세", "지정학"]
    watchlist = watchlist_spikes(kws)

    proposal, grounding = call_gemini(events, attention, market, scan, watchlist)
    create_issue(build_issue_body(attention, market, watchlist, proposal, grounding))


if __name__ == "__main__":
    main()
