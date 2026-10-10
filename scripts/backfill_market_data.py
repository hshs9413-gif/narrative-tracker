"""
과거 시장 지표 일괄 소급 수집 (backfill)

FRED와 Stooq에는 수년치 과거 데이터가 있으므로, 이를 한 번에 내려받아
docs/data/market_snapshot.csv 를 채웁니다. 처음 설치했을 때 한 번만 실행하면 됩니다.

사용법:
    python scripts/backfill_market_data.py                 # 기본 3년치
    python scripts/backfill_market_data.py --years 5       # 5년치
    python scripts/backfill_market_data.py --start 2020-01-01
    python scripts/backfill_market_data.py --merge --dry-run   # 새 컬럼만 과거치 채우기 (미리보기)
    python scripts/backfill_market_data.py --merge             # 〃 (실제 기록)

주의:
  - 기본 모드는 기존 market_snapshot.csv를 통째로 덮어씁니다.
  - --merge는 덮어쓰지 않습니다. 이력이 없는 컬럼(COLUMNS에 새로 추가돼 과거 행이 빈칸인 것)만
    과거 행의 빈칸에 채우고, 이미 값이 있는 칸·기존 컬럼·행(날짜)은 건드리지 않습니다.
  - 뉴스 언급량(attention.csv)은 소급 불가입니다. Google News RSS가 과거 데이터를
    제공하지 않기 때문이며, 오늘부터 쌓입니다.

FRED 시리즈('FRED:' 심볼)는 환경변수 FRED_API_KEY가 있으면 FRED 공식 API(fred_api.py)로 받고,
키가 없거나 API 호출이 실패하면 기존처럼 fdr(fredgraph.csv)로 받습니다. 어느 경로든 값은 같은 FRED 원본입니다.

의존성: FinanceDataReader, pandas, requests
"""

import argparse
import csv
import datetime
import io
import os
import sys

import pandas as pd
import requests
import FinanceDataReader as fdr

import fred_api

BASE = os.path.dirname(__file__)
OUT_PATH = os.path.join(BASE, "..", "docs", "data", "market_snapshot.csv")

FDR_SYMBOLS = {
    "vix": "FRED:VIXCLS",
    "dxy_broad": "FRED:DTWEXBGS",
    "wti": "FRED:DCOILWTICO",
    "us10y": "FRED:DGS10",
    "fedrate": "FRED:DFEDTARU",
    "gold": "GC=F",
    "us2y": "FRED:DGS2",
    "hy_oas": "FRED:BAMLH0A0HYM2",
    "breakeven10y": "FRED:T10YIE",
    "nfci": "FRED:NFCI",
    "stlfsi4": "FRED:STLFSI4",
    # ── 리포트 1차 소스 맞추기 · 한국 · 장기금리/신용/유동성 (2026-10 추가) ──
    # 컬럼은 COLUMNS 맨 뒤에 붙인다 — 구글 시트 사본이 열 위치로 이어 붙기 때문에 기존 열 순서를 바꾸면 안 됨.
    "wti_front": "CL=F",              # WTI 근월물 선물 (wti = FRED 현물, 교차확인용으로 유지)
    "brent_front": "BZ=F",            # 브렌트 근월물 선물
    "usdkrw": "USD/KRW",              # 원/달러 (야후 KRW=X)
    "kospi": "KS11",
    "usdkrw_fred": "FRED:DEXKOUS",    # 연준 H.10 원/달러 — 야후와 교차확인, 발표 지연 있음
    "us30y": "FRED:DGS30",
    "real10y": "FRED:DFII10",         # 10년 TIPS 실질금리
    "term_premium10y": "FRED:THREEFYTP10",  # 10년 기간프리미엄 (ACM 모형)
    "ig_oas": "FRED:BAMLC0A0CM",      # 투자등급 OAS
    "ccc_oas": "FRED:BAMLH0A3HYC",    # CCC 이하 OAS
    "sofr": "FRED:SOFR",
    "iorb": "FRED:IORB",              # 지급준비금 이자율 — FOMC 때만 바뀌는 계단형
    "fed_assets": "FRED:WALCL",       # 연준 총자산 (수요일 기준 주간)
    "reserves": "FRED:WRESBAL",       # 지준 잔고 (주간 평균)
    "rrp": "FRED:RRPONTSYD",          # 역레포 (일간)
    "tga": "FRED:WTREGEN",            # 재무부 일반계정 (주간 평균)
}
# 단위는 FRED 원본 그대로 저장한다 (시리즈마다 백만/십억 달러로 다름 — 해당 FRED 페이지 참고).
STOOQ_DXY_URL = "https://stooq.com/q/d/l/?s=dx.f&i=d"
COLUMNS = [
    "date", "vix", "dxy_ice", "dxy_broad", "gold", "wti", "us10y", "fedrate",
    "us2y", "hy_oas", "breakeven10y", "nfci", "stlfsi4",
    "wti_front", "brent_front", "usdkrw", "kospi", "usdkrw_fred", "us30y", "real10y",
    "term_premium10y", "ig_oas", "ccc_oas", "sofr", "iorb", "fed_assets", "reserves", "rrp", "tga",
]
# 계단형·주간 갱신 지표는 앞의 값으로 채워야 매일 한 행씩 유지된다.
#   fedrate·iorb: FOMC 결정 때만 바뀜 / nfci·stlfsi4: 매주 금요일 / fed_assets·reserves·tga: 매주 수요일(H.4.1)
# 일간 시리즈(us30y·real10y·term_premium10y·ig_oas·ccc_oas·usdkrw_fred·sofr·rrp)는 발표가 며칠 늦을 뿐
# 값 자체는 매일 바뀌므로 채우지 않는다 — 채우면 아직 안 나온 날에 지난 값이 현재값처럼 보인다.
STEP_COLUMNS = ["fedrate", "nfci", "stlfsi4", "iorb", "fed_assets", "reserves", "tga"]
# 한국 시장 값은 있어도 행(날짜)을 새로 만들지 않는다. 미국 휴장일(추수감사절 등)에 한국 값만 있는 행이 끼면
# 마지막 행 날짜가 하루 밀려 compute_regime.py의 기준일·regime_log 줄 수가 달라지기 때문.
# 이미 있는 행에는 정상적으로 들어간다.
ROW_OPTIONAL_COLUMNS = STEP_COLUMNS + ["usdkrw", "kospi"]


