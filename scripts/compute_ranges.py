"""한 달 뒤 예상 범위 — 방향이 아니라 '얼마나 움직일 수 있나'를 계산하고, 맞았는지 기록한다 (수집 워크플로에서 매일 실행).

방법 (지표마다 같은 규칙, 따로 맞춘 숫자 없음)
  1. 최근 60거래일의 하루 변화로 하루 변동 폭(표준편차)을 잰다 — 가격은 로그 수익률, 금리는 bp 변화.
  2. 그 폭이 20거래일 동안 이어진다고 보고(√20배), 지금 값에서 위아래 1.645배 = 90% 범위.
     방향은 보지 않는다(가운데가 항상 지금 값). 앞으로 오를지 내릴지는 맞힐 근거가 없어서다
     (2026-10-14 이 저장소 데이터로 확인: 지표 변화와 20일 뒤 코스피 수익률 상관 -0.2~+0.2, 우연과 구별 안 됨).
  3. 같은 계산을 지난 기록의 매일에 되짚어 해 보고(그날까지의 값만 사용), 20거래일 뒤 값이 범위 안에 든 비율을 적는다.
  4. 오늘 낸 범위는 docs/data/range_log.csv에 남기고, 20거래일이 지나면 실제 값과 적중 여부를 채운다 — 되짚은 적중률과 별개로
     '실제로 미리 낸 범위'의 성적. 구글 시트 range_log 탭으로도 간다(push_to_sheets.py).

대상: 원/달러·코스피·미 10년물·달러인덱스. VIX는 튀었다 금방 돌아오고(범위가 너무 넓게 나옴), 신용 스프레드는 한 방향으로
오래 밀려서(너무 좁게 나옴) 이 방법이 맞지 않아 뺐다 (2023-11~2026-10 되짚어 90% 범위 적중 VIX 95%, CCC 81%).

출력: docs/data/ranges.json (화면용), docs/data/range_log.csv (기록). 같은 날 여러 번 돌아도 값이 같으면 파일이 바뀌지 않는다.
"""

import csv
import datetime
import io
import json
import math
import os

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "docs", "data")
MARKET_PATH = os.path.join(DATA_DIR, "market_snapshot.csv")
JSON_PATH = os.path.join(DATA_DIR, "ranges.json")
LOG_PATH = os.path.join(DATA_DIR, "range_log.csv")

HORIZON = 20      # 거래일 (약 한 달)
WINDOW = 60       # 변동 폭을 재는 최근 거래일 수 (약 3개월)
Z = 1.645         # 정규분포 양쪽 90%
LEVEL = 0.9

# (컬럼, 이름, 변화 단위) — log: 가격(비율로 움직임), bp: 금리(%p 차이를 bp로)
SERIES = [
    ("usdkrw", "원/달러", "log"),
    ("kospi", "코스피", "log"),
    ("us10y", "미 10년물", "bp"),
    ("dxy_ice", "달러인덱스", "log"),
]
LOG_COLUMNS = ["key", "id", "base_date", "base", "lo", "hi", "due", "after_date", "after", "inside"]


def load_points(path=MARKET_PATH):
    """컬럼별 (날짜, 값) 목록 — 빈칸은 건너뛴다(휴장일)."""
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    out = {}
    for col, _, _ in SERIES:
        pts = []
        for r in rows:
            v = (r.get(col) or "").strip()
            if v:
                try:
                    pts.append((r["date"], float(v)))
                except ValueError:
                    pass
        out[col] = sorted(pts)
    return out


def change(prev, cur, kind):
    return math.log(cur / prev) if kind == "log" else (cur - prev) * 100


def daily_sigma(values, end, kind, window=WINDOW):
    """values[end]까지(포함)의 최근 window개 하루 변화의 표본표준편차 — 모자라면 None."""
    if end < window:
        return None
    ch = [change(values[i - 1], values[i], kind) for i in range(end - window + 1, end + 1)]
    m = sum(ch) / window
    return math.sqrt(sum((c - m) ** 2 for c in ch) / (window - 1))


def band(base, sigma, kind, steps=HORIZON, z=Z):
    """steps거래일 뒤 범위 (아래, 위)."""
    s = z * sigma * math.sqrt(steps)
    if kind == "log":
        return base * math.exp(-s), base * math.exp(s)
    return base - s / 100, base + s / 100


def add_weekdays(date_str, n):
    """주말만 건너뛴 n영업일 뒤 — 휴장일은 몰라서 '무렵'으로만 쓴다."""
    d = datetime.date.fromisoformat(date_str)
    while n > 0:
        d += datetime.timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d.isoformat()


