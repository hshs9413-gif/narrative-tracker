"""
레짐 판정 스크립트 (매일 수집 워크플로우에서 collect_market_data.py 다음에 실행)

docs/data/market_snapshot.csv(최신 행 + lookback_days 전 행) + docs/data/manual_inputs.json
(ISM PMI, 수동 갱신) + config/regime_thresholds.json(임계값)을 읽어
docs/data/regime_state.json을 새로 씁니다.

판정 기준 4가지:
  - growth_inflation : PMI(확장/수축) x BEI(완만/과열) 2x2 매트릭스
  - credit_stress     : HY OAS·VIX 밴드 중 더 나쁜 쪽 (2s10y 역전은 크로스체크로만)
  - policy_stance     : 기준금리의 lookback_days 전 대비 변화 방향
  - composite_score   : 위 판정들에서 규정 기반으로 감점 (확률 아님)

값이 없으면(백필 전이라 컬럼이 비어있거나, PMI 수동입력이 안 됐거나) 그 항목만
"미확인"으로 떨어뜨리고 reason에 사유를 남긴다 — 전체 스크립트를 실패시키지 않음.

의존성: 표준 라이브러리만 사용 (pandas 불필요, market_snapshot.csv가 이미 작아서 csv 모듈로 충분)
"""

import csv
import datetime
import json
import os

BASE = os.path.dirname(__file__)
MARKET_CSV = os.path.join(BASE, "..", "docs", "data", "market_snapshot.csv")
MANUAL_INPUTS = os.path.join(BASE, "..", "docs", "data", "manual_inputs.json")
THRESHOLDS_PATH = os.path.join(BASE, "..", "config", "regime_thresholds.json")
OUT_PATH = os.path.join(BASE, "..", "docs", "data", "regime_state.json")

NUMERIC_COLUMNS = [
    "vix", "dxy_ice", "dxy_broad", "gold", "wti", "us10y",
    "fedrate", "us2y", "hy_oas", "breakeven10y", "nfci", "stlfsi4",
]


