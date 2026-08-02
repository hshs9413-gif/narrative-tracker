"""
과거 시장 지표 일괄 소급 수집 (backfill)

FRED와 Stooq에는 수년치 과거 데이터가 있으므로, 이를 한 번에 내려받아
docs/data/market_snapshot.csv 를 채웁니다. 처음 설치했을 때 한 번만 실행하면 됩니다.

사용법:
    python scripts/backfill_market_data.py                 # 기본 3년치
    python scripts/backfill_market_data.py --years 5       # 5년치
    python scripts/backfill_market_data.py --start 2020-01-01

주의:
  - 기존 market_snapshot.csv를 덮어씁니다. 이후 일일 수집은 여기에 이어서 append됩니다.
  - 뉴스 언급량(attention.csv)은 소급 불가입니다. Google News RSS가 과거 데이터를
    제공하지 않기 때문이며, 오늘부터 쌓입니다.

의존성: FinanceDataReader, pandas, requests
"""

import argparse
import datetime
import io
import os
import sys

import pandas as pd
import requests
import FinanceDataReader as fdr

BASE = os.path.dirname(__file__)
OUT_PATH = os.path.join(BASE, "..", "docs", "data", "market_snapshot.csv")

FDR_SYMBOLS = {
    "vix": "FRED:VIXCLS",
    "dxy_broad": "FRED:DTWEXBGS",
    "wti": "FRED:DCOILWTICO",
    "us10y": "FRED:DGS10",
    "fedrate": "FRED:DFEDTARU",
    "gold": "GC=F",
}
STOOQ_DXY_URL = "https://stooq.com/q/d/l/?s=dx.f&i=d"
COLUMNS = ["date", "vix", "dxy_ice", "dxy_broad", "gold", "wti", "us10y", "fedrate"]


def fetch_series(symbol, start, end):
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
    """Stooq에서 ICE 달러인덱스 전체 히스토리.
    pandas.read_csv는 Stooq가 오류 문자열을 반환할 때 조용히 실패하므로
    응답을 직접 파싱하고 실패 원인을 로그로 남긴다."""
    try:
        resp = requests.get(STOOQ_DXY_URL, timeout=30,
                            headers={"User-Agent": "Mozilla/5.0 (narrative-tracker)"})
        resp.raise_for_status()
        text = resp.text.strip()

        if not text or "Date" not in text.split("\n")[0]:
            print(f"[WARN] Stooq 응답이 CSV가 아님: {text[:120]!r}", file=sys.stderr)
            return None

        lines = text.split("\n")
        header = [h.strip() for h in lines[0].split(",")]
        try:
            i_date, i_close = header.index("Date"), header.index("Close")
        except ValueError:
            print(f"[WARN] Stooq 헤더 예상과 다름: {header}", file=sys.stderr)
            return None

        idx, vals = [], []
        for line in lines[1:]:
            cells = line.split(",")
            if len(cells) <= max(i_date, i_close):
                continue
            try:
                d = datetime.date.fromisoformat(cells[i_date].strip())
                v = float(cells[i_close])
            except (ValueError, TypeError):
                continue
            if start <= d <= end:
                idx.append(d)
                vals.append(v)

        if not idx:
            print(f"[WARN] Stooq: 기간 내 데이터 0건 (전체 {len(lines)-1}행 수신). "
                  f"요청 기간 {start}~{end}", file=sys.stderr)
            return None

        s = pd.Series(vals, index=idx)
        print(f"[INFO] DXY(ICE): {len(s)}건 ({min(idx)} ~ {max(idx)})")
        return s

    except Exception as e:  # noqa: BLE001
        print(f"[WARN] Stooq DXY 실패: {e}", file=sys.stderr)
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, default=3, help="소급할 연수 (기본 3년)")
    ap.add_argument("--start", type=str, default=None, help="시작일 YYYY-MM-DD (years보다 우선)")
    args = ap.parse_args()

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

    # 연준 기준금리는 FOMC 결정일에만 값이 바뀌는 계단형이므로 앞의 값으로 채움
    if "fedrate" in df.columns:
        df["fedrate"] = df["fedrate"].ffill()

    # 모든 지표가 비어 있는 날(주말·공휴일)은 제거
    value_cols = [c for c in df.columns if c != "fedrate"]
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
