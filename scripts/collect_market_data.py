"""
매크로 내러티브 트래커 - 정량 지표 자동 수집 스크립트
GitHub Actions에서 매일 실행되어 docs/data/market_snapshot.csv를 갱신합니다.

최근 WINDOW_DAYS일 치를 매번 원천에서 다시 받아 **데이터 기준일**로 행을 덮어씁니다.
예전처럼 '실행한 날짜'로 최신값 한 줄을 붙이면, 예약 실행이 자정(UTC)을 넘겨 늦게 돌 때
날짜가 밀려 하루치가 빠지고, 며칠 늦게 발표되는 FRED 값(VIX·HY OAS 등)이 그 날짜에
영영 채워지지 않았습니다. 창 안의 날짜는 backfill_market_data.py와 같은 방식으로 채웁니다.

수집 지표와 출처는 backfill_market_data.py의 FDR_SYMBOLS 한 곳에서만 관리합니다.
의존성: FinanceDataReader, pandas, requests (requirements.txt 참고)
"""

import csv
import datetime
import os
import sys

import pandas as pd

from backfill_market_data import (
    COLUMNS, FDR_SYMBOLS, ROW_OPTIONAL_COLUMNS, STEP_COLUMNS, fetch_dxy_ice, fetch_series,
)

CSV_PATH = os.path.join(os.path.dirname(__file__), "..", "docs", "data", "market_snapshot.csv")
WINDOW_DAYS = 14  # FRED 발표 지연(수일)과 예약 실행 누락을 흡수할 만큼


def load_rows():
    if not os.path.exists(CSV_PATH):
        return {}
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        return {r["date"]: r for r in csv.DictReader(f)}


def fetch_window(start, end):
    """컬럼별 창 기간 시계열. 조회 자체가 실패한 컬럼은 빠진다 (기존 값을 지키기 위해)."""
    series = {}
    for key, symbol in FDR_SYMBOLS.items():
        s = fetch_series(symbol, start, end)
        if s is not None and len(s):
            series[key] = s
    s = fetch_dxy_ice(start, end)
    if s is not None and len(s):
        series["dxy_ice"] = s
    return series


def main() -> None:
    end = datetime.date.today()
    start = end - datetime.timedelta(days=WINDOW_DAYS)
    rows = load_rows()

    series = fetch_window(start, end)
    if not series:
        sys.exit("[ERROR] 모든 원천 조회 실패 — CSV를 건드리지 않습니다.")

    df = pd.DataFrame(series).sort_index()

    # 계단형·주간 지표는 창 이전의 마지막 값에서 이어 채운다 (backfill과 같은 ffill)
    earlier = sorted(d for d in rows if d < start.isoformat())
    for col in STEP_COLUMNS:
        if col not in df.columns:
            continue
        seed = next((rows[d][col] for d in reversed(earlier) if rows[d].get(col)), None)
        if seed is not None and pd.isna(df[col].iloc[0]):
            df.loc[df.index[0], col] = float(seed)
        df[col] = df[col].ffill()

    # 모든 지표가 비어 있는 날(주말·공휴일)은 행을 만들지 않음. 계단형·한국 시장 값만 있는 날도 마찬가지
    # (ROW_OPTIONAL_COLUMNS 주석 참고). 그런 컬럼만 조회된 날(다른 원천이 전부 실패)에는 기존 행에만 반영한다.
    value_cols = [c for c in df.columns if c not in ROW_OPTIONAL_COLUMNS]
    if value_cols:
        df = df.dropna(subset=value_cols, how="all")
    else:
        df = df[[d.isoformat() in rows for d in df.index]]
    df = df.round(2)

    changed = []
    for day, values in df.iterrows():
        key = day.isoformat()
        old = rows.get(key, {})
        new = {"date": key}
        for col in COLUMNS[1:]:
            if col in df.columns:
                v = values[col]
                new[col] = "" if pd.isna(v) else str(float(v))
            else:
                new[col] = old.get(col, "")  # 이번에 조회 실패한 원천은 기존 값 유지
        if any(new[c] != old.get(c, "") for c in COLUMNS):
            changed.append(key)
        rows[key] = new

    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n")
        writer.writeheader()
        for key in sorted(rows):
            writer.writerow({c: rows[key].get(c, "") for c in COLUMNS})

    missing = sorted(set(COLUMNS[1:]) - set(series))
    if missing:
        print(f"[WARN] 조회 실패로 기존 값을 유지한 컬럼: {missing}", file=sys.stderr)
    print(f"[INFO] {start}~{end} 창 갱신 — 바뀐 날짜 {len(changed)}개: {changed}")


if __name__ == "__main__":
    main()
