"""상관관계 — 지수·국채·원자재·달러가 서로 얼마나 같이(반대로) 움직이는지, 그 관계가 최근 바뀌었는지 (아침 수집에서 실행).

주간 변화(금요일 마지막 값 기준)로 잰다 — 한국 장과 미국 장은 닫히는 시각이 달라 하루 단위로는 같은 날끼리 짝이 맞지 않는다.
최근 26주(약 6개월) 상관과 104주(2년) 상관을 비교해, 차이가 크거나 부호가 바뀐 짝을 '눈에 띄는 변화'로 고른다.
예측이 아니라, 분산 효과(주식이 빠질 때 채권·달러·금이 받쳐 주나)가 지금도 살아 있는지 보는 정보다.

출력: docs/data/correlations.json (대시보드 한두 줄), docs/data/correlation_log.csv (주마다 짝별 기록 → 시트 '상관계수' 탭)
"""

import csv
import io
import itertools
import json
import os

import numpy as np
import pandas as pd

import compute_regression as cg

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "docs", "data")
JSON_PATH = os.path.join(DATA_DIR, "correlations.json")
LOG_PATH = os.path.join(DATA_DIR, "correlation_log.csv")
US_PATH = os.path.join(DATA_DIR, "overnight_us.csv")

RECENT, LONG = 26, 104   # 주
MIN_LONG = 80
NOTABLE_DIFF = 0.35
ASSETS = [  # (id, 이름, 변화 단위)
    ("kospi", "코스피", "pct"), ("sp500", "S&P500", "pct"), ("us10y", "미 10년물 금리", "bp"),
    ("ktb10y", "국고채 10년 금리", "bp"), ("dxy_ice", "달러인덱스", "pct"), ("usdkrw", "원/달러", "pct"),
    ("gold", "금", "pct"), ("brent_front", "브렌트유", "pct"),
]
LOG_COLUMNS = ["key", "주", "자산1", "자산2", "최근26주", "2년", "차이", "읽는법"]


def load_series():
    lv = cg.load_levels()
    if os.path.exists(US_PATH):
        us = pd.read_csv(US_PATH, parse_dates=["date"]).set_index("date").sort_index()
        if "sp500" in us:
            lv["sp500"] = us["sp500"].dropna()
    market = pd.read_csv(cg.MARKET_PATH, parse_dates=["date"]).set_index("date").sort_index()
    for c in ("gold", "brent_front"):
        if c in market and c not in lv:
            lv[c] = market[c].dropna()
    return {a: lv[a] for a, _, _ in ASSETS if a in lv and len(lv[a])}


def weekly_changes(series, asof):
    """금요일 마감 주 단위 변화 — 아직 끝나지 않은 주(라벨 금요일이 asof보다 뒤)는 뺀다."""
    out = {}
    for a, _, kind in ASSETS:
        if a not in series:
            continue
        w = series[a].resample("W-FRI").last().dropna()
        w = w[w.index <= asof]
        v = w.values
        out[a] = pd.Series(cg.change(v[:-1], v[1:], kind), index=w.index[1:])
    return pd.DataFrame(out)


def words(r):
    if abs(r) < 0.2:
        return "거의 따로 움직임"
    strength = "약하게" if abs(r) < 0.4 else "꽤" if abs(r) < 0.6 else "강하게"
    return f"{'같이' if r > 0 else '반대로'} {strength} 움직임"


def josa_wa(word):
    ch = word[-1]
    if "가" <= ch <= "힣":
        return word + ("과" if (ord(ch) - 0xAC00) % 28 else "와")
    return word + ("과" if ch.isdigit() and ch in "013678" else "와")


def describe(a, b, recent, long):
    head = f"{josa_wa(a)} {b}: 최근 6개월 {recent:+.2f}({words(recent)}), 2년 {long:+.2f}"
    if max(abs(recent), abs(long)) < 0.2:
        tail = "둘 다 거의 따로 움직임"
    elif (recent > 0) != (long > 0) and min(abs(recent), abs(long)) >= 0.2:
        tail = f"2년 동안은 {'같이' if long > 0 else '반대로'} 움직였는데 최근엔 {'같이' if recent > 0 else '반대로'} 움직임"
    elif abs(recent) > abs(long):
        tail = f"{'같이' if recent > 0 else '반대로'} 움직이는 정도가 강해짐"
    else:
        tail = "관계가 약해짐"
    return f"{head} — {tail}"


