"""회귀분석 — 구글 시트 '회귀분석_민감도'·'회귀분석_예측검증' 탭용 (수집 워크플로에서 매일 실행).

1. 민감도 (같이 움직이는 정도) — 하루 변화끼리 회귀. "달러인덱스가 1% 오른 날 원/달러는 평균 몇 % 움직였나".
   미래를 맞히는 식이 아니라 지금 관계를 재는 것: 한쪽이 움직이면 다른 쪽이 대략 얼마나 따라왔는지.
   한국 장(코스피·국고채)은 미국 장보다 먼저 닫으므로 미국 쪽은 '그 한국 거래일 전에 끝난 미국 장'까지의 변화를 쓴다.
2. 예측 검증 (미리 맞힐 수 있나) — 지표로 20거래일 뒤 코스피 수익률을 회귀하고, 그때그때 그 전까지의 자료만으로
   식을 세워 다음 구간을 맞혀 본다(walk-forward). 표본 안 설명력은 지표를 늘릴수록 부풀기 때문에 '미리 맞히기' 값이 기준이다.
   겹치지 않는 20거래일 구간만 써서 같은 움직임을 여러 번 세지 않는다.

출력: docs/data/regression_sensitivity.csv, docs/data/regression_forecast.csv — 기준일(데이터 마지막 날)마다 줄을 더하는
기록이라 시트에서 계수가 어떻게 바뀌어 왔는지도 볼 수 있다. 같은 기준일로 다시 돌면 그 줄은 그대로 둔다(시트도 키가 같으면 안 씀).
"""

import csv
import io
import math
import os

import numpy as np
import pandas as pd

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "docs", "data")
MARKET_PATH = os.path.join(DATA_DIR, "market_snapshot.csv")
KOREA_PATH = os.path.join(DATA_DIR, "korea_snapshot.csv")
SENS_PATH = os.path.join(DATA_DIR, "regression_sensitivity.csv")
FCST_PATH = os.path.join(DATA_DIR, "regression_forecast.csv")

LABEL = {"usdkrw": "원/달러", "usdkrw_fred": "원/달러(FRED)", "dxy_ice": "달러인덱스", "kospi": "코스피", "us10y": "미 10년물", "vix": "VIX",
         "ktb10y": "국고채 10년", "gold": "금", "real10y": "미 10년 실질금리", "ccc_oas": "CCC 스프레드",
         "hy_oas": "하이일드 스프레드"}
# 변화 단위 — pct: 로그 변화율(%), bp: 금리·스프레드 차이(bp), pt: 지수 포인트 차이
KIND = {"usdkrw": "pct", "usdkrw_fred": "pct", "dxy_ice": "pct", "kospi": "pct", "gold": "pct", "us10y": "bp", "real10y": "bp",
        "ktb10y": "bp", "ccc_oas": "bp", "hy_oas": "bp", "vix": "pt"}
PER = {"pct": (1.0, "1%"), "bp": (10.0, "10bp"), "pt": (1.0, "1pt")}  # 설명변수를 이만큼 움직일 때로 계수를 읽는다
UNIT = {"pct": "%", "bp": "bp", "pt": "pt"}
KOREA_CLOSE = {"kospi", "ktb10y"}  # 한국 장 마감 값 — 미국 쪽 설명변수는 그 전날까지

# (대상, 설명변수) — 대상이 한국 장이면 미국 설명변수는 한국 거래일 '전'까지의 값
# 원/달러는 FRED(DEXKOUS, 뉴욕 정오 기준)로 — 야후 KRW=X 일봉은 날짜 경계가 달러인덱스(뉴욕 마감)와 달라 하루치가 둘로
# 갈린다(최근 1년 상관: 같은 날 0.23·하루 뒤 0.27 vs FRED 같은 날 0.45, 2026-10-14 확인)
PAIRS = [
    ("usdkrw_fred", "dxy_ice"),
    ("kospi", "us10y"),
    ("kospi", "vix"),
    ("ktb10y", "us10y"),
    ("gold", "real10y"),
    ("gold", "dxy_ice"),
]
RECENT = 250  # 최근 1년(거래일)

