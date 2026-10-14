"""지금 지표 → 다음 예측 — 구글 시트 '회귀분석_예측' 탭용 (아침 수집 워크플로에서 실행).

두 가지를 같은 모양(지금 지표 · 예측 · 90% 범위 · 과거 성적 · 나중에 실제 값)으로 남긴다.

1. 오늘 한국 장 — 한국 장은 미국 장보다 먼저 닫으므로, 한국 장이 닫힌 뒤 끝난 미국 장(어젯밤)의 움직임은 다음 한국 장이
   아직 반영하지 않은 정보다. 그래서 이건 실제로 앞을 내다보는 회귀가 된다.
     코스피 하루 변화   ← 어젯밤 S&P500·필라델피아 반도체지수 변화율
     국고채 10년 하루 변화 ← 어젯밤 미 10년물(^TNX) 변화
   아침 6시대에 FRED(VIX·DGS10)는 아직 어젯밤 값이 없어서, 미국 장 값은 야후에서 따로 받는다(docs/data/overnight_us.csv).
   식은 최근 250거래일로 매일 다시 세우고, 과거 성적은 같은 방식으로 지난 기록을 하루씩 미리 맞혀 본 결과다.
2. 20거래일 뒤 코스피 — 지표 7개(compute_regression.py의 예측 검증과 같은 식). 과거에 미리 맞히기가 과거 평균보다
   못했으므로 '읽는법'에 그대로 적는다. 숫자를 보여 주되 믿을 근거가 없다는 걸 같이 보이게.

모든 예측은 docs/data/forecast_log.csv에 남기고, 실제 값이 나오면 채운다(시트도 빈칸 채우기로 따라감).
"""

import csv
import datetime
import io
import os
import sys

import numpy as np
import pandas as pd

import compute_regression as cg

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "docs", "data")
US_PATH = os.path.join(DATA_DIR, "overnight_us.csv")
LOG_PATH = os.path.join(DATA_DIR, "forecast_log.csv")
LATEST_PATH = os.path.join(DATA_DIR, "forecast_latest.json")  # 대시보드용 — 대상마다 가장 최근 '다음 한국 장' 예측과 채점 성적

US_SYMBOLS = {"sp500": "^GSPC", "sox": "^SOX", "tnx": "^TNX"}
US_LABEL = {"sp500": "S&P500", "sox": "필라델피아 반도체", "tnx": "미 10년물"}
US_KIND = {"sp500": "pct", "sox": "pct", "tnx": "bp"}
HISTORY_START = "2023-01-01"
TRAIN = 250   # 식을 세우는 최근 거래일 수
Z90 = 1.645

MODELS = [
    # (id, 대상(한국 장), 대상 이름, 설명변수들)
    ("kospi_next", "kospi", "코스피", ["sp500", "sox"]),
    ("ktb10y_next", "ktb10y", "국고채 10년", ["tnx"]),
]

LOG_COLUMNS = ["key", "기준일", "맞힐_대상", "맞힐_날", "지금_지표", "예측", "예측_90%_아래", "예측_90%_위", "단위",
               "과거_미리맞히기_R2", "과거_방향적중률", "읽는법", "실제", "범위_안", "방향_맞음", "모델"]

# 모델 경쟁 — 같은 입력으로 여러 모델을 지난 기록에 미리 맞혀 보고(최근 SCORE_DAYS일), 지금 모델(선형회귀)을 MARGIN 넘게
# 이긴 모델이 있을 때만 그 모델로 예측한다. 2026-10-14 시험(로컬 자료, 다음 한국 장 코스피)에서는 선형회귀 14.6% >
# 랜덤포레스트 7.2% > 부스팅 3.0% — 1년치로 학습하면 복잡한 모델이 우연한 패턴까지 외워서 오히려 나빴다.
INCUMBENT = "선형회귀"
MARGIN = 0.02        # 미리 맞히기 설명력 2%p 넘게 앞서야 바꾼다
SCORE_DAYS = 250     # 성적을 매기는 최근 미리 맞히기 날 수
REFIT_EVERY = 5      # 지난 기록을 되짚을 때 며칠마다 다시 학습하나(속도) — 오늘 예측은 늘 오늘까지로 새로 학습


def candidates():
    from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
    from sklearn.linear_model import LinearRegression, Ridge
    return {
        "선형회귀": LinearRegression,
        "릿지": lambda: Ridge(alpha=1.0),
        "랜덤포레스트": lambda: RandomForestRegressor(n_estimators=150, min_samples_leaf=10, random_state=0, n_jobs=-1),
        "부스팅": lambda: HistGradientBoostingRegressor(max_depth=3, learning_rate=0.05, max_iter=150, random_state=0),
    }


