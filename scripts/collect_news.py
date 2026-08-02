"""
내러티브 언급량 수집 (Google News RSS)

events.json에 정의된 각 이벤트의 keywords로 Google News RSS를 조회해
"최근 1일 기사 수"를 세고 docs/data/attention.csv 에 누적합니다.

Google News RSS는 API 키가 필요 없는 공개 엔드포인트입니다.
  https://news.google.com/rss/search?q={검색어}+when:1d&hl=ko&gl=KR&ceid=KR:ko

[한계]
  - RSS는 최대 약 100건까지만 반환하므로 대형 이슈는 100에서 포화됩니다.
    절대량보다 '상대적 추이'(정점 대비 몇 %인지) 판단용으로 쓰세요.
  - 비공식 엔드포인트라 구글 정책 변경 시 중단될 수 있습니다.

의존성: requests
"""

import csv
import datetime
import json
import os
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET

import requests

BASE = os.path.dirname(__file__)
EVENTS_PATH = os.path.join(BASE, "..", "docs", "data", "events.json")
OUT_PATH = os.path.join(BASE, "..", "docs", "data", "attention.csv")

RSS_URL = "https://news.google.com/rss/search?q={q}&hl=ko&gl=KR&ceid=KR:ko"
FIELDNAMES = ["date", "event_id", "count"]
HEADERS = {"User-Agent": "Mozilla/5.0 (narrative-tracker)"}


def fetch_links(keyword: str, days: int = 1) -> set:
    """키워드의 최근 N일 기사 링크 집합을 반환. 실패 시 빈 집합."""
    query = urllib.parse.quote(f"{keyword} when:{days}d")
    try:
        resp = requests.get(RSS_URL.format(q=query), headers=HEADERS, timeout=20)
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
        links = set()
        for item in root.iter("item"):
            link = item.findtext("link")
            if link:
                links.add(link)
        return links
    except Exception as e:  # noqa: BLE001
        print(f"[WARN] '{keyword}' 조회 실패: {e}", file=sys.stderr)
        return set()


def main() -> None:
    today = datetime.date.today().isoformat()

    with open(EVENTS_PATH, encoding="utf-8") as f:
        events = json.load(f)

    # 이미 오늘 기록이 있으면 스킵 (중복 방지)
    existing = set()
    if os.path.exists(OUT_PATH):
        with open(OUT_PATH, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                existing.add((r["date"], r["event_id"]))

    rows = []
    for e in events:
        if e.get("status") == "ended":
            continue
        if (today, e["id"]) in existing:
            print(f"[INFO] {e['id']} 오늘 기록 존재. 스킵.")
            continue

        # 한 이벤트의 여러 키워드를 합치되, 같은 기사가 중복 계수되지 않도록 링크로 dedupe
        all_links = set()
        for kw in e.get("keywords", []):
            all_links |= fetch_links(kw)
            time.sleep(1.2)          # 과도한 요청 방지

        rows.append({"date": today, "event_id": e["id"], "count": len(all_links)})
        print(f"[INFO] {e['id']}: {len(all_links)}건")

    if not rows:
        print("[INFO] 기록할 신규 데이터 없음.")
        return

    write_header = not os.path.exists(OUT_PATH)
    with open(OUT_PATH, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        if write_header:
            writer.writeheader()
        writer.writerows(rows)

    print(f"[INFO] {len(rows)}건 기록 완료.")


if __name__ == "__main__":
    main()