def backtest(points, kind):
    """지난 기록의 매일에 같은 계산을 되짚어 — 그날까지의 값으로 범위를 내고 20거래일 뒤 값이 안에 들었나."""
    values = [v for _, v in points]
    inside = above = below = 0
    first = None
    for i in range(WINDOW, len(values) - HORIZON):
        sig = daily_sigma(values, i, kind)
        lo, hi = band(values[i], sig, kind)
        after = values[i + HORIZON]
        first = first or points[i][0]
        if after > hi:
            above += 1
        elif after < lo:
            below += 1
        else:
            inside += 1
    days = inside + above + below
    return {"days": days, "inside": inside, "above": above, "below": below,
            "rate": round(inside / days, 3) if days else None, "from": first,
            "to": points[len(values) - HORIZON - 1][0] if days else None}


def rnd(v):
    return round(v, 4)


def read_log(path=LOG_PATH):
    if not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def update_log(log, today_items, points):
    """오늘 범위를 (기준일·지표마다 한 줄) 더하고, 20거래일이 지난 줄은 실제 값·적중을 채운다. 바뀌었으면 True."""
    changed = False
    keys = {r["key"] for r in log}
    for it in today_items:
        key = f"{it['base_date']} {it['id']}"
        if key in keys:
            continue  # 같은 기준일 범위는 처음 낸 것을 그대로 둔다 (밤 갱신·예비 실행이 다시 돌아도)
        log.append({"key": key, "id": it["id"], "base_date": it["base_date"], "base": rnd(it["base"]),
                    "lo": rnd(it["lo"]), "hi": rnd(it["hi"]), "due": it["due"], "after_date": "", "after": "", "inside": ""})
        keys.add(key)
        changed = True
    for r in log:
        if r.get("after") not in ("", None):
            continue
        pts = points.get(r["id"], [])
        idx = next((i for i, (d, _) in enumerate(pts) if d == r["base_date"]), None)
        if idx is None or idx + HORIZON >= len(pts):
            continue
        d, v = pts[idx + HORIZON]
        r["after_date"], r["after"] = d, rnd(v)
        r["inside"] = 1 if float(r["lo"]) <= v <= float(r["hi"]) else 0
        changed = True
    log.sort(key=lambda r: r["key"])
    return changed


def live_stats(log, sid):
    rows = [r for r in log if r["id"] == sid]
    done = [r for r in rows if str(r.get("inside")) in ("0", "1", "0.0", "1.0")]
    pending = sorted(r["due"] for r in rows if r not in done)
    return {"n": len(done), "inside": sum(1 for r in done if str(r["inside"]).startswith("1")),
            "next_due": pending[0] if pending else None}


def compute(points):
    items = []
    for col, label, kind in SERIES:
        pts = points.get(col, [])
        values = [v for _, v in pts]
        sig = daily_sigma(values, len(values) - 1, kind) if values else None
        if sig is None:
            print(f"[WARN] {col}: 값이 {len(values)}개뿐이라 범위를 계산하지 않음")
            continue
        base_date, base = pts[-1]
        lo, hi = band(base, sig, kind)
        items.append({"id": col, "label": label, "kind": kind, "base_date": base_date, "base": base,
                      "lo": lo, "hi": hi, "sigma": sig, "due": add_weekdays(base_date, HORIZON),
                      "backtest": backtest(pts, kind)})
    return items


def write_if_changed(path, text):
    old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
    if old != text:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        return True
    return False


def main():
    points = load_points()
    items = compute(points)
    log = read_log()
    update_log(log, items, points)

    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=LOG_COLUMNS, lineterminator="\n")
    w.writeheader()
    for r in log:
        w.writerow({c: r.get(c, "") for c in LOG_COLUMNS})
    write_if_changed(LOG_PATH, buf.getvalue())

    out = {
        "horizon": HORIZON, "window": WINDOW, "level": LEVEL,
        "items": [{**{k: (rnd(v) if isinstance(v, float) else v) for k, v in it.items() if k != "sigma"},
                   "sigma": round(it["sigma"], 6), "live": live_stats(log, it["id"])} for it in items],
    }
    write_if_changed(JSON_PATH, json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    for it in out["items"]:
        bt = it["backtest"]
        print(f"[INFO] {it['label']}: {it['base_date']} {it['base']} → 90% 범위 {it['lo']} ~ {it['hi']} ({it['due']} 무렵)"
              f" · 되짚은 적중 {bt['rate']} ({bt['days']}일, 위로 {bt['above']}·아래로 {bt['below']})")


if __name__ == "__main__":
    main()