# ───────────────────────── 미국 장 값 (야후) ─────────────────────────

def normalize_tnx(s):
    """^TNX는 예전엔 수익률×10(42.5 = 4.25%)으로 오기도 했다 — %로 맞춘다."""
    s = s.astype(float)
    return s.where(s < 20, s / 10)


def load_us(path=US_PATH):
    if not os.path.exists(path):
        return pd.DataFrame(columns=list(US_SYMBOLS))
    return pd.read_csv(path, parse_dates=["date"]).set_index("date").sort_index()


def fetch_us(existing):
    """야후에서 받아 기존 파일과 합친다 — 처음이면 2023년부터, 아니면 최근 40일만 다시 받아 덮어쓴다."""
    from backfill_market_data import _fetch_series_fdr
    from collect_market_data import window_end

    end = window_end()
    start = (datetime.date.fromisoformat(HISTORY_START) if len(existing) < 500
             else end - datetime.timedelta(days=40))
    got = {}
    for col, sym in US_SYMBOLS.items():
        s = _fetch_series_fdr(sym, start, end)
        if s is not None and len(s):
            s.index = pd.to_datetime(s.index)
            got[col] = normalize_tnx(s) if col == "tnx" else s.astype(float)
    if not got:
        print("::warning title=미국 장 값 못 받음::야후 조회가 모두 실패 — 기존 overnight_us.csv로 계산", file=sys.stderr)
        return existing
    new = pd.DataFrame(got)
    merged = new.combine_first(existing) if len(existing) else new
    return merged.sort_index().round(4)


def save_us(df, path=US_PATH):
    out = df.copy()
    out.index = out.index.strftime("%Y-%m-%d")
    out.index.name = "date"
    text = out.to_csv(lineterminator="\n")
    old = None
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            old = f.read()
    if old != text:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)


# ───────────────────────── 오늘 한국 장 ─────────────────────────

def overnight_frame(y_levels, us, xs):
    """한국 거래일마다 (그날 하루 변화, 그 전 한국 장 마감 뒤 ~ 그날 전까지 끝난 미국 장들의 변화)."""
    dates = y_levels.index
    dy = cg.change(y_levels.values[:-1], y_levels.values[1:], cg.KIND[y_levels.name])
    cols, moved = {}, np.ones(len(dates) - 1, bool)
    for x in xs:
        s = us[x].dropna()
        xi = cg.asof_index(s, dates, strict=True)
        xl = np.where(xi >= 0, s.values[np.clip(xi, 0, None)], np.nan)
        cols[x] = cg.change(xl[:-1], xl[1:], US_KIND[x])
        moved &= xi[1:] > xi[:-1]
    df = pd.DataFrame({"dy": dy, **cols}, index=dates[1:])[moved]
    return df.replace([np.inf, -np.inf], np.nan).dropna()


def overnight_inputs(y_levels, us, xs):
    """다음 한국 장이 아직 반영하지 않은 미국 장 변화 — (기준 미국 장 날짜, {x: 변화}, 새 미국 장이 있었나)."""
    last_kr = y_levels.index[-1]
    out, latest, fresh = {}, None, True
    for x in xs:
        s = us[x].dropna()
        before = s[s.index < last_kr]   # 마지막 한국 장 때 이미 반영된 미국 장까지
        if not len(before) or not len(s):
            return None, {}, False
        out[x] = float(cg.change(np.array([before.iloc[-1]]), np.array([s.iloc[-1]]), US_KIND[x])[0])
        latest = s.index[-1] if latest is None else max(latest, s.index[-1])
        fresh &= s.index[-1] >= last_kr
    return latest, out, fresh


def walk_forward(df, xs, make, train=TRAIN, every=REFIT_EVERY):
    """지난 기록을 미리 맞혀 본다 — i일은 그 전 train일로 학습한 모델로(every일마다 다시 학습).
    반환: (예측, 실제, 그때의 과거 평균) 배열 — 모두 train일째부터."""
    X, Y = df[xs].values, df["dy"].values
    preds, base = np.full(len(Y), np.nan), np.full(len(Y), np.nan)
    model = None
    for i in range(train, len(Y)):
        if model is None or (i - train) % every == 0:
            model = make().fit(X[i - train:i], Y[i - train:i])
            mean = Y[i - train:i].mean()
        preds[i] = model.predict(X[i:i + 1])[0]
        base[i] = mean
    return preds[train:], Y[train:], base[train:]


