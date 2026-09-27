"""
매크로 내러티브 트래커 - 정량 지표 자동 수집 스크립트
GitHub Actions에서 매일 실행되어 docs/data/market_snapshot.csv에 한 행씩 append합니다.

전부 FinanceDataReader(fdr) 하나로 수집합니다. fdr은 'FRED:시리즈ID' 형태로 FRED 데이터를
키 없이 그대로 감싸서 제공하므로, 별도 requests 코드 없이 통일된 인터페이스로 처리합니다.

수집 지표:
  - VIX     : FRED:VIXCLS      (CBOE 변동성지수)
  - DXY_ICE : Stooq dx.f       (ICE 달러인덱스 — 6개 통화, 1973=100. 뉴스에서 말하는 '달러인덱스')\n  - DXY_BROAD: FRED:DTWEXBGS   (연준 광의 달러지수 — 26개 통화, 2006.1=100. 원화·위안 포함)
  - WTI     : FRED:DCOILWTICO  (WTI 현물 가격)
  - US10Y   : FRED:DGS10       (미국채 10년물 금리)
  - FEDRATE : FRED:DFEDTARU    (연준 기준금리 목표 상단 — FOMC 결정 시에만 값이 바뀜)
  - GOLD    : GC=F             (야후 경유 금 선물, FRED에 무료 실시간 금 시리즈가 없어 보완)
  - US2Y    : FRED:DGS2        (미국채 2년물 금리 — 10Y와 묶어 2s10y 스프레드 계산용)
  - HY_OAS  : FRED:BAMLH0A0HYM2 (ICE BofA 하이일드 옵션조정스프레드 — 신용스트레스 판정용)
  - BREAKEVEN10Y: FRED:T10YIE  (10년 기대인플레이션, BEI)
  - NFCI    : FRED:NFCI        (시카고연은 금융여건지수 — 주간 갱신, 0=평균)
  - STLFSI4 : FRED:STLFSI4     (세인트루이스연은 금융스트레스지수 — 주간 갱신, 0=평균)

이 5개는 compute_regime.py가 레짐 판정에 쓴다 — 레짐 판정 로직 자체는 여기 없고
별도 스크립트에서 이 CSV + config/regime_thresholds.json을 읽어 처리한다.

의존성: FinanceDataReader, pandas (requirements.txt 참고)
"""

import csv
import datetime
import os
import sys

import requests
import FinanceDataReader as fdr

CSV_PATH = os.path.join(os.path.dirname(__file__), "..", "docs", "data", "market_snapshot.csv")

# key: CSV 컬럼명 / value: fdr에 넘길 심볼
SYMBOLS = {
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
}

FIELDNAMES = [
    "date", "vix", "dxy_ice", "dxy_broad", "gold", "wti", "us10y", "fedrate",
    "us2y", "hy_oas", "breakeven10y", "nfci", "stlfsi4",
]

# ICE 달러인덱스(DXY, 6개 통화 · 1973=100). FRED에는 없어 Stooq 공개 CSV를 사용.
STOOQ_DXY_URL = "https://stooq.com/q/d/l/?s=dx.f&i=d"


def fetch_dxy_ice():
    """ICE DXY 최근 종가. Stooq → fdr 순으로 시도."""
    try:
        resp = requests.get(STOOQ_DXY_URL, timeout=15)
        resp.raise_for_status()
        lines = resp.text.strip().splitlines()
        if len(lines) > 1:
            # Date,Open,High,Low,Close,Volume
            close = lines[-1].split(",")[4]
            return float(close)
    except Exception as e:  # noqa: BLE001
        print(f"[WARN] Stooq DXY 조회 실패: {e}", file=sys.stderr)

    for alt in ("DX=F", "DX-Y.NYB"):
        value = fetch_latest(alt)
        if value is not None:
            print(f"[INFO] DXY 대체 심볼 {alt} 사용")
            return value
    return None


def fetch_latest(symbol: str):
    """최근 거래일 종가(FRED는 최근 확정치)를 가져온다. 실패 시 None."""
    try:
        end = datetime.date.today()
        start = end - datetime.timedelta(days=14)  # FRED는 결측일이 있을 수 있어 여유있게 조회
        df = fdr.DataReader(symbol, start, end)
        if df.empty:
            return None
        col = "Close" if "Close" in df.columns else df.columns[0]
        value = df[col].dropna()
        if value.empty:
            return None
        return float(value.iloc[-1])
    except Exception as e:  # noqa: BLE001
        print(f"[WARN] {symbol} 조회 실패: {e}", file=sys.stderr)
        return None


def main() -> None:
    today = datetime.date.today().isoformat()

    row = {"date": today}
    for key, symbol in SYMBOLS.items():
        value = fetch_latest(symbol)
        row[key] = round(value, 2) if value is not None else ""

    dxy_ice = fetch_dxy_ice()
    row["dxy_ice"] = round(dxy_ice, 2) if dxy_ice is not None else ""

    existing_dates = set()
    if os.path.exists(CSV_PATH):
        with open(CSV_PATH, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for r in reader:
                existing_dates.add(r["date"])

    if today in existing_dates:
        print(f"[INFO] {today} 데이터가 이미 존재합니다. 스킵.")
        return

    write_header = not os.path.exists(CSV_PATH)
    with open(CSV_PATH, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        if write_header:
            writer.writeheader()
        writer.writerow(row)

    print(f"[INFO] {today} 데이터 기록 완료: {row}")


if __name__ == "__main__":
    main()