# 코스피가 빠질 때 받쳐 준 자산 — 가격이 코스피와 반대로 움직였나. 금리는 채권 가격과 반대라 부호를 뒤집는다
HEDGE = {"us10y": ("미국 국채", -1), "ktb10y": ("한국 국채", -1), "usdkrw": ("달러(원/달러)", 1), "dxy_ice": ("달러인덱스", 1),
         "gold": ("금", 1), "brent_front": ("원유", 1)}


def kospi_hedges(W):
    """최근 26주 — 자산 가격 변화와 코스피 변화의 상관이 -0.2보다 낮으면(반대로 움직였으면) '받쳐 줌'."""
    if "kospi" not in W:
        return [], ""
    out = []
    for a, (name, sign) in HEDGE.items():
        if a not in W:
            continue
        d = W[["kospi", a]].dropna().tail(RECENT)
        if len(d) < RECENT // 2:
            continue
        r = float(d.corr().iloc[0, 1]) * sign   # 가격 기준 상관
        out.append({"asset": name, "r": round(r, 2)})
    out.sort(key=lambda x: x["r"])
    good = [x for x in out if x["r"] <= -0.2]
    if good:
        line = "최근 6개월 코스피가 빠질 때 받쳐 준 자산: " + ", ".join(f"{x['asset']}({x['r']:+.2f})" for x in good)
    else:
        line = ("최근 6개월 코스피가 빠질 때 뚜렷하게 받쳐 준 자산 없음 — "
                + ", ".join(f"{x['asset']} {x['r']:+.2f}" for x in out[:3]) + " (가격 기준 상관, −0.2 아래면 받쳐 줌)")
    return out, line


def correlations(series):
    asof = max(s.index[-1] for s in series.values())
    W = weekly_changes(series, asof)
    label = {a: n for a, n, _ in ASSETS}
    week = W.index[-1].date().isoformat() if len(W) else None
    pairs = []
    for a, b in itertools.combinations([c for c in W.columns], 2):
        d = W[[a, b]].dropna()
        if len(d) < MIN_LONG:
            continue
        recent = d.tail(RECENT).corr().iloc[0, 1]
        long = d.tail(LONG).corr().iloc[0, 1]
        if recent != recent or long != long:
            continue
        flip = (recent > 0) != (long > 0) and min(abs(recent), abs(long)) >= 0.2
        diff = recent - long
        pairs.append({"a": label[a], "b": label[b], "recent": round(float(recent), 2), "long": round(float(long), 2),
                      "diff": round(float(diff), 2), "notable": bool(abs(diff) >= NOTABLE_DIFF or flip),
                      "text": describe(label[a], label[b], recent, long)})
    pairs.sort(key=lambda p: -abs(p["diff"]))
    hedges, hedge_line = kospi_hedges(W)
    notable = [p for p in pairs if p["notable"]][:2]
    short = lambda p: f"{p['a']}–{p['b']} {p['long']:+.2f} → {p['recent']:+.2f}({words(p['recent'])})"  # noqa: E731
    if notable:
        change_line = "2년 평균보다 눈에 띄게 바뀐 관계: " + " / ".join(short(p) for p in notable)
    else:
        moved = [p for p in pairs if max(abs(p["recent"]), abs(p["long"])) >= 0.3]
        change_line = "자산 사이 관계는 2년 평균과 크게 다르지 않음" + (f" — 가장 크게 바뀐 것은 {short(moved[0])}" if moved else "")
    return {"week": week, "recent_weeks": RECENT, "long_weeks": LONG, "pairs": pairs, "notable": notable,
            "hedges": hedges, "hedge_line": hedge_line, "change_line": change_line}


def write_if_changed(path, text):
    old = None
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            old = f.read()
    if old != text:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)


def update_log(result, path=LOG_PATH):
    rows = []
    if os.path.exists(path):
        with open(path, newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
    keys = {r["key"] for r in rows}
    for p in result["pairs"]:
        key = f"{result['week']} {p['a']}–{p['b']}"
        if key not in keys:
            rows.append({"key": key, "주": result["week"], "자산1": p["a"], "자산2": p["b"], "최근26주": p["recent"],
                         "2년": p["long"], "차이": p["diff"], "읽는법": p["text"]})
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=LOG_COLUMNS, lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow({c: r.get(c, "") for c in LOG_COLUMNS})
    write_if_changed(path, buf.getvalue())


def main():
    series = load_series()
    result = correlations(series)
    write_if_changed(JSON_PATH, json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    update_log(result)
    print(f"[INFO] {result['week']} 주까지 — 짝 {len(result['pairs'])}개, 눈에 띄는 변화 {len(result['notable'])}개")
    for p in result["pairs"][:5]:
        print(f"  {'*' if p['notable'] else ' '} {p['text']}")


if __name__ == "__main__":
    main()