def score_record(pred, actual, base, days=SCORE_DAYS):
    """최근 days일 미리 맞히기 성적 — (설명력: 과거 평균보다 얼마나 나았나, 방향 적중률, 시도 수, 빗나간 폭의 표준편차)."""
    p, y, b = pred[-days:], actual[-days:], base[-days:]
    e0 = ((y - b) ** 2).sum()
    r2 = 1 - ((y - p) ** 2).sum() / e0 if e0 else float("nan")
    nz = (p != 0) & (y != 0)
    rate = float((np.sign(p[nz]) == np.sign(y[nz])).mean()) if nz.any() else float("nan")
    return float(r2), rate, int(nz.sum()), float(np.std(y - p, ddof=1))


def compete(df, xs, makers=None):
    """후보 모델마다 최근 성적을 매기고 쓸 모델을 고른다 — 지금 모델을 MARGIN 넘게 이긴 모델이 있을 때만 바꾼다."""
    makers = makers or candidates()
    board = {}
    for name, make in makers.items():
        r2, rate, n, sd = score_record(*walk_forward(df, xs, make))
        board[name] = {"oos": r2, "dir": rate, "n": n, "sd": sd}
    best = max(board, key=lambda k: board[k]["oos"])
    chosen = best if board[best]["oos"] - board[INCUMBENT]["oos"] > MARGIN else INCUMBENT
    return chosen, board, makers


def next_weekday(d):
    d = d + datetime.timedelta(days=1)
    while d.weekday() >= 5:
        d += datetime.timedelta(days=1)
    return d


def fmt_move(v, kind):
    return f"{v:+.2f}%" if kind == "pct" else f"{v:+.1f}bp"


def overnight_rows(levels, us):
    rows = []
    for mid, ycol, yname, xs in MODELS:
        if ycol not in levels or any(x not in us or not us[x].notna().any() for x in xs):
            continue
        y = levels[ycol].rename(ycol)
        df = overnight_frame(y, us, xs)
        if len(df) < TRAIN + 20:
            continue
        us_date, inp, fresh = overnight_inputs(y, us, xs)
        if us_date is None or not fresh:
            # 마지막 한국 장 뒤에 끝난 미국 장이 없으면(미국 휴장 등) 새로 알 게 없어 예측을 남기지 않는다
            print(f"[INFO] {yname}: 마지막 한국 장({y.index[-1].date()}) 뒤 끝난 미국 장 없음 — 다음 한국 장 예측 건너뜀")
            continue
        x_now = np.array([[inp[x] for x in xs]])
        chosen, board, makers = compete(df, xs)
        model = makers[chosen]().fit(df[xs].values[-TRAIN:], df["dy"].values[-TRAIN:])
        pred = float(model.predict(x_now)[0])
        oos, dir_rate, tried, sd = (board[chosen][k] for k in ("oos", "dir", "n", "sd"))  # 범위는 미리 맞혔을 때 빗나간 폭으로
        unit = cg.UNIT[cg.KIND[ycol]]
        now_txt = f"어젯밤({us_date.month}/{us_date.day}) 미국 장 " + " · ".join(
            f"{US_LABEL[x]} {fmt_move(inp[x], US_KIND[x])}" for x in xs)
        target = next_weekday(max(us_date, y.index[-1]).date())
        lo, hi = pred - Z90 * sd, pred + Z90 * sd
        rows.append({
            "key": f"{us_date.date()} 다음 한국 장 {yname}", "기준일": us_date.date().isoformat(),
            "맞힐_대상": f"{yname} 다음 거래일 변화", "맞힐_날": f"{target.isoformat()} 무렵",
            "지금_지표": now_txt,
            "예측": round(pred, 3), "예측_90%_아래": round(lo, 3), "예측_90%_위": round(hi, 3), "단위": unit,
            "과거_미리맞히기_R2": round(oos, 3), "과거_방향적중률": round(dir_rate, 3),
            "읽는법": (f"{yname} 평균 {pred:+.2f}{unit} 예상, 열 번 중 아홉 번은 {lo:+.2f}~{hi:+.2f}{unit} — "
                     f"최근 {tried}거래일 미리 맞히기({chosen}) 설명력 {oos * 100:.0f}%, 방향 {dir_rate * 100:.0f}%"
                     + ("" if oos > 0.05 else " (설명력이 낮아 참고만)")),
            "실제": "", "범위_안": "", "방향_맞음": "", "모델": chosen,
            "_kind": "next", "_ycol": ycol, "_board": board, "_chosen": chosen,
        })
    return rows


