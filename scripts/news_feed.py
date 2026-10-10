"""Google News RSS 헤드라인 — Gemini가 판단 근거로 쓸 실제 기사 목록을 만든다.

Gemini 무료 등급은 Google 검색 그라운딩이 막혀 있어(2026-10 확인: 모든 모델 429), 기사는 우리가 직접 받아
번호(h1, h2 …)를 붙여 넘기고, Gemini는 그 번호로만 근거를 댄다 — 없는 기사를 지어낼 수 없다.
"""

import email.utils
import re
import urllib.parse
import xml.etree.ElementTree as ET

import requests

RSS = {
    "ko": "https://news.google.com/rss/search?q={q}&hl=ko&gl=KR&ceid=KR:ko",
    "en": "https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en",
}
HEADERS = {"User-Agent": "Mozilla/5.0 (narrative-tracker)"}


def _date(pub):
    try:
        return email.utils.parsedate_to_datetime(pub).date().isoformat()
    except (TypeError, ValueError):
        return ""


def parse_rss(xml_bytes, limit):
    root = ET.fromstring(xml_bytes)
    out = []
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        source = (item.findtext("source") or "").strip()
        # 구글 뉴스 제목 끝의 ' - 매체명' 꼬리는 source와 겹치므로 뗀다
        if source and title.endswith(" - " + source):
            title = title[: -len(" - " + source)].strip()
        link = (item.findtext("link") or "").strip()
        if not title or not link:
            continue
        out.append({"title": title, "source": source, "date": _date(item.findtext("pubDate")), "url": link})
        if len(out) >= limit:
            break
    return out


def headlines(query, lang="ko", days=7, limit=8, session=None):
    """검색어의 최근 N일 기사 제목 목록 (최신순은 구글 정렬 그대로). 실패하면 빈 목록."""
    s = session or requests
    q = urllib.parse.quote(f"{query} when:{days}d")
    try:
        resp = s.get(RSS[lang].format(q=q), headers=HEADERS, timeout=20)
        resp.raise_for_status()
        return parse_rss(resp.content, limit)
    except Exception:  # noqa: BLE001 — 헤드라인은 보조 자료라 실패해도 진행
        return []


def or_query(keywords, n=3):
    """키워드 여러 개를 OR로 묶는다 — 공백이 든 키워드는 따옴표로."""
    terms = [f'"{k}"' if re.search(r"\s", k) else k for k in keywords[:n] if k]
    return " OR ".join(terms)