# 이번 실행에서 심볼별로 실제 어느 경로로 받았는지 — "fred_api" | "fdr" | "failed".
# collect_market_data.py가 docs/data/fred_series.json에 기록해 화면에서 확인할 수 있게 한다.
SOURCES = {}


def fetch_series(symbol, start, end):
    """시계열 하나를 가져와 Series(index=date)로 반환.

    'FRED:' 심볼은 FRED_API_KEY가 있으면 공식 API로 먼저 받고, 실패하거나 키가 없으면 fdr(fredgraph.csv)로 받는다.
    """
    if symbol.startswith("FRED:") and fred_api.api_key():
        series_id = symbol.split(":", 1)[1]
        try:
            s = fred_api.observations(series_id, start, end)
            if len(s):
                print(f"[INFO] {symbol} via FRED API: {len(s)}건 ({s.index.min()} ~ {s.index.max()})")
                SOURCES[symbol] = "fred_api"
                return s
            print(f"[WARN] {symbol} via FRED API: 기간 내 0건 — fdr로 재시도", file=sys.stderr)
        except fred_api.FredError as e:
            print(f"[WARN] {symbol} via FRED API 실패: {e} — fdr로 재시도", file=sys.stderr)
    s = _fetch_series_fdr(symbol, start, end)
    SOURCES[symbol] = "fdr" if s is not None else "failed"
    return s


def _fetch_series_fdr(symbol, start, end):
    """fdr로 시계열 하나를 가져와 Series(index=date)로 반환."""
    try:
        df = fdr.DataReader(symbol, start, end)
        if df is None or df.empty:
            print(f"[WARN] {symbol}: 빈 결과", file=sys.stderr)
            return None
        col = "Close" if "Close" in df.columns else df.columns[0]
        s = df[col].dropna()
        s.index = pd.to_datetime(s.index).date
        print(f"[INFO] {symbol}: {len(s)}건 ({s.index.min()} ~ {s.index.max()})")
        return s
    except Exception as e:  # noqa: BLE001
        print(f"[WARN] {symbol} 실패: {e}", file=sys.stderr)
        return None