HORIZON = 20
MIN_TRAIN = 15  # 미리 맞히기를 시작하기 전 최소 구간 수
FORECAST_X = ["ccc_4w", "hy_4w", "vix", "us10y_4w", "dxy_4w", "usdkrw_4w", "kospi_4w"]
FORECAST_LABEL = {"ccc_4w": "CCC 스프레드 4주 변화", "hy_4w": "하이일드 스프레드 4주 변화", "vix": "VIX 수준",
                  "us10y_4w": "미 10년물 4주 변화", "dxy_4w": "달러인덱스 4주 변화율", "usdkrw_4w": "원/달러 4주 변화율",
                  "kospi_4w": "코스피 4주 수익률"}

SENS_COLUMNS = ["key", "기준일", "대상", "설명변수", "기간", "표본_일", "계수", "계수_95%_아래", "계수_95%_위", "설명력_R2", "읽는법"]
FCST_COLUMNS = ["key", "기준일", "맞힐_대상", "설명변수", "기간", "표본_구간", "표본안_R2", "보정_R2", "미리맞히기_R2",
                "방향_적중", "방향_시도", "읽는법"]


def load_levels():
    """컬럼별 수준 Series(날짜 오름차순, 빈칸 제외)."""
    m = pd.read_csv(MARKET_PATH, parse_dates=["date"]).set_index("date").sort_index()
    out = {c: m[c].dropna() for c in m.columns if c in KIND}
    if os.path.exists(KOREA_PATH):
        k = pd.read_csv(KOREA_PATH, parse_dates=["date"]).set_index("date").sort_index()
        if "ktb10y" in k:
            out["ktb10y"] = k["ktb10y"].dropna()
    return out


def change(a, b, kind):
    """a → b 변화 (a·b는 같은 길이의 배열)"""
    if kind == "pct":
        return np.log(b / a) * 100
    if kind == "bp":
        return (b - a) * 100
    return b - a


def asof_index(levels, dates, strict):
    """dates 각 날짜 기준 마지막 관측의 위치(-1이면 없음) — strict면 그날 '전'까지만
    (한국 장 마감 뒤에 열리는 그날 미국 장 값이 섞이지 않게)."""
    return levels.index.searchsorted(dates, side="left" if strict else "right") - 1


def asof(levels, dates, strict):
    idx = asof_index(levels, dates, strict)
    return np.where(idx >= 0, levels.values[np.clip(idx, 0, None)], np.nan)


def paired_changes(levels, y, x):
    """대상 y의 거래일마다 (y 하루 변화, 같은 구간의 x 변화) — x는 y의 직전 거래일~그날 사이 변화.
    그 사이 x에 새 관측이 없었으면(x 쪽 휴장) 그 날은 뺀다."""
    ys = levels[y]
    dates = ys.index
    strict = y in KOREA_CLOSE and x not in KOREA_CLOSE
    xi = asof_index(levels[x], dates, strict)
    xl = np.where(xi >= 0, levels[x].values[np.clip(xi, 0, None)], np.nan)
    dy = change(ys.values[:-1], ys.values[1:], KIND[y])
    dx = change(xl[:-1], xl[1:], KIND[x])
    moved = xi[1:] > xi[:-1]
    df = pd.DataFrame({"dy": dy, "dx": dx}, index=dates[1:])[moved]
    return df.replace([np.inf, -np.inf], np.nan).dropna()


def ols(X, y):
    """절편 포함 최소제곱 — (계수들, 표준오차들, R²). X는 (n, k)."""
    A = np.column_stack([np.ones(len(X)), X])
    beta, *_ = np.linalg.lstsq(A, y, rcond=None)
    resid = y - A @ beta
    n, p = A.shape
    sst = ((y - y.mean()) ** 2).sum()
    r2 = 1 - (resid ** 2).sum() / sst if sst > 0 else float("nan")
    if n > p:
        s2 = (resid ** 2).sum() / (n - p)
        cov = s2 * np.linalg.pinv(A.T @ A)
        se = np.sqrt(np.diag(cov))
    else:
        se = np.full(p, np.nan)
    return beta, se, r2


