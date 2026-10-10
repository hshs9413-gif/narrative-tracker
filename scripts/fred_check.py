"""
FRED API 연결 점검 — 데이터 파일은 건드리지 않고 키·호출·단위만 확인한다.

    FRED_API_KEY=... python scripts/fred_check.py

출력: 키 인식 여부, 수집 대상 FRED 시리즈마다 최근 14일 관측 건수·마지막 값, 메타데이터 단위,
유동성 시리즈 단위가 fred_catalog.EXPECTED_UNITS와 맞는지. 하나라도 실패하면 종료코드 1.
"""

import datetime
import sys

import fred_api
from backfill_market_data import FDR_SYMBOLS
from fred_catalog import EXPECTED_UNITS


def main():
    key = fred_api.api_key()
    if not key:
        print("::error::FRED_API_KEY가 없거나 형식이 틀립니다 (Secret 이름이 정확히 FRED_API_KEY인지, 값이 32자리 영문 소문자+숫자인지 확인)")
        return 1
    print(f"[OK] FRED_API_KEY 인식 (길이 {len(key)})")

    end = datetime.date.today()
    start = end - datetime.timedelta(days=14)
    failures = 0
    for column, symbol in FDR_SYMBOLS.items():
        if not symbol.startswith("FRED:"):
            continue
        sid = symbol.split(":", 1)[1]
        try:
            info = fred_api.series_info(sid)
            obs = fred_api.observations(sid, start, end)
        except fred_api.FredError as e:
            print(f"::error::{sid} ({column}) 실패 — {e}")
            failures += 1
            continue
        last = f"{obs.index[-1]} = {obs.iloc[-1]}" if len(obs) else "최근 14일 관측 없음"
        note = ""
        expected = EXPECTED_UNITS.get(sid)
        if expected:
            note = " | 단위 기본값과 일치" if info["units"] == expected else f" | ⚠ 단위 기본값과 다름(기본값 {expected})"
            if info["units"] != expected:
                print(f"::warning::{sid} 단위 '{info['units']}' ≠ 기본값 '{expected}'")
        print(f"[OK] {sid:<13} {column:<16} {len(obs):>2}건, 마지막 {last} | {info['units']} | {info['frequency_short']} | "
              f"FRED 갱신 {info['last_updated']}{note}")

    print(f"\n점검 완료 — 실패 {failures}건")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
