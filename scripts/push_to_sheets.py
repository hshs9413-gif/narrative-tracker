"""docs/data의 CSV를 구글 시트(Apps Script 웹 앱)에 누적한다 — 값이 확정된 행만 보낸다.

시트 쪽 스크립트는 이미 있는 키(날짜 등)를 다시 쓰지 않고 새 행만 추가하므로, FRED처럼
며칠 늦게 채워지는 최근 행은 SETTLE_DAYS가 지나 확정된 뒤에 보낸다. 첫 실행 때는 그때까지
쌓인 전체 기록이 한 번에 들어간다.

events.json은 날짜별로 쌓이는 기록이 아니라 상태가 바뀌는 목록(active→dormant 등)이라
'events' 탭에 이벤트당 한 줄로 두고, 시트 쪽이 id가 같은 줄을 덮어써서 항상 현재 상태를 반영한다.

환경변수: SHEETS_WEBAPP_URL, SHEETS_TOKEN (GitHub Secrets) — 없으면 아무것도 하지 않음
"""

import csv
import datetime
import json
import os
import re
import sys
from html import unescape

import requests

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "docs", "data")
SETTLE_DAYS = 7
TABLES = {  # 시트 탭 이름: 파일 (탭별 중복 판단 키는 Apps Script의 KEYS)
    "market_snapshot": "market_snapshot.csv",
    "attention": "attention.csv",
    "regime_log": "regime_log.csv",
    "watchlist_attention": "watchlist_attention.csv",
}
EVENT_COLUMNS = [  # events 탭 열 순서 — 여기 없는 필드가 events.json에 생기면 뒤에 덧붙임
    "id", "name", "layer", "layer_secondary", "phase", "status", "intensity",
    "trigger_date", "peak_date", "half_life_date", "assets", "keywords",
    "reignition_triggers", "notes", "last_auto",
]
NOT_JSON_HINTS = {  # 웹 앱이 JSON 대신 구글 안내 페이지를 돌려줄 때 흔한 원인
    401: "웹 앱 액세스 권한이 '모든 사용자'가 아님 (배포 관리 → 수정)",
    404: "주소가 살아 있는 웹 앱 배포가 아님 — 배포 관리에서 웹 앱 URL을 다시 복사해 SHEETS_WEBAPP_URL 갱신",
}


def to_cell(value):
    """숫자는 숫자로 보내 시트에서 계산·차트가 되게 한다 (날짜·id·라벨은 문자열 그대로)."""
    try:
        return float(value)
    except ValueError:
        return value


def load_table(filename, cutoff):
    path = os.path.join(DATA_DIR, filename)
    if not os.path.exists(path):
        return None
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        if not header:
            return None
        rows = [r + [""] * (len(header) - len(r)) for r in reader if r and r[0] <= cutoff]
    return [header] + [[to_cell(v) for v in r] for r in rows]


def event_cell(value):
    """리스트는 ' | '로 이어 붙이고 dict는 JSON 문자열로, 비어 있으면(null) 빈 칸으로 — 날짜 등은 문자열 그대로."""
    if value is None:
        return ""
    if isinstance(value, list):
        return " | ".join(str(v) for v in value)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return value


def load_events():
    path = os.path.join(DATA_DIR, "events.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        events = json.load(f)
    if not events:
        return None
    header = EVENT_COLUMNS + [k for e in events for k in e if k not in EVENT_COLUMNS]
    header = list(dict.fromkeys(header))
    return [header] + [[event_cell(e.get(k)) for k in header] for e in events]


def page_text(html):
    """구글 안내·오류 페이지에서 사람이 읽는 문구만 뽑는다 (앞쪽 스크립트 덩어리는 버림)."""
    html = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", html)
    return " ".join(unescape(re.sub(r"<[^>]+>", " ", html)).split())[:200]


def fail(msg):
    """Actions 실행 요약에도 보이도록 오류 주석(::error)을 함께 남기고 끝낸다 — 이 단계는 실패해도 수집을 막지 않아 로그를 열기 전엔 눈에 띄지 않는다."""
    print(f"::error title=Google Sheets 전송 실패::{msg}", flush=True)
    sys.exit(msg)


def main():
    # 붙여넣을 때 딸려 온 공백·줄바꿈이 있으면 주소·토큰이 달라진다
    url = os.environ.get("SHEETS_WEBAPP_URL", "").strip()
    token = os.environ.get("SHEETS_TOKEN", "").strip()
    if not url or not token:
        print("[INFO] SHEETS_WEBAPP_URL / SHEETS_TOKEN 미설정 — 시트 전송 건너뜀")
        return
    if token in url or token.startswith("AKfycb"):
        fail("[ERROR] SHEETS_TOKEN에 웹 앱 배포 ID(주소 속 AKfycb… 값)가 들어 있음 — "
             "Apps Script 프로젝트 설정 → 스크립트 속성의 TOKEN 값을 넣어야 함")

    cutoff = (datetime.date.today() - datetime.timedelta(days=SETTLE_DAYS)).isoformat()
    tables = {tab: t for tab, name in TABLES.items() if (t := load_table(name, cutoff))}
    if events := load_events():  # 확정 대기 없이 항상 현재 상태 그대로
        tables["events"] = events
    print(f"[INFO] {cutoff} 이전 확정 행 전송: " + ", ".join(f"{k} {len(v) - 1}행" for k, v in tables.items()),
          flush=True)  # 오류(stderr)보다 먼저 찍히도록

    # Apps Script 웹 앱은 302로 결과 주소에 넘겨주므로 리다이렉트를 따라가야 응답(JSON)을 받는다.
    resp = requests.post(url, json={"token": token, "tables": tables}, timeout=180)
    try:
        result = resp.json()
    except ValueError:
        hint = NOT_JSON_HINTS.get(resp.status_code, "웹 앱 배포·코드 확인")
        fail(f"[ERROR] 시트 응답이 JSON이 아님 (HTTP {resp.status_code}) — {hint}: {page_text(resp.text)!r}")

    if not result.get("ok"):
        fail(f"[ERROR] 시트 전송 실패: {result.get('error')} (unauthorized면 SHEETS_TOKEN과 스크립트 속성 TOKEN 불일치)")
    print(f"[INFO] 시트에 새로 추가된 행: {result.get('appended')}")


if __name__ == "__main__":
    main()
