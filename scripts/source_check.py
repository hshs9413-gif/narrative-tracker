"""시장 데이터 대체 경로 점검 — 한국 지표(KOSPI 등)를 어느 심볼로 받을 수 있는지 최근 10일치로 확인한다.

GitHub Actions 실행 요약에 ::notice로 남긴다. 실행: python scripts/source_check.py
"""

import datetime

import FinanceDataReader as fdr

CANDIDATES = {"kospi": ["KS11", "^KS11", "YAHOO:^KS11"], "usdkrw": ["USD/KRW", "KRW=X"]}


def main():
    end = datetime.date.today()
    start = end - datetime.timedelta(days=14)
    lines = []
    for col, symbols in CANDIDATES.items():
        for sym in symbols:
            try:
                df = fdr.DataReader(sym, start, end)
                c = "Close" if "Close" in df.columns else df.columns[0]
                s = df[c].dropna()
                lines.append(f"{col} {sym}: {len(s)}건, 마지막 {s.index.max().date() if len(s) else '-'} = {round(float(s.iloc[-1]), 2) if len(s) else '-'}")
            except Exception as e:  # noqa: BLE001
                lines.append(f"{col} {sym}: 실패 {type(e).__name__}: {str(e)[:80]}")
    print("::notice title=시장 데이터 경로::" + "%0A".join(lines))


if __name__ == "__main__":
    main()
