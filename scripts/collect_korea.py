"""한국 지표 수집 — 한국은행 ECOS Open API (수집 워크플로에서 매일 실행).

받는 것 (docs/data/korea_snapshot.csv, 날짜별 한 줄)
  bok_rate     한국은행 기준금리(%)                 722Y001  일별
  ktb3y        국고채 3년 수익률(%)                 817Y002  일별 (시장금리)
  ktb10y       국고채 10년 수익률(%)                817Y002  일별
  foreign_net  외국인 순매수 — 유가증권시장(억원)   802Y001  일별 (주식시장)

항목 코드는 ECOS 항목 목록(StatisticItemList)에서 이름으로 찾는다 — 코드를 외워 박아 두면 ECOS가 코드를 바꾸거나
잘못 기억했을 때 조용히 엉뚱한 값을 받는다. 고른 항목 이름은 실행 기록(::notice)에 남긴다.
매번 2023년부터 다시 받아 파일을 통째로 다시 쓴다(하루 4~8번 호출). 받지 못한 항목은 기존 파일의 값을 지킨다.

키: ECOS_API_KEY 환경변수 (워크플로가 저장소 Secret에서 넣어 줌). 없으면 경고만 남기고 끝난다 — 수집·커밋을 막지 않는다.
키 발급: https://ecos.bok.or.kr/api/ → 인증키 신청 (무료)
"""

import csv
import datetime
import json
import os
import sys

import requests

BASE = "https://ecos.bok.or.kr/api"
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "docs", "data", "korea_snapshot.csv")
META_PATH = os.path.join(os.path.dirname(__file__), "..", "docs", "data", "korea_series.json")  # 화면 '데이터 출처'용
START = "20230101"
TIMEOUT = 30

LABELS = {"bok_rate": "한국은행 기준금리", "ktb3y": "국고채 3년", "ktb10y": "국고채 10년", "foreign_net": "외국인 순매수(유가증권시장)"}
# (컬럼, 통계표, 주기, 항목 이름에 모두 들어 있어야 할 낱말, 이름으로 못 찾을 때 쓸 코드)
SERIES = [
    ("bok_rate", "722Y001", "D", ["기준금리"], "0101000"),
    ("ktb3y", "817Y002", "D", ["국고채", "3년"], "010200000"),
    ("ktb10y", "817Y002", "D", ["국고채", "10년"], "010210000"),
    ("foreign_net", "802Y001", "D", ["외국인", "순매수"], None),
]
COLUMNS = ["date"] + [s[0] for s in SERIES]


class EcosError(Exception):
    pass


def _key():
    return (os.environ.get("ECOS_API_KEY") or "").strip()


def _scrub(text):
    """오류 메시지에 섞인 키를 가린다 — 요청 주소에 키가 들어가서 예외 문자열에 그대로 찍힌다(공개 저장소 실행 기록)."""
    k = _key()
    return str(text).replace(k, "***") if k else str(text)