# ───────────────────────── 20거래일 뒤 코스피 ─────────────────────────

def month_row(levels):
    if "kospi" not in levels:
        return None
    k = levels["kospi"]
    dates = k.index

    def us(col, fn):
        return cg.asof(fn(levels[col]), dates, strict=True)

    four = lambda s: s - s.shift(cg.HORIZON)  # noqa: E731
    pct4 = lambda s: np.log(s / s.shift(cg.HORIZON)) * 100  # noqa: E731
    X = pd.DataFrame({
        "ccc_4w": us("ccc_oas", four) * 100, "hy_4w": us("hy_oas", four) * 100, "vix": us("vix", lambda s: s),
        "us10y_4w": us("us10y", four) * 100, "dxy_4w": us("dxy_ice", pct4), "usdkrw_4w": us("usdkrw", pct4),
        "kospi_4w": (np.log(k / k.shift(cg.HORIZON)) * 100).values,
    }, index=dates)
    now = X.iloc[-1]
    if now.isna().any():
        return None
    F = cg.forecast_frame(levels)
    if len(F) < cg.MIN_TRAIN + 5:
        return None
    Xf, Yf = F[cg.FORECAST_X].values, F["y"].values
    b, _, _ = cg.ols(Xf, Yf)
    resid = Yf - (b[0] + Xf @ b[1:])
    sd = float(np.std(resid, ddof=len(cg.FORECAST_X) + 1))
    pred = float(b[0] + now[cg.FORECAST_X].values @ b[1:])
    oos, hit, tried = cg.walk_forward(Xf, Yf)
    base = dates[-1].date()
    words = {"ccc_4w": ("CCC 4주", "bp", 0), "hy_4w": ("하이일드 4주", "bp", 0), "vix": ("VIX", "", 1),
             "us10y_4w": ("미10년 4주", "bp", 0), "dxy_4w": ("달러 4주", "%", 1), "usdkrw_4w": ("원달러 4주", "%", 1),
             "kospi_4w": ("코스피 4주", "%", 1)}
    now_txt = " · ".join(f"{w} {now[c]:{'+' if u else ''}.{d}f}{u}" for c, (w, u, d) in words.items())
    lo, hi = pred - Z90 * sd, pred + Z90 * sd
    good = oos > 0.05 and tried and hit / tried > 0.6
    return {
        "key": f"{base} 코스피 20거래일 뒤", "기준일": base.isoformat(), "맞힐_대상": "코스피 20거래일 뒤 수익률",
        "맞힐_날": f"{cg_add_weekdays(base, cg.HORIZON).isoformat()} 무렵", "지금_지표": now_txt,
        "예측": round(pred, 3), "예측_90%_아래": round(lo, 3), "예측_90%_위": round(hi, 3), "단위": "%",
        "과거_미리맞히기_R2": round(oos, 3), "과거_방향적중률": round(hit / tried, 3) if tried else "",
        "읽는법": (f"지금 지표로 계산하면 {pred:+.1f}%, 90% 범위 {lo:+.1f}~{hi:+.1f}% — "
                 + ("과거 미리 맞히기가 과거 평균보다 나았음(표본 작음)" if good
                    else f"과거 미리 맞히기가 과거 평균보다 못했음(설명력 {oos * 100:.0f}%) — 예측으로 쓰지 말 것")),
        "실제": "", "범위_안": "", "방향_맞음": "", "_kind": "month", "_ycol": "kospi",
    }


def cg_add_weekdays(d, n):
    while n > 0:
        d += datetime.timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d


# ───────────────────────── 기록 · 채점 ─────────────────────────

def read_log(path=LOG_PATH):
    if not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def score(row, levels):
    """실제 값이 나왔으면 채운다 — 다음 한국 장은 기준일(미국 장) 뒤 첫 한국 거래일의 하루 변화, 20일은 20거래일 뒤 수익률."""
    if row.get("실제") not in ("", None):
        return False
    key = row["key"]
    base = pd.Timestamp(row["기준일"])
    if "다음 한국 장" in key:
        ycol = "kospi" if key.endswith("코스피") else "ktb10y"
        s = levels.get(ycol)
        if s is None:
            return False
        after = s[s.index > base]
        before = s[s.index <= base]
        if not len(after) or not len(before):
            return False
        actual = float(cg.change(np.array([before.iloc[-1]]), np.array([after.iloc[0]]), cg.KIND[ycol])[0])
    else:
        s = levels.get("kospi")
        if s is None or base not in s.index:
            return False
        i = s.index.get_loc(base)
        if i + cg.HORIZON >= len(s):
            return False
        actual = float(np.log(s.iloc[i + cg.HORIZON] / s.iloc[i]) * 100)
    lo, hi, pred = float(row["예측_90%_아래"]), float(row["예측_90%_위"]), float(row["예측"])
    row["실제"] = round(actual, 3)
    row["범위_안"] = 1 if lo <= actual <= hi else 0
    row["방향_맞음"] = "" if actual == 0 or pred == 0 else (1 if (actual > 0) == (pred > 0) else 0)
    return True