def josa(word, pair):
    """받침 있으면 pair[0], 없으면 pair[1] — '미 10년물이', 'VIX가', '금은', '국고채 10년은'."""
    ch = word.rstrip(")").split("(")[0].strip()[-1]
    if "가" <= ch <= "힣":
        has = (ord(ch) - 0xAC00) % 28 != 0
    elif ch.isdigit():
        has = ch in "013678"  # 영·일·삼·육·칠·팔
    else:
        has = ch.upper() in "LMNR"  # 엘·엠·엔·알
    return word + (pair[0] if has else pair[1])


def sensitivity_rows(levels, asof_date):
    rows = []
    for y, x in PAIRS:
        if y not in levels or x not in levels:
            continue
        df = paired_changes(levels, y, x)
        for name, part in (("최근 1년", df.tail(RECENT)), ("전체", df)):
            if len(part) < 60:
                continue
            per, per_label = PER[KIND[x]]
            beta, se, r2 = ols(part[["dx"]].values, part["dy"].values)
            b, s = beta[1] * per, se[1] * per
            unit = UNIT[KIND[y]]
            word = "올랐" if b >= 0 else "내렸"
            lo, hi = b - 1.96 * s, b + 1.96 * s
            unsure = " · 95% 범위가 0을 넘나듦 — 관계가 있다고 말하기 어려움" if lo < 0 < hi else ""
            rows.append({
                "key": f"{asof_date} 민감도 {LABEL[y]}←{LABEL[x]} {name}",
                "기준일": asof_date, "대상": LABEL[y], "설명변수": LABEL[x],
                "기간": f"{part.index[0].date()}~{part.index[-1].date()} ({name})", "표본_일": len(part),
                "계수": round(b, 4), "계수_95%_아래": round(lo, 4), "계수_95%_위": round(hi, 4),
                "설명력_R2": round(r2, 3),
                "읽는법": (f"{josa(LABEL[x], '이가')} {per_label} 오른 날 {josa(LABEL[y], '은는')} 평균 {abs(b):.2f}{unit} {word}음"
                          f"{' (미국 전날 장 기준)' if y in KOREA_CLOSE and x not in KOREA_CLOSE else ''}"
                          f" · 하루 움직임의 {r2 * 100:.0f}%를 설명{unsure}"),
            })
    return rows


def forecast_frame(levels):
    """겹치지 않는 20거래일 구간 — 코스피 거래일 t 마감 때 알던 지표로 t→t+20 수익률."""
    k = levels["kospi"]
    dates = k.index

    def us(col, fn):
        s = levels[col]
        return asof(fn(s), dates, strict=True)  # 그 한국 거래일 전에 끝난 미국 장까지

    four = lambda s: s - s.shift(HORIZON)  # noqa: E731 — 그 시리즈 자체 20관측 전 대비
    pct4 = lambda s: np.log(s / s.shift(HORIZON)) * 100  # noqa: E731
    X = pd.DataFrame({
        "ccc_4w": us("ccc_oas", four) * 100,
        "hy_4w": us("hy_oas", four) * 100,
        "vix": us("vix", lambda s: s),
        "us10y_4w": us("us10y", four) * 100,
        "dxy_4w": us("dxy_ice", pct4),
        "usdkrw_4w": us("usdkrw", pct4),
        "kospi_4w": (np.log(k / k.shift(HORIZON)) * 100).values,
    }, index=dates)
    X["y"] = (np.log(k.shift(-HORIZON) / k) * 100).values
    X = X.dropna()
    return X.iloc[::HORIZON]


