"""
공공데이터포털(apis.data.go.kr) 금융위원회 API 클라이언트

- 기업기본정보  GetCorpBasicInfoService_V2 / getCorpOutline_V2  (법인등록번호·회사명 → 법인 개요, 사업자등록번호 bzno 포함)
- 기업 재무정보 GetFinaStatInfoService_V2  / getSummFinaStat_V2 (요약재무제표) · getBs_V2 (재무상태표) · getIncoStat_V2 (손익계산서)

키는 환경변수 DATA_GO_KR_KEY (GitHub Actions에서는 저장소 Secret). 포털이 주는 '일반 인증키'는
Encoding(이미 %로 인코딩된 것)과 Decoding(원문) 두 가지인데, 어느 쪽을 넣어도 되도록 % 인코딩을 먼저 풀고
requests가 한 번만 인코딩하게 한다 (Encoding 키를 그대로 다시 인코딩하면 SERVICE_KEY_IS_NOT_REGISTERED 오류).

의존성: requests
"""

import os
import re
import sys
import time
import urllib.parse

import requests

BASE_URL = "https://apis.data.go.kr/1160100/service"
CORP_SERVICE = "GetCorpBasicInfoService_V2"
FINA_SERVICE = "GetFinaStatInfoService_V2"
TIMEOUT = 30
MAX_ATTEMPTS = 3

_last_call = 0.0
MIN_INTERVAL = 0.2


class FscError(Exception):
    """API 호출 실패 — 메시지에 키가 들어가지 않게 만든다."""


def _raw_key():
    return (os.environ.get("DATA_GO_KR_KEY") or "").strip().strip("'\"").strip()


def service_key():
    """Decoding(원문) 형태의 키. 없으면 None."""
    key = _raw_key()
    if not key:
        return None
    return urllib.parse.unquote(key) if "%" in key else key


def _scrub(text, key):
    if not key:
        return text
    for k in {key, urllib.parse.quote(key, safe=""), urllib.parse.quote_plus(key)}:
        text = text.replace(k, "***")
    return text


def _xml_error(text):
    """인증 오류 등은 resultType=json이어도 XML로 온다 — 사유 코드만 뽑는다."""
    msg = re.search(r"<returnAuthMsg>(.*?)</returnAuthMsg>", text)
    code = re.search(r"<returnReasonCode>(.*?)</returnReasonCode>", text)
    err = re.search(r"<errMsg>(.*?)</errMsg>", text)
    parts = [p.group(1) for p in (err, msg, code) if p]
    return " / ".join(parts) or text[:200]


def _items(body):
    items = (body or {}).get("items")
    if not items:  # 결과 0건이면 "" 또는 None
        return []
    item = items.get("item") if isinstance(items, dict) else items
    if item is None:
        return []
    return item if isinstance(item, list) else [item]


def call(service, operation, params, num_rows=100, page=1, key=None, session=None):
    """한 페이지 조회 → (items, totalCount). 오류면 FscError."""
    global _last_call
    key = key or service_key()
    if not key:
        raise FscError("DATA_GO_KR_KEY가 설정되지 않았습니다")
    http = session or requests
    query = {"serviceKey": key, "pageNo": page, "numOfRows": num_rows, "resultType": "json", **params}
    url = f"{BASE_URL}/{service}/{operation}"
    last = "알 수 없는 오류"
    for attempt in range(1, MAX_ATTEMPTS + 1):
        wait = MIN_INTERVAL - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()
        try:
            resp = http.get(url, params=query, timeout=TIMEOUT)
        except requests.RequestException as e:
            last = _scrub(f"{type(e).__name__}: {e}", key)
        else:
            text = resp.text.strip()
            if text.startswith("<"):
                raise FscError(f"{operation}: {_xml_error(text)}")
            if resp.status_code != 200:
                last = f"HTTP {resp.status_code} {text[:200]}"
                if resp.status_code < 500 and resp.status_code != 429:
                    raise FscError(f"{operation}: {_scrub(last, key)}")
            else:
                try:
                    data = resp.json()
                except ValueError:
                    raise FscError(f"{operation}: JSON이 아닌 응답 {text[:120]!r}") from None
                r = data.get("response", data)
                header = r.get("header", {})
                if str(header.get("resultCode", "00")) not in ("00", "0"):
                    raise FscError(f"{operation}: {header.get('resultCode')} {header.get('resultMsg')}")
                body = r.get("body", {})
                total = body.get("totalCount")
                return _items(body), int(total) if str(total).isdigit() else None
        if attempt < MAX_ATTEMPTS:
            time.sleep(2 ** attempt)
    raise FscError(f"{operation}: {MAX_ATTEMPTS}회 시도 실패 — {_scrub(last, key)}")


def call_all(service, operation, params, num_rows=100, max_pages=20, **kw):
    """여러 페이지를 모아 전부 반환."""
    out, page = [], 1
    while page <= max_pages:
        items, total = call(service, operation, params, num_rows=num_rows, page=page, **kw)
        out.extend(items)
        if not items or total is None or len(out) >= total:
            break
        page += 1
    return out


# ── 번호 정리 ──

def digits(value):
    return re.sub(r"\D", "", str(value or ""))


def kind_of(number):
    """하이픈 등을 뺀 자릿수로 구분 — 사업자등록번호 10자리, 법인등록번호 13자리."""
    d = digits(number)
    if len(d) == 10:
        return "bzno"
    if len(d) == 13:
        return "crno"
    return None


def fmt_bzno(d):
    d = digits(d)
    return f"{d[:3]}-{d[3:5]}-{d[5:]}" if len(d) == 10 else d


def fmt_crno(d):
    d = digits(d)
    return f"{d[:6]}-{d[6:]}" if len(d) == 13 else d


def log(msg):
    print(msg, file=sys.stderr)