def write_log(rows, path=LOG_PATH):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=LOG_COLUMNS, lineterminator="\n")
    w.writeheader()
    for r in sorted(rows, key=lambda r: r["key"]):
        w.writerow({c: r.get(c, "") for c in LOG_COLUMNS})
    text = buf.getvalue()
    old = None
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            old = f.read()
    if old != text:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if f != f else f  # nan은 JSON에 못 넣는다


def latest_summary(log, boards=None):
    """대시보드가 글로 보여 줄 것 — 대상마다 가장 최근 다음 한국 장 예측, 그리고 지금까지 미리 낸 예측의 채점 결과."""
    items = []
    for _, _, name, _ in MODELS:
        rows = [r for r in log if r["key"].endswith(f"다음 한국 장 {name}")]
        if not rows:
            continue
        r = max(rows, key=lambda r: r["기준일"])
        scored = [x for x in rows if _num(x.get("실제")) is not None]
        dirs = [x for x in scored if str(x.get("방향_맞음")) not in ("", "None")]
        items.append({
            "name": name, "base": r["기준일"], "target": r["맞힐_날"].replace(" 무렵", ""),
            "pred": _num(r["예측"]), "lo": _num(r["예측_90%_아래"]), "hi": _num(r["예측_90%_위"]), "unit": r["단위"],
            "inputs": r["지금_지표"], "oos": _num(r["과거_미리맞히기_R2"]), "dir_rate": _num(r["과거_방향적중률"]),
            "scored": r is not None and _num(r.get("실제")) is not None, "actual": _num(r.get("실제")),
            "live": {"n": len(scored), "in_range": sum(1 for x in scored if str(x["범위_안"]).startswith("1")),
                     "dir_tried": len(dirs), "dir_hits": sum(1 for x in dirs if str(x["방향_맞음"]).startswith("1"))},
            "model": r.get("모델") or INCUMBENT,
            "board": (boards or {}).get(name),
        })
    return {"next": items}


def write_latest(summary, path=LATEST_PATH):
    import json
    text = json.dumps(summary, ensure_ascii=False, indent=2) + "\n"
    old = None
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            old = f.read()
    if old != text:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)


def main(fetch=True):
    from collect_market_data import window_end
    # 아직 끝나지 않은 장 값은 빼고 본다(수집이 장중에 돌았던 CSV여도 기준일이 장중 값이 되지 않게)
    end = pd.Timestamp(window_end())
    levels = {k: v[v.index < end] for k, v in cg.load_levels().items()}
    us = load_us()
    if fetch:
        us = fetch_us(us)
        save_us(us)
    new = overnight_rows(levels, us)
    m = month_row(levels)
    if m:
        new.append(m)
    log = read_log()
    keys = {r["key"] for r in log}
    added = [r for r in new if r["key"] not in keys]
    log += added
    filled = sum(score(r, levels) for r in log)
    write_log(log)
    boards = {r["key"].split("다음 한국 장 ")[-1]: [{"name": k, "oos": _num(round(v["oos"], 3)), "dir": _num(round(v["dir"], 3))}
                                                  for k, v in r["_board"].items()]
              for r in new if r.get("_board")}
    old = {}
    if os.path.exists(LATEST_PATH):  # 오늘 새 예측이 없으면(미국 휴장 등) 지난 경쟁 성적을 그대로 둔다
        import json
        with open(LATEST_PATH, encoding="utf-8") as f:
            old = {x["name"]: x.get("board") for x in json.load(f).get("next", [])}
    write_latest(latest_summary(log, {**old, **boards}))
    print(f"[INFO] 예측 {len(new)}건(새로 {len(added)}), 실제 값 채움 {filled}건")
    for r in new:
        print(f"  {r['맞힐_대상']} ({r['맞힐_날']}): {r['지금_지표']}\n    → {r['읽는법']}")


if __name__ == "__main__":
    main(fetch="--no-fetch" not in sys.argv)