def walk_forward(X, y):
    """i번째 구간을 그 전 구간들로만 세운 식으로 맞힌다 — (미리맞히기 R², 방향 적중, 시도)."""
    err_m = err_0 = 0.0
    hit = tried = 0
    for i in range(MIN_TRAIN, len(y)):
        beta, _, _ = ols(X[:i], y[:i])
        pred = beta[0] + X[i] @ beta[1:]
        err_m += (y[i] - pred) ** 2
        err_0 += (y[i] - y[:i].mean()) ** 2
        if y[i] != 0 and pred != 0:
            tried += 1
            hit += int(math.copysign(1, pred) == math.copysign(1, y[i]))
    return (1 - err_m / err_0 if err_0 > 0 else float("nan")), hit, tried


def verdict(oos, hit, tried):
    if oos != oos:  # nan
        return "표본 부족"
    rate = hit / tried if tried else 0
    if oos > 0.05 and rate > 0.6:
        return f"미리 맞히기가 과거 평균보다 나음(방향 {rate * 100:.0f}%) — 표본이 작아 몇 달 더 지켜볼 것"
    if oos > 0:
        return "과거 평균과 비슷 — 예측력 거의 없음"
    return "과거 평균보다 못함 — 예측력 없음"


def forecast_rows(levels, asof_date):
    if "kospi" not in levels:
        return []
    F = forecast_frame(levels)
    if len(F) < MIN_TRAIN + 5:
        return []
    period = f"{F.index[0].date()}~{F.index[-1].date()}"
    Y = F["y"].values
    rows = []
    sets = [([c], FORECAST_LABEL[c]) for c in FORECAST_X] + [(FORECAST_X, f"위 {len(FORECAST_X)}개 함께")]
    for cols, name in sets:
        Xv = F[cols].values
        _, _, r2 = ols(Xv, Y)
        n, k = len(Y), len(cols)
        adj = 1 - (1 - r2) * (n - 1) / (n - k - 1)
        oos, hit, tried = walk_forward(Xv, Y)
        rows.append({
            "key": f"{asof_date} 예측검증 코스피20일←{name}", "기준일": asof_date,
            "맞힐_대상": f"코스피 {HORIZON}거래일 뒤 수익률", "설명변수": name, "기간": period, "표본_구간": n,
            "표본안_R2": round(r2, 3), "보정_R2": round(adj, 3), "미리맞히기_R2": round(oos, 3),
            "방향_적중": hit, "방향_시도": tried, "읽는법": verdict(oos, hit, tried),
        })
    return rows


def merge_log(path, columns, new_rows):
    """기존 기록에 새 기준일 줄만 더한다 — 같은 key는 처음 값을 그대로. 바뀌었으면 True."""
    old = []
    if os.path.exists(path):
        with open(path, newline="", encoding="utf-8") as f:
            old = list(csv.DictReader(f))
    keys = {r["key"] for r in old}
    added = [r for r in new_rows if r["key"] not in keys]
    rows = old + added
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=columns, lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow({c: r.get(c, "") for c in columns})
    text = buf.getvalue()
    current = None
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            current = f.read()
    if current != text:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
    return len(added)


def main():
    levels = load_levels()
    asof_date = max(s.index[-1] for s in levels.values()).date().isoformat()
    sens = sensitivity_rows(levels, asof_date)
    fcst = forecast_rows(levels, asof_date)
    a = merge_log(SENS_PATH, SENS_COLUMNS, sens)
    b = merge_log(FCST_PATH, FCST_COLUMNS, fcst)
    print(f"[INFO] 기준일 {asof_date} — 민감도 {len(sens)}줄(새로 {a}), 예측 검증 {len(fcst)}줄(새로 {b})")
    for r in sens:
        if "최근 1년" in r["key"]:
            print(f"  {r['읽는법']}")
    for r in fcst:
        print(f"  {r['설명변수']}: 표본안 {r['표본안_R2']} · 미리맞히기 {r['미리맞히기_R2']} · 방향 {r['방향_적중']}/{r['방향_시도']} — {r['읽는법']}")


if __name__ == "__main__":
    main()