def fetch_dxy_ice(start, end):
    """ICE 달러인덱스 히스토리.

    Stooq → Yahoo(fdr) 순으로 시도한다. GitHub Actions 러너에서 Stooq가
    차단되는 사례가 있어, 일일 수집 스크립트와 동일한 폴백 체인을 둔다.
    """
    # 1순위: Stooq (기간 파라미터를 명시해 전체 히스토리를 요청)
    for url in (
        f"{STOOQ_DXY_URL}&d1={start.strftime('%Y%m%d')}&d2={end.strftime('%Y%m%d')}",
        STOOQ_DXY_URL,
    ):
        try:
            resp = requests.get(url, timeout=30,
                                headers={"User-Agent": "Mozilla/5.0 (narrative-tracker)"})
            resp.raise_for_status()
            text = resp.text.strip()
            lines = text.split("\n")

            if not text or "Date" not in lines[0]:
                print(f"[WARN] Stooq 응답이 CSV 아님: {text[:100]!r}", file=sys.stderr)
                continue

            header = [h.strip() for h in lines[0].split(",")]
            i_date, i_close = header.index("Date"), header.index("Close")
            idx, vals = [], []
            for line in lines[1:]:
                c = line.split(",")
                if len(c) <= max(i_date, i_close):
                    continue
                try:
                    d = datetime.date.fromisoformat(c[i_date].strip())
                    v = float(c[i_close])
                except (ValueError, TypeError):
                    continue
                if start <= d <= end:
                    idx.append(d); vals.append(v)

            if idx:
                print(f"[INFO] DXY(ICE) via Stooq: {len(idx)}건 ({min(idx)} ~ {max(idx)})")
                return pd.Series(vals, index=idx)
            print(f"[WARN] Stooq: 기간 내 0건 (수신 {len(lines)-1}행)", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            print(f"[WARN] Stooq 실패: {e}", file=sys.stderr)

    # 2순위: Yahoo 선물 심볼 (일일 수집에서 실제로 동작하는 경로)
    for alt in ("DX=F", "DX-Y.NYB"):
        s = fetch_series(alt, start, end)
        if s is not None and len(s):
            print(f"[INFO] DXY(ICE) via {alt}: {len(s)}건")
            return s

    print("[WARN] DXY(ICE) 모든 소스 실패 — 해당 컬럼은 비워둡니다.", file=sys.stderr)
    return None


HISTORY_GRACE_DAYS = 21  # 이 기간 안의 최근 행은 일일 수집이 이미 채웠을 수 있어 '이력 있음' 판단에서 뺀다
SEED_DAYS = 14           # 주간 지표(수요일 값)를 첫 행까지 이어 채우려면 시작일보다 앞선 값이 필요


def merge_new_columns(columns, dry_run):
    """이력이 없는 컬럼만 기존 CSV의 빈칸에 과거치를 채운다 — 기존 값·기존 컬럼·행(날짜)은 건드리지 않는다.

    columns가 없으면 '최근 HISTORY_GRACE_DAYS일 이전 행이 전부 빈칸인 컬럼'을 대상으로 삼는다.
    새로 COLUMNS에 추가된 컬럼이 여기에 해당하고, 한 번 채우고 나면 다음 실행부터 대상에서 빠진다.
    """
    if not os.path.exists(OUT_PATH):
        sys.exit("[ERROR] market_snapshot.csv가 없습니다 — --merge는 기존 파일이 있어야 합니다.")
    with open(OUT_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames or []
        rows = list(reader)
    if not rows:
        sys.exit("[ERROR] market_snapshot.csv가 비어 있습니다.")

    dates = [r["date"] for r in rows]
    cutoff = (datetime.date.fromisoformat(dates[-1]) - datetime.timedelta(days=HISTORY_GRACE_DAYS)).isoformat()
    if columns:
        unknown = [c for c in columns if c not in COLUMNS[1:]]
        if unknown:
            sys.exit(f"[ERROR] COLUMNS에 없는 컬럼: {unknown}")
        targets = columns
    else:
        targets = [c for c in COLUMNS[1:] if not any(r.get(c) for r in rows if r["date"] < cutoff)]
    if not targets:
        print("[INFO] 과거치를 채울 컬럼이 없습니다 (모든 컬럼에 이력이 있음).")
        return
    print(f"[INFO] 병합 대상 컬럼 {len(targets)}개: {targets}")

    start = datetime.date.fromisoformat(dates[0]) - datetime.timedelta(days=SEED_DAYS)
    end = datetime.date.today()
    series = {}
    for key in targets:
        s = fetch_dxy_ice(start, end) if key == "dxy_ice" else fetch_series(FDR_SYMBOLS[key], start, end)
        if s is not None and len(s):
            series[key] = s
    if not series:
        sys.exit("[ERROR] 대상 컬럼을 하나도 받지 못했습니다 — CSV를 건드리지 않습니다.")

    # 기존 행 날짜와 합친 축 위에서 계단형을 채운 뒤 기존 행만 고른다 (수요일이 CSV 행이 아니어도 값이 이어지도록)
    row_dates = [datetime.date.fromisoformat(d) for d in dates]
    df = pd.DataFrame(series)
    df = df.reindex(sorted(set(df.index) | set(row_dates))).sort_index()
    for c in STEP_COLUMNS:
        if c in df.columns:
            df[c] = df[c].ffill()
    df = df.loc[row_dates].round(2)

    filled = {c: [] for c in series}
    for row, day in zip(rows, row_dates):
        for c in series:
            v = df.at[day, c]
            if not row.get(c) and not pd.isna(v):  # 이미 값이 있는 칸은 그대로 둔다
                row[c] = str(float(v))
                filled[c].append(row["date"])

    for c in targets:
        if c not in series:
            print(f"[WARN] {c}: 조회 실패 — 건너뜀 (다음 실행 때 다시 대상이 됨)", file=sys.stderr)
        else:
            span = f"{filled[c][0]} ~ {filled[c][-1]}" if filled[c] else "-"
            print(f"[INFO] {c}: 빈칸 {len(filled[c])}개 채움 ({span})")
    if dry_run:
        print("[INFO] --dry-run — 파일을 쓰지 않았습니다.")
        return

    fieldnames = COLUMNS + [h for h in header if h not in COLUMNS]
    with open(OUT_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        for r in rows:
            writer.writerow({c: r.get(c, "") for c in fieldnames})
    print(f"[INFO] 저장 완료: {len(rows)}행 (행·기존 값 변화 없음, 빈칸만 채움)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, default=3, help="소급할 연수 (기본 3년)")
    ap.add_argument("--start", type=str, default=None, help="시작일 YYYY-MM-DD (years보다 우선)")
    ap.add_argument("--merge", action="store_true",
                    help="덮어쓰지 않고 이력 없는 컬럼의 빈칸만 과거치로 채움 (--years/--start 무시)")
    ap.add_argument("--columns", type=lambda v: [c for c in v.split(",") if c], default=None,
                    help="--merge 대상 컬럼을 직접 지정 (쉼표 구분). 생략하면 이력 없는 컬럼 자동 선택")
    ap.add_argument("--dry-run", action="store_true", help="--merge에서 파일을 쓰지 않고 채울 개수만 출력")
    args = ap.parse_args()

    if args.merge:
        merge_new_columns(args.columns, args.dry_run)
        return
    if args.dry_run or args.columns:
        ap.error("--dry-run·--columns는 --merge와 함께만 쓸 수 있습니다.")

    end = datetime.date.today()
    if args.start:
        start = datetime.date.fromisoformat(args.start)
    else:
        start = end - datetime.timedelta(days=365 * args.years)

    print(f"[INFO] 소급 기간: {start} ~ {end}\n")

    series = {}
    for key, symbol in FDR_SYMBOLS.items():
        s = fetch_series(symbol, start, end)
        if s is not None:
            series[key] = s

    s_dxy = fetch_dxy_ice(start, end)
    if s_dxy is not None:
        series["dxy_ice"] = s_dxy

    if not series:
        print("[ERROR] 수집된 데이터가 없습니다.", file=sys.stderr)
        sys.exit(1)

    df = pd.DataFrame(series)
    df.index.name = "date"
    df = df.sort_index()

    # 계단형·주간 갱신 지표는 앞의 값으로 채움 (STEP_COLUMNS 주석 참고)
    for c in STEP_COLUMNS:
        if c in df.columns:
            df[c] = df[c].ffill()

    # 모든 지표가 비어 있는 날(주말·공휴일)은 제거
    value_cols = [c for c in df.columns if c not in ROW_OPTIONAL_COLUMNS]
    if value_cols:
        df = df.dropna(subset=value_cols, how="all")

    df = df.round(2).reset_index()
    df["date"] = df["date"].astype(str)

    for c in COLUMNS:
        if c not in df.columns:
            df[c] = ""
    df = df[COLUMNS]

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    df.to_csv(OUT_PATH, index=False)

    print(f"\n[INFO] 저장 완료: {len(df)}행 → docs/data/market_snapshot.csv")
    print(f"[INFO] 기간: {df['date'].iloc[0]} ~ {df['date'].iloc[-1]}")
    print("\n최근 5행 미리보기:")
    print(df.tail().to_string(index=False))


if __name__ == "__main__":
    main()