def load_market_rows():
    with open(MARKET_CSV, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    for row in rows:
        for col in NUMERIC_COLUMNS:
            raw = row.get(col, "")
            row[col] = float(raw) if raw not in ("", None) else None
    return rows


def latest_value(rows, column):
    """뒤에서부터 훑어 해당 컬럼이 null이 아닌 첫 행의 (값, 날짜). 없으면 (None, None).

    지표마다 발표 주기·지연이 달라(주말 직후엔 금요일치 HY OAS·BEI가 아직 안 올라오는
    식) 최신 행 하나가 통째로 채워져 있다고 가정하면 안 된다 — collect_market_data.py의
    fetch_latest()도 컬럼별로 독립적으로 lookback하는 것과 같은 이유."""
    for row in reversed(rows):
        if row.get(column) is not None:
            return row[column], row["date"]
    return None, None


def find_lookback_row(rows, anchor_date, lookback_days):
    """anchor_date - lookback_days 이하인 행 중 가장 최근 것. 없으면 None."""
    target = anchor_date - datetime.timedelta(days=lookback_days)
    candidates = [r for r in rows if datetime.date.fromisoformat(r["date"]) <= target]
    return candidates[-1] if candidates else None


def band_lookup(value, bands):
    """bands는 max 오름차순 — value가 max 미만인 첫 밴드, 없으면 마지막(max=None)."""
    for band in bands:
        if band["max"] is None or value < band["max"]:
            return band
    return bands[-1]


def compute_growth_inflation(manual_inputs, rows, cfg):
    pmi_info = manual_inputs.get("ism_pmi", {})
    pmi = pmi_info.get("value")
    breakeven, breakeven_date = latest_value(rows, "breakeven10y")

    if pmi is None or breakeven is None:
        missing = []
        if pmi is None:
            missing.append("PMI(manual_inputs.json 미입력)")
        if breakeven is None:
            missing.append("BEI(market_snapshot.csv breakeven10y 결측)")
        return {"label": "미확인", "reason": " · ".join(missing) + " 없어 판정 불가"}

    growth_up = pmi >= cfg["pmi_expansion_min"]
    inflation_up = breakeven >= cfg["breakeven_elevated_min"]

    if growth_up and not inflation_up:
        label = "골디락스"
    elif growth_up and inflation_up:
        label = "인플레이션 레짐"
    elif not growth_up and inflation_up:
        label = "스태그플레이션"
    else:
        label = "청산·디플레충격"

    return {
        "label": label,
        "pmi": pmi,
        "pmi_as_of": pmi_info.get("as_of"),
        "breakeven": breakeven,
        "breakeven_date": breakeven_date,
    }


def compute_credit_stress(rows, cfg):
    hy_oas, hy_oas_date = latest_value(rows, "hy_oas")
    vix, vix_date = latest_value(rows, "vix")
    us10y, _ = latest_value(rows, "us10y")
    us2y, _ = latest_value(rows, "us2y")

    if hy_oas is None or vix is None:
        missing = []
        if hy_oas is None:
            missing.append("HY OAS")
        if vix is None:
            missing.append("VIX")
        return {"label": "미확인", "reason": " · ".join(missing) + " 결측이라 판정 불가"}

    hy_band = band_lookup(hy_oas, cfg["hy_oas_bands"])
    vix_band = band_lookup(vix, cfg["vix_bands"])
    worse = hy_band if hy_band["level_index"] >= vix_band["level_index"] else vix_band

    if us10y is not None and us2y is not None:
        curve_value = round(us10y - us2y, 3)
        curve = {"value": curve_value, "inverted": curve_value < 0}
    else:
        curve = {"status": "no_data"}

    return {
        "label": worse["label"],
        "level_index": worse["level_index"],
        "detail": {
            "hy_oas_pct": {"value": hy_oas, "as_of": hy_oas_date, "band": hy_band["label"]},
            "vix_level": {"value": vix, "as_of": vix_date, "band": vix_band["label"]},
            "curve_2s10y": curve,
        },
    }


def compute_policy_stance(rows, anchor_date, cfg):
    current, current_date = latest_value(rows, "fedrate")
    lookback_row = find_lookback_row(rows, anchor_date, cfg["lookback_days"]) if current else None
    lookback_value = lookback_row.get("fedrate") if lookback_row else None

    if current is None or lookback_value is None:
        return {"label": "미확인", "reason": "기준금리 현재값 또는 lookback 시점 값이 없어 판정 불가"}

    diff = round(current - lookback_value, 3)
    if diff <= cfg["easing_threshold"]:
        label = "완화"
    elif diff >= cfg["tightening_threshold"]:
        label = "긴축"
    else:
        label = "중립"

    return {
        "label": label,
        "current": current,
        "current_date": current_date,
        "lookback_days": cfg["lookback_days"],
        "lookback_value": lookback_value,
        "lookback_date": lookback_row["date"],
    }


def interpret_index(value, negative_label, positive_label, deadzone=0.05):
    if value < -deadzone:
        return negative_label
    if value > deadzone:
        return positive_label
    return "평균 수준"


def compute_cross_check(rows):
    nfci, nfci_date = latest_value(rows, "nfci")
    stlfsi4, stlfsi4_date = latest_value(rows, "stlfsi4")

    if nfci is None and stlfsi4 is None:
        return {"status": "데이터 없음"}

    result = {}
    if nfci is not None:
        result["nfci"] = {
            "value": nfci,
            "as_of": nfci_date,
            "interpretation": interpret_index(nfci, "평균보다 완화적", "평균보다 긴축적"),
        }
    if stlfsi4 is not None:
        result["stlfsi4"] = {
            "value": stlfsi4,
            "as_of": stlfsi4_date,
            "interpretation": interpret_index(stlfsi4, "평균보다 낮음", "평균보다 높음"),
        }
    return result


def compute_composite_score(growth_inflation, credit_stress, policy_stance, cfg):
    deductions_cfg = cfg["deductions"]
    score = cfg["start"]
    deductions = []

    level_index = credit_stress.get("level_index")
    if level_index == 1:
        score -= deductions_cfg["credit_stress_level_1"]
        deductions.append("신용경계")
    elif level_index == 2:
        score -= deductions_cfg["credit_stress_level_2"]
        deductions.append("신용경색")
    elif level_index == 3:
        score -= deductions_cfg["credit_stress_level_3"]
        deductions.append("신용시스템위기")

    if policy_stance.get("label") == "긴축":
        score -= deductions_cfg["policy_tightening"]
        deductions.append("정책 긴축기조")

    if growth_inflation.get("label") == "스태그플레이션":
        score -= deductions_cfg["growth_inflation_stagflation"]
        deductions.append("스태그플레이션")
    elif growth_inflation.get("label") == "청산·디플레충격":
        score -= deductions_cfg["growth_inflation_deflation_shock"]
        deductions.append("청산·디플레충격")

    curve = credit_stress.get("detail", {}).get("curve_2s10y", {})
    if curve.get("inverted"):
        score -= deductions_cfg["curve_inverted"]
        deductions.append("장단기금리 역전")

    return {
        "score": max(0, score),
        "deductions": deductions or ["없음"],
        "note": "이건 확률이 아니라 규정기반 감점 점수입니다.",
    }


def main() -> None:
    with open(THRESHOLDS_PATH, encoding="utf-8") as f:
        thresholds = json.load(f)
    with open(MANUAL_INPUTS, encoding="utf-8") as f:
        manual_inputs = json.load(f)

    rows = load_market_rows()
    if not rows:
        raise SystemExit("[ERROR] market_snapshot.csv가 비어 있습니다.")

    anchor_date = datetime.date.fromisoformat(rows[-1]["date"])

    growth_inflation = compute_growth_inflation(manual_inputs, rows, thresholds["growth_inflation"])
    credit_stress = compute_credit_stress(rows, thresholds["credit_stress"])
    policy_stance = compute_policy_stance(rows, anchor_date, thresholds["policy_stance"])
    cross_check = compute_cross_check(rows)
    composite_score = compute_composite_score(
        growth_inflation, credit_stress, policy_stance, thresholds["composite_score"]
    )

    regime_state = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "thresholds_locked": thresholds.get("locked", False),
        "growth_inflation": growth_inflation,
        "credit_stress": credit_stress,
        "policy_stance": policy_stance,
        "cross_check": cross_check,
        "composite_score": composite_score,
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(regime_state, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"[INFO] 저장 완료 → docs/data/regime_state.json")
    print(f"[INFO] growth_inflation={growth_inflation['label']} "
          f"credit_stress={credit_stress['label']} policy_stance={policy_stance['label']} "
          f"score={composite_score['score']}")


if __name__ == "__main__":
    main()
