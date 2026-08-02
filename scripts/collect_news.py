"""
내러티브 언급량 수집 (Google News RSS + 매체 가중치 + 글로벌 워치리스트)

① 이벤트별 언급량: events.json의 keywords로 한국어 뉴스 조회 → attention.csv
② 글로벌 워치리스트: scan_keywords.json의 매크로 키워드로 영문(글로벌) 뉴스 조회
   → watchlist_attention.csv  (신규 트렌드·투기수요 감지용)

count  : 단순 기사 수
wcount : 매체 영향력 가중 합산 (주요 통신사·경제지·외신에 2~3배 가중치)

Google News RSS는 API 키가 필요 없는 공개 엔드포인트입니다.

[한계]
  - RSS는 최대 약 100건까지 반환하므로 대형 이슈는 100에서 포화됩니다.
    절대량보다 '상대적 추이' 판단용으로 쓰세요.
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
SCAN_PATH = os.path.join(BASE, "..", "docs", "data", "scan_keywords.json")
WATCHLIST_OUT = os.path.join(BASE, "..", "docs", "data", "watchlist_attention.csv")

RSS_KR = "https://news.google.com/rss/search?q={q}&hl=ko&gl=KR&ceid=KR:ko"
RSS_GLOBAL = "https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"
HEADERS = {"User-Agent": "Mozilla/5.0 (narrative-tracker)"}
FIELDNAMES = ["date", "event_id", "count", "wcount"]
WL_FIELDNAMES = ["date", "keyword_id", "count", "wcount"]

# 매체 영향력 가중치. source 태그의 매체명에 부분일치, 미등록 매체는 1.0
SOURCE_WEIGHTS = {
    # 한국 통신사·경제지·일간지·방송
    "연합뉴스": 3.0, "연합인포맥스": 3.0, "뉴스1": 2.0, "뉴시스": 2.0,
    "한국경제": 3.0, "매일경제": 3.0, "서울경제": 2.5, "머니투데이": 2.5,
    "이데일리": 2.5, "아시아경제": 2.0, "파이낸셜뉴스": 2.0, "헤럴드경제": 2.0,
    "조선일보": 2.5, "중앙일보": 2.5, "동아일보": 2.5,
    "한겨레": 2.0, "경향신문": 2.0, "한국일보": 2.0, "서울신문": 1.5,
    "KBS": 2.5, "MBC": 2.5, "SBS": 2.5, "JTBC": 2.0, "YTN": 2.0, "연합뉴스TV": 2.0,
    # 글로벌 주요 매체 (워치리스트용)
    "로이터": 3.0, "Reuters": 3.0, "블룸버그": 3.0, "Bloomberg": 3.0,
    "WSJ": 3.0, "Wall Street Journal": 3.0, "Financial Times": 3.0,
    "CNBC": 2.5, "New York Times": 2.5, "Associated Press": 2.5, "AP News": 2.5,
    "The Economist": 2.5, "Barron": 2.0, "MarketWatch": 2.0, "Fortune": 2.0,
}


def weight_of(source_name):
    if not source_name:
        return 1.0
    for key, w in SOURCE_WEIGHTS.items():
        if key in source_name:
            return w
    return 1.0


def fetch_articles(keyword: str, days: int = 1, template: str = RSS_KR) -> dict:
    """키워드의 최근 N일 기사 {링크: 가중치}. template=RSS_GLOBAL이면 영문 조회."""
    query = urllib.parse.quote(f"{keyword} when:{days}d")
    try:
        resp = requests.get(template.format(q=query), headers=HEADERS, timeout=20)
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
        out = {}
        for item in root.iter("item"):
            link = item.findtext("link")
            if not link:
                continue
            out[link] = weight_of(item.findtext("source") or "")
        return out
    except Exception as e:  # noqa: BLE001
        print(f"[WARN] '{keyword}' 조회 실패: {e}", file=sys.stderr)
        return {}


def migrate_csv(path, fieldnames):
    """구버전(컬럼 부족) CSV를 새 스키마로 승격. 없던 컬럼은 빈 값."""
    if not os.path.exists(path):
        return
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames == fieldnames:
            return
        old_rows = list(reader)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in old_rows:
            w.writerow({k: r.get(k, "") for k in fieldnames})
    print(f"[INFO] {os.path.basename(path)} 스키마 마이그레이션 완료.")


def append_rows(path, fieldnames, rows):
    write_header = not os.path.exists(path)
    with open(path, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        if write_header:
            w.writeheader()
        w.writerows(rows)


def collect_events() -> None:
    today = datetime.date.today().isoformat()
    with open(EVENTS_PATH, encoding="utf-8") as f:
        events = json.load(f)

    migrate_csv(OUT_PATH, FIELDNAMES)

    existing = set()
    if os.path.exists(OUT_PATH):
        with open(OUT_PATH, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                existing.add((r["date"], r["event_id"]))

    rows = []
    for e in events:
        if e.get("status") == "ended" or (today, e["id"]) in existing:
            continue
        articles = {}
        for kw in e.get("keywords", []):
            articles.update(fetch_articles(kw))
            time.sleep(1.2)
        rows.append({"date": today, "event_id": e["id"],
                     "count": len(articles),
                     "wcount": round(sum(articles.values()), 1)})
        print(f"[INFO] {e['id']}: {len(articles)}건 (가중 {rows[-1]['wcount']})")

    if rows:
        append_rows(OUT_PATH, FIELDNAMES, rows)
        print(f"[INFO] 이벤트 언급량 {len(rows)}건 기록.")
    else:
        print("[INFO] 이벤트 신규 기록 없음.")


def scan_watchlist() -> None:
    """글로벌 매크로 워치리스트 키워드별 일일 기사 수 수집 (영문/글로벌)."""
    if not os.path.exists(SCAN_PATH):
        print("[INFO] scan_keywords.json 없음 — 워치리스트 생략.")
        return
    with open(SCAN_PATH, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict) or "keywords" not in data:
        print("[INFO] scan_keywords.json 구형식 — 워치리스트 생략.")
        return

    today = datetime.date.today().isoformat()
    migrate_csv(WATCHLIST_OUT, WL_FIELDNAMES)

    existing = set()
    if os.path.exists(WATCHLIST_OUT):
        with open(WATCHLIST_OUT, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                existing.add((r["date"], r["keyword_id"]))

    rows = []
    for kw in data["keywords"]:
        if (today, kw["id"]) in existing:
            continue
        articles = fetch_articles(kw["query"], template=RSS_GLOBAL)
        rows.append({"date": today, "keyword_id": kw["id"],
                     "count": len(articles),
                     "wcount": round(sum(articles.values()), 1)})
        print(f"[INFO] watchlist {kw['id']}: {len(articles)}건")
        time.sleep(1.2)

    if rows:
        append_rows(WATCHLIST_OUT, WL_FIELDNAMES, rows)
        print(f"[INFO] 워치리스트 {len(rows)}건 기록.")
    else:
        print("[INFO] 워치리스트 신규 기록 없음.")


if __name__ == "__main__":
    collect_events()
    scan_watchlist()
