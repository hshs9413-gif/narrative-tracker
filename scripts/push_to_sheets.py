"""docs/data의 CSV를 구글 시트(Apps Script 웹 앱)에 누적한다 — 값이 확정된 행만 보낸다.

시트 쪽 스크립트는 이미 있는 키(날짜 등)를 다시 쓰지 않고 새 행만 추가하므로, FRED처럼
며칠 늦게 채워지는 최근 행은 SETTLE_DAYS가 지나 확정된 뒤에 보낸다. 첫 실행 때는 그때까지
쌓인 전체 기록이 한 번에 들어간다.

환경변수: SHEETS_WEBAPP_URL, SHEETS_TOKEN (GitHub Secrets) — 없으면 아무것도 하지 않음
"""

import csv
import datetime
import os
import sys

import requests

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "docs", "data")
SETTLE_DAYS = 7
TABLES = {  # 시트 탭 이름: 파일 (탭별 중복 판단 키는 Apps Script의 KEYS)
    "market_snapshot": "market_snapshot.csv",
    "attention": "attention.csv",
    "regime_log": "regime_log.csv",
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


def main():
    url = os.environ.get("SHEETS_WEBAPP_URL")
    token = os.environ.get("SHEETS_TOKEN")
    if not url or not token:
        print("[INFO] SHEETS_WEBAPP_URL / SHEETS_TOKEN 미설정 — 시트 전송 건너뜀")
        return

    cutoff = (datetime.date.today() - datetime.timedelta(days=SETTLE_DAYS)).isoformat()
    tables = {tab: t for tab, name in TABLES.items() if (t := load_table(name, cutoff))}
    print(f"[INFO] {cutoff} 이전 확정 행 전송: " + ", ".join(f"{k} {len(v) - 1}행" for k, v in tables.items()))

    # Apps Script 웹 앱은 302로 결과 주소에 넘겨주므로 리다이렉트를 따라가야 응답(JSON)을 받는다.
    resp = requests.post(url, json={"token": token, "tables": tables}, timeout=180)
    try:
        result = resp.json()
    except ValueError:
        sys.exit(f"[ERROR] 시트 응답이 JSON이 아님 (HTTP {resp.status_code}) — 웹 앱 배포의 액세스 권한이 "
                 f"'모든 사용자'인지 확인: {resp.text[:200]!r}")

    if not result.get("ok"):
        sys.exit(f"[ERROR] 시트 전송 실패: {result.get('error')} (unauthorized면 SHEETS_TOKEN과 스크립트 속성 TOKEN 불일치)")
    print(f"[INFO] 시트에 새로 추가된 행: {result.get('appended')}")


if __name__ == "__main__":
    main()
