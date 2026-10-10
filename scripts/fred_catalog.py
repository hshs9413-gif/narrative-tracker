"""
FRED 시리즈 카탈로그 — docs/data/fred_series.json

market_snapshot.csv의 FRED 컬럼마다 ① 이번 수집이 실제로 어느 경로(FRED API / fdr)로 받았는지,
② FRED API가 알려주는 메타데이터(제목·단위·주기·마지막 관측일·FRED 최종 갱신 시각)를 적는다.
대시보드의 '데이터 소스' 표와 연준 유동성 카드의 단위 환산이 이 파일을 읽는다.

- 키(FRED_API_KEY)가 있으면 메타데이터를 새로 받는다.
- 키가 없으면 메타데이터는 이전 파일에 있던 값을 그대로 두고, 수집 경로만 갱신한다 (파일을 지우지 않음).
- 단위가 EXPECTED_UNITS와 다르면 경고한다 — 유동성 카드 단위 환산의 기본값이 맞는지 확인하는 장치.

단독 실행(메타데이터만 갱신):  FRED_API_KEY=... python scripts/fred_catalog.py
"""

import datetime
import json
import os
import sys

import fred_api

BASE = os.path.dirname(__file__)
CATALOG_PATH = os.path.join(BASE, "..", "docs", "data", "fred_series.json")

# 화면에서 단위를 환산하는 유동성 시리즈의 기본 단위 (web/lib/liquidity.ts의 FALLBACK_UNITS와 같게 유지).
# FRED API 메타데이터가 있으면 화면은 메타데이터 단위를 우선 쓴다 — 여기 값은 키가 없을 때의 기본값이자 검증 기준.
EXPECTED_UNITS = {
    "WALCL": "Millions of U.S. Dollars",
    "WTREGEN": "Millions of U.S. Dollars",
    "WRESBAL": "Billions of U.S. Dollars",
    "RRPONTSYD": "Billions of U.S. Dollars",
}


def load_catalog(path=CATALOG_PATH):
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        print(f"[WARN] {path} 읽기 실패: {e} — 새로 만듭니다", file=sys.stderr)
        return {}


def build_catalog(symbols, sources, previous, fetch_info=None, now=None, key_status=None):
    """symbols: {컬럼: 'FRED:ID' | 기타}, sources: {심볼: 'fred_api'|'fdr'|'failed'} (이번 실행 기록).

    fetch_info(series_id) -> dict 를 주면 메타데이터를 새로 받고, 실패하거나 없으면 이전 값을 유지한다.
    """
    now = now or datetime.datetime.now(datetime.timezone.utc)
    prev_by_column = {s.get("column"): s for s in previous.get("series", [])}
    out = []
    meta_ok = meta_failed = 0

    for column, symbol in symbols.items():
        if not symbol.startswith("FRED:"):
            continue
        series_id = symbol.split(":", 1)[1]
        prev = prev_by_column.get(column, {})
        entry = {
            "column": column,
            "id": series_id,
            # 이번 실행에서 조회하지 않은 컬럼(예: --merge 대상 아님)은 이전 기록을 둔다
            "via": sources.get(symbol, prev.get("via")),
            "meta": prev.get("meta") if prev.get("id") == series_id else None,
            "meta_fetched_at": prev.get("meta_fetched_at") if prev.get("id") == series_id else None,
        }
        if fetch_info:
            try:
                entry["meta"] = fetch_info(series_id)
                entry["meta_fetched_at"] = now.isoformat(timespec="seconds")
                meta_ok += 1
            except fred_api.FredError as e:
                print(f"[WARN] {series_id} 메타데이터 실패: {e} — 이전 값 유지", file=sys.stderr)
                meta_failed += 1

        expected = EXPECTED_UNITS.get(series_id)
        units = (entry["meta"] or {}).get("units")
        if expected and units and units != expected:
            print(f"[WARN] {series_id} 단위가 '{units}'로 기본값 '{expected}'와 다릅니다 — "
                  f"화면은 메타데이터 단위로 환산합니다. fred_catalog.EXPECTED_UNITS·web/lib/liquidity.ts도 맞추세요.",
                  file=sys.stderr)
        out.append(entry)

    catalog = {
        "generated_at": now.isoformat(timespec="seconds"),
        "api_key_configured": fetch_info is not None,
        # 'ok' | 'missing'(Secret이 워크플로우에 전달 안 됨) | 'malformed'(값 형식 오류) — 키 값은 기록하지 않음
        "api_key_status": key_status or ("ok" if fetch_info is not None else "missing"),
        "series": out,
    }
    return catalog, meta_ok, meta_failed


def update_catalog(symbols, sources, path=CATALOG_PATH):
    """수집 스크립트 끝에서 부른다. 실패해도 수집 결과에 영향을 주지 않게 호출 쪽에서 예외를 삼킨다."""
    key = fred_api.api_key()
    fetch_info = (lambda sid: fred_api.series_info(sid, key=key)) if key else None
    catalog, ok, failed = build_catalog(symbols, sources, load_catalog(path), fetch_info, key_status=fred_api.key_status())
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
        f.write("\n")
    via = {}
    for s in catalog["series"]:
        via[s["via"]] = via.get(s["via"], 0) + 1
    meta_note = (f"메타데이터 {ok}건 갱신" + (f", {failed}건 실패" if failed else "") if key
                 else f"키 상태 {catalog['api_key_status']} — 메타데이터 유지")
    print(f"[INFO] fred_series.json 저장 — 시리즈 {len(catalog['series'])}개, 수집 경로 {via}, {meta_note}")


def main():
    from backfill_market_data import FDR_SYMBOLS

    if not fred_api.api_key():
        sys.exit("[ERROR] FRED_API_KEY가 없습니다 — 메타데이터를 받으려면 키가 필요합니다.")
    update_catalog(FDR_SYMBOLS, {})


if __name__ == "__main__":
    main()
