"""뉴스 언급량 수집 점검 — 내러티브별 검색어가 Google News RSS에서 실제로 기사를 잡는지, 포화(100건)·0건인지 본다.
덤으로 Google Trends(비공식 pytrends) 호출이 GitHub Actions에서 되는지도 확인한다 (지금 트래커는 Trends를 쓰지 않음).

GitHub Actions 실행 요약에 ::notice로 남긴다. 실행: python scripts/news_check.py
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))

import collect_news  # noqa: E402

EVENTS = os.path.join(os.path.dirname(__file__), "..", "docs", "data", "events.json")


def rss_report():
    events = [e for e in json.load(open(EVENTS, encoding="utf-8")) if e.get("status") != "ended"]
    lines, problems = [], []
    for e in events:
        union, per = {}, []
        for kw in e.get("keywords", []):
            arts = collect_news.fetch_articles(kw)  # 최근 1일, 한국어 — 매일 수집과 같은 호출
            union.update(arts)
            per.append(f"{kw} {len(arts)}")
            if len(arts) >= 95:
                problems.append(f"{e['name']}: '{kw}' 포화({len(arts)}건)")
            elif len(arts) == 0:
                problems.append(f"{e['name']}: '{kw}' 0건")
            time.sleep(1.0)
        lines.append(f"{e['name']} {len(union)}건 ({', '.join(per)})")
    print("::notice title=뉴스 언급량(Google News RSS, 최근 1일)::" + "%0A".join(lines))
    if problems:
        print("::warning title=검색어 점검::" + "%0A".join(problems))


def trends_probe():
    try:
        from pytrends.request import TrendReq
    except ImportError:
        print("::notice title=Google Trends::pytrends 미설치 — 점검 생략")
        return
    try:
        py = TrendReq(hl="ko-KR", tz=540, timeout=(10, 25), retries=1, backoff_factor=1)
        py.build_payload(["이란 전쟁", "AI 버블"], timeframe="now 7-d", geo="KR")
        df = py.interest_over_time()
        print(f"::notice title=Google Trends::호출 성공 — {len(df)}개 시점, 최근값 {df.iloc[-1].to_dict() if len(df) else '없음'}")
    except Exception as e:  # noqa: BLE001
        print(f"::notice title=Google Trends::호출 실패 — {type(e).__name__}: {str(e)[:160]}")


if __name__ == "__main__":
    rss_report()
    trends_probe()
