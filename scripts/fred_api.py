"""
FRED 공식 API 클라이언트 (https://api.stlouisfed.org/fred/)

FinanceDataReader의 'FRED:시리즈ID'는 키 없이 fredgraph.csv(그래프 다운로드 링크)를 감싸는 방식이라
가끔 막히거나 형식이 바뀌면 조용히 빈 결과가 나온다. 공식 API는 API 키가 필요하지만
  - 시리즈 메타데이터(제목·단위·주기·FRED 최종 갱신 시각)를 같이 받을 수 있고
  - 오류가 코드와 메시지로 돌아와 원인을 로그에 남길 수 있고
  - 장기 이력을 기간 지정 한 번으로 받을 수 있다.

키는 환경변수 FRED_API_KEY에서만 읽는다 (GitHub Actions에서는 저장소 Secret으로 주입).
키가 없거나 형식이 틀리면 api_key()가 None을 돌려주고, 호출하는 쪽(backfill_market_data.fetch_series)이
기존 fdr 경로로 그대로 수집한다 — 키가 없어도 파이프라인은 지금처럼 동작한다.

키 발급: https://fredaccount.stlouisfed.org/apikeys (무료, 32자리 영문 소문자+숫자)

의존성: requests, pandas
"""

import os
import re
import sys
import time

import pandas as pd
import requests

BASE_URL = "https://api.stlouisfed.org/fred"
KEY_PATTERN = re.compile(r"^[a-z0-9]{32}$")
TIMEOUT = 30
MAX_ATTEMPTS = 4
# FRED 문서상 키당 분당 요청 수 제한이 있다(초과 시 HTTP 429). 수집은 하루 수십 건이라 넉넉히 간격만 둔다.
MIN_INTERVAL = 0.6

# 메타데이터에서 보관할 필드 (fred/series 응답의 seriess[0] 중)
SERIES_FIELDS = (
    "id", "title", "units", "units_short", "frequency", "frequency_short",
    "seasonal_adjustment_short", "observation_start", "observation_end", "last_updated",
)

_last_call = 0.0
_warned_bad_key = False


class FredError(Exception):
    """FRED API 호출 실패 — 메시지에 API 키가 절대 들어가지 않게 만든다."""


def api_key():
    """환경변수의 키. 없거나 형식이 틀리면 None (형식 오류는 한 번만 경고)."""
    global _warned_bad_key
    key = (os.environ.get("FRED_API_KEY") or "").strip()
    if not key:
        return None
    if not KEY_PATTERN.match(key):
        if not _warned_bad_key:
            print("[WARN] FRED_API_KEY 형식이 올바르지 않습니다 (32자리 영문 소문자+숫자) — fdr 경로로 수집합니다.",
                  file=sys.stderr)
            _warned_bad_key = True
        return None
    return key


def _scrub(text, key):
    return text.replace(key, "***") if key else text


def _throttle():
    global _last_call
    wait = MIN_INTERVAL - (time.monotonic() - _last_call)
    if wait > 0:
        time.sleep(wait)
    _last_call = time.monotonic()


def _get(path, params, key=None, session=None):
    """GET {BASE_URL}/{path} — 429·5xx·네트워크 오류는 재시도, 400대(잘못된 시리즈 ID 등)는 바로 실패."""
    key = key or api_key()
    if not key:
        raise FredError("FRED_API_KEY가 설정되지 않았습니다")
    http = session or requests
    query = {**params, "api_key": key, "file_type": "json"}
    last_error = "알 수 없는 오류"

    for attempt in range(1, MAX_ATTEMPTS + 1):
        _throttle()
        try:
            resp = http.get(f"{BASE_URL}/{path}", params=query, timeout=TIMEOUT)
        except requests.RequestException as e:  # 예외 문자열에 요청 URL(=키 포함)이 섞일 수 있어 지운다
            last_error = _scrub(f"{type(e).__name__}: {e}", key)
        else:
            if resp.status_code == 200:
                try:
                    return resp.json()
                except ValueError:
                    raise FredError(f"{path}: JSON이 아닌 응답") from None
            detail = ""
            try:
                detail = resp.json().get("error_message", "")
            except ValueError:
                detail = resp.text[:200]
            last_error = _scrub(f"HTTP {resp.status_code} {detail}".strip(), key)
            if resp.status_code not in (429, 500, 502, 503, 504):
                raise FredError(f"{path}: {last_error}")
            retry_after = resp.headers.get("Retry-After", "")
            if retry_after.isdigit() and attempt < MAX_ATTEMPTS:
                time.sleep(min(int(retry_after), 60))
                continue
        if attempt < MAX_ATTEMPTS:
            time.sleep(2 ** attempt)

    raise FredError(f"{path}: {MAX_ATTEMPTS}회 시도 실패 — {last_error}")


def observations(series_id, start, end, key=None, session=None):
    """시리즈 관측값을 pd.Series(index=datetime.date, float)로. 결측('.')은 뺀다.

    start·end는 datetime.date. 기간 안에 값이 하나도 없으면 빈 Series를 돌려준다.
    """
    data = _get(
        "series/observations",
        {
            "series_id": series_id,
            "observation_start": start.isoformat(),
            "observation_end": end.isoformat(),
            "sort_order": "asc",
            "limit": 100000,  # API 최대치 — 일간 시리즈 270년치라 이 트래커에선 페이지 나눌 일이 없다
        },
        key=key, session=session,
    )
    obs = data.get("observations", [])
    count = data.get("count")
    if isinstance(count, int) and count > len(obs):
        print(f"[WARN] FRED {series_id}: {count}건 중 {len(obs)}건만 받음 (limit 초과)", file=sys.stderr)

    dates, values = [], []
    for o in obs:
        raw = o.get("value")
        if raw in (None, "", "."):
            continue
        try:
            values.append(float(raw))
        except ValueError:
            continue
        dates.append(pd.Timestamp(o["date"]).date())
    return pd.Series(values, index=dates, dtype="float64", name=series_id)


def series_info(series_id, key=None, session=None):
    """시리즈 메타데이터 — 제목·단위·주기·관측 기간·FRED 최종 갱신 시각."""
    data = _get("series", {"series_id": series_id}, key=key, session=session)
    seriess = data.get("seriess") or []
    if not seriess:
        raise FredError(f"series: {series_id} 메타데이터 없음")
    return {k: seriess[0].get(k) for k in SERIES_FIELDS}
