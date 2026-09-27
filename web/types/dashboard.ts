/**
 * docs/data/*.json·csv 스키마와 1:1 대응하는 타입.
 * 실제 compute_regime.py 출력물을 직접 실행해 확인한 필드 기준으로 작성함
 * (레포 README나 기억에 의존하지 않고 샘플 출력을 그대로 옮김).
 *
 * 라벨류 필드(label, band, interpretation 등)의 값은 한글 문자열이고
 * config/regime_thresholds.json에서 나온다 — 여기서 리터럴 유니온으로 좁히면
 * 임계값 config가 바뀔 때마다 타입도 고쳐야 해서, 우선 string으로 느슨하게 잡았다.
 * (thresholds가 locked:true로 확정된 뒤 필요하면 리터럴 유니온으로 좁히는 걸 검토.)
 */

// ────────────────────── regime_state.json ──────────────────────

export interface RegimeState {
  generated_at: string; // ISO 8601
  thresholds_locked: boolean;
  growth_inflation: GrowthInflation;
  credit_stress: CreditStress;
  policy_stance: PolicyStance;
  cross_check: CrossCheck;
  composite_score: CompositeScore;
}

export interface GrowthInflation {
  label: string; // "골디락스" | "인플레이션 레짐" | "스태그플레이션" | "청산·디플레충격" | "미확인"
  reason?: string; // label이 "미확인"일 때만
  pmi: number | null;
  pmi_as_of: string | null;
  breakeven: number | null;
  breakeven_date?: string;
  breakeven_change?: number; // lookback 대비 28일 평균 변화(%p) — 인플레 축 판정 근거
  breakeven_lookback_days?: number;
}

export interface CreditStress {
  label: string; // "평상" | "경계" | "경색" | "시스템위기" | "미확인"
  reason?: string;
  level_index?: 0 | 1 | 2 | 3;
  detail?: {
    hy_oas_pct: IndicatorReading | { status: "no_data" };
    vix_level: IndicatorReading | { status: "no_data" };
    curve_2s10y: { value: number; inverted: boolean } | { status: "no_data" };
  };
}

interface IndicatorReading {
  value: number;
  as_of: string;
  band: string;
}

export interface PolicyStance {
  label: string; // "완화" | "중립" | "긴축" | "미확인"
  reason?: string;
  current?: number;
  current_date?: string;
  lookback_days?: number;
  lookback_value?: number;
  lookback_date?: string;
}

export interface CrossCheck {
  status?: string; // 데이터 없을 때만
  nfci?: { value: number; as_of: string; interpretation: string };
  stlfsi4?: { value: number; as_of: string; interpretation: string };
}

export interface CompositeScore {
  score: number; // 0~100, 확률 아님 — 규정기반 감점 점수
  deductions: string[];
  note: string;
}

// ────────────────────── regime_history.json ──────────────────────
// 계획만 있고 아직 이 파일을 만드는 스크립트는 없다. end_date가 null이면 진행 중인 구간.

export interface RegimeHistoryEntry {
  id: string;
  start_date: string;
  end_date: string | null;
  growth_inflation: string;
  credit_stress: string;
  policy_stance: string;
  composite_score_at_start: number;
  trigger: string;
  notes: string;
}

// ────────────────────── events.json (기존 narrative-tracker) ──────────────────────
// 실제 레포 데이터를 파싱해 확인한 필드 — 메모나 README 요약이 아니라 원본 그대로.

export type NarrativeLayer = "cyclical" | "structural" | "political";
export type NarrativeStatus = "active" | "dormant" | "ended";
export type NarrativeIntensity = "high" | "mid" | "low";
// 5단계 사이클 — 지금 데이터엔 3개만 쓰이지만 기존 대시보드가 5개 모두 지원했다.
export type NarrativePhase = "shock" | "policy" | "overshoot" | "side_effect" | "correction";

export interface NarrativeEvent {
  id: string;
  name: string;
  layer: NarrativeLayer;
  layer_secondary: NarrativeLayer | null;
  phase: NarrativePhase | null;
  trigger_date: string;
  peak_date: string | null;
  half_life_date: string | null;
  status: NarrativeStatus;
  intensity: NarrativeIntensity;
  assets: string[];
  keywords: string[];
  reignition_triggers: string[];
  notes: string;
  last_auto?: { date: string; change: string };
}

// ────────────────────── attention.csv ──────────────────────
// collect_news.py가 이벤트별 Google News 일일 기사 수를 쌓는다 (RSS 특성상 100건에서 포화).

export interface AttentionRow {
  date: string;
  event_id: string;
  count: number | null;
}

// ────────────────────── market_snapshot.csv ──────────────────────
// collect_market_data.py의 FIELDNAMES와 1:1 대응. CSV라 파싱 후 전부 number | null.

export interface MarketSnapshotRow {
  date: string;
  vix: number | null;
  dxy_ice: number | null;
  dxy_broad: number | null;
  gold: number | null;
  wti: number | null;
  us10y: number | null;
  fedrate: number | null;
  us2y: number | null;
  hy_oas: number | null;
  breakeven10y: number | null;
  nfci: number | null;
  stlfsi4: number | null;
}

// ────────────────────── manual_inputs.json ──────────────────────

export interface ManualInputs {
  ism_pmi: {
    value: number | null;
    as_of: string | null;
    source: string;
    note: string;
  };
}