def _get(path, session=None):
    s = session or requests
    resp = s.get(f"{BASE}/{path}", timeout=TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    if "RESULT" in data:  # 오류·빈 결과는 이 모양으로 온다
        raise EcosError(f"{data['RESULT'].get('CODE')}: {data['RESULT'].get('MESSAGE')}")
    return data


def item_list(stat, session=None):
    data = _get(f"StatisticItemList/{_key()}/json/kr/1/1000/{stat}", session)
    return data.get("StatisticItemList", {}).get("row", [])


def pick_item(items, words, cycle, fallback=None, prefer=("유가증권", "KOSPI", "코스피")):
    """이름에 words가 모두 들어 있고 주기가 맞는 항목. 여럿이면 prefer 낱말이 든 것, 그다음 이름이 짧은 것."""
    hits = [i for i in items if all(w in (i.get("ITEM_NAME") or "") for w in words)
            and (i.get("CYCLE") in (None, "", cycle))]
    if not hits:
        if fallback:
            return {"ITEM_CODE": fallback, "ITEM_NAME": f"(코드 {fallback})"}
        return None
    hits.sort(key=lambda i: (not any(p in i["ITEM_NAME"] for p in prefer), len(i["ITEM_NAME"])))
    return hits[0]


def search(stat, cycle, item, start=START, end=None, session=None):
    """(시계열, 첫 행의 통계표·항목·단위 이름)"""
    end = end or datetime.date.today().strftime("%Y%m%d")
    data = _get(f"StatisticSearch/{_key()}/json/kr/1/10000/{stat}/{cycle}/{start}/{end}/{item}", session)
    rows = data.get("StatisticSearch", {}).get("row", [])
    first = rows[0] if rows else {}
    return parse_rows(rows), {"stat_name": first.get("STAT_NAME", ""), "unit": first.get("UNIT_NAME", "")}


def parse_rows(rows):
    """ECOS 행 → [(YYYY-MM-DD, float)] — 값이 비었거나 숫자가 아니면 뺀다"""
    out = []
    for r in rows:
        t, v = str(r.get("TIME", "")), str(r.get("DATA_VALUE", "")).replace(",", "").strip()
        if len(t) != 8:
            continue
        try:
            out.append((f"{t[:4]}-{t[4:6]}-{t[6:]}", float(v)))
        except ValueError:
            continue
    return out


def load_existing(path=OUT_PATH):
    if not os.path.exists(path):
        return {}
    with open(path, newline="", encoding="utf-8") as f:
        return {r["date"]: r for r in csv.DictReader(f)}


def merge(existing, fetched):
    """fetched: {컬럼: [(날짜, 값)]}. 받은 컬럼은 새 값으로, 못 받은 컬럼은 기존 값 그대로."""
    rows = {d: {c: r.get(c, "") for c in COLUMNS} for d, r in existing.items()}
    for col, series in fetched.items():
        for r in rows.values():
            r[col] = ""
        for d, v in series:
            rows.setdefault(d, {c: "" for c in COLUMNS} | {"date": d})[col] = f"{v:g}"
    keep = [r for r in rows.values() if any(r[c] for c in COLUMNS[1:])]
    return sorted(keep, key=lambda r: r["date"])


def write(rows, path=OUT_PATH):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)


def main():
    if not _key():
        print("::warning title=한국 지표 건너뜀::ECOS_API_KEY가 없음 — 저장소 Settings → Secrets and variables → Actions에 "
              "ECOS_API_KEY로 한국은행 ECOS 인증키 등록")
        return
    session = requests.Session()
    fetched, notes, items_cache, meta = {}, [], {}, []
    for col, stat, cycle, words, fallback in SERIES:
        try:
            if stat not in items_cache:
                items_cache[stat] = item_list(stat, session)
            item = pick_item(items_cache[stat], words, cycle, fallback)
            if not item:
                notes.append(f"{col}: {stat}에서 '{' '.join(words)}' 항목을 못 찾음")
                continue
            series, info = search(stat, cycle, item["ITEM_CODE"], session=session)
            if not series:
                notes.append(f"{col}: {item['ITEM_NAME']} — 값 없음")
                continue
            fetched[col] = series
            d, v = series[-1]
            meta.append({"column": col, "label": LABELS.get(col, col), "stat_code": stat, "stat_name": info["stat_name"],
                         "item_code": item["ITEM_CODE"], "item_name": item["ITEM_NAME"], "cycle": cycle, "unit": info["unit"],
                         "first": series[0][0], "last": d, "count": len(series)})
            notes.append(f"{col}: {item['ITEM_NAME']}({item['ITEM_CODE']}) {len(series)}일, 마지막 {d} {v:g}")
        except (requests.RequestException, EcosError, ValueError) as e:
            notes.append(f"{col}: 실패 — {type(e).__name__} {_scrub(e)[:120]}")
    if not fetched:
        print("::warning title=한국 지표 실패::" + " · ".join(notes))
        sys.exit(0)
    write(merge(load_existing(), fetched))
    with open(META_PATH, "w", encoding="utf-8") as f:
        json.dump({"fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                   "source": "한국은행 ECOS Open API", "series": meta}, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("::notice title=한국 지표(ECOS)::" + "%0A".join(notes))


if __name__ == "__main__":
    main()
