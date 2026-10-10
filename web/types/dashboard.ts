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
  composite_score?: CompositeScore; // 화면에서는 쓰지 않는다 (compute_regime.py는 계속 기록)
  report_crosscheck?: ReportCrossCheck; // 외부 리포트 물가축과 맞춰 볼 입력값 — 판정에는 안 쓰는 출력 전용
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

export type NoData = { status: "no_data" };

export interface ReportCrossCheck {
  wti_front_4w: NoData | {
    value: number; as_of: string; base_value: number; base_date: string;
    lookback_days: number; change: number; change_pct: number;
  };
  breakeven_3m: NoData | {
    value: number; as_of: string; window_days: number; lookback_days: number; change: number;
  };
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
  // 2026-10 추가 — 리포트 소스 맞추기·한국·장기금리/신용/유동성. 아직 화면에는 안 쓰고 값만 읽어둔다.
  wti_front: number | null;
  brent_front: number | null;
  usdkrw: number | null;
  kospi: number | null;
  usdkrw_fred: number | null;
  us30y: number | null;
  real10y: number | null;
  term_premium10y: number | null;
  ig_oas: number | null;
  ccc_oas: number | null;
  sofr: number | null;
  iorb: number | null;
  fed_assets: number | null;
  reserves: number | null;
  rrp: number | null;
  tga: number | null;
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

// ────────────────────── fred_series.json ──────────────────────
// scripts/fred_catalog.py가 매일 수집 끝에 쓴다. meta는 FRED API(fred/series) 응답에서 고른 필드 —
// FRED_API_KEY가 한 번도 없었으면 null이다.

export type FredVia = "fred_api" | "fdr" | "failed";

export interface FredSeriesMeta {
  id: string;
  title: string;
  units: string;
  units_short: string;
  frequency: string;
  frequency_short: string;
  seasonal_adjustment_short: string;
  observation_start: string;
  observation_end: string;
  /** FRED 형식 "2026-10-08 15:31:02-05" (미 중부시간 오프셋) */
  last_updated: string;
}

export interface FredCatalogEntry {
  column: string;
  id: string;
  via: FredVia | null;
  meta: FredSeriesMeta | null;
  meta_fetched_at: string | null;
}

export interface FredCatalog {
  generated_at: string;
  api_key_configured: boolean;
  /** missing = 워크플로우에 Secret이 전달 안 됨, malformed = 값 형식 오류. 예전 파일엔 없음 */
  api_key_status?: "ok" | "missing" | "malformed";
  series: FredCatalogEntry[];
}

// ────────────────────── financials/*.json ──────────────────────
// scripts/collect_financials.py 출력 — 금융위원회_기업 재무정보 API. 금액은 원(KRW), debt_ratio는 %.

export interface FinancialsIndexEntry {
  crno: string;
  bzno: string | null;
  name: string;
  years: [string, string];
  fetched_at?: string;
}

export interface FinancialsIndex {
  generated_at: string;
  companies: FinancialsIndexEntry[];
}

export interface SummaryRow {
  year: string;
  /** "연결" | "별도" (그 밖이면 원문 이름) */
  basis: string;
  basis_name: string | null;
  as_of: string | null;
  currency: string | null;
  revenue: number | null;
  operating_income: number | null;
  net_income: number | null;
  comprehensive_income: number | null;
  assets: number | null;
  liabilities: number | null;
  equity: number | null;
  capital: number | null;
  debt_ratio: number | null;
}

export interface AccountRow {
  basis: string;
  account_id: string | null;
  account: string | null;
  current: number | null;
  previous: number | null;
  before_previous: number | null;
}

export interface StatementBlock {
  year: string;
  items: AccountRow[];
  error?: string;
}

/** 금융위원회_기업기본정보(getCorpOutline_V2) 중 화면에 쓰는 항목 — 기업기본정보 활용신청 전 수집분은 null */
export interface CompanyProfile {
  name: string | null;
  bzno: string | null;
  ceo: string | null;
  established: string | null; // YYYYMMDD
  corp_type: string | null;
  industry: string | null;
  main_business: string | null;
  address: string | null;
  address_detail: string | null;
  homepage: string | null;
  phone: string | null;
  employees: number | null;
  market: string | null;
  krx_listed: string | null;
  kosdaq_listed: string | null;
  sme: string | null;
  fiscal_month: string | null;
  auditor: string | null;
  audit_opinion: string | null;
  changed_at: string | null;
}

export interface CompanyFinancials {
  crno: string;
  bzno: string | null;
  name: string;
  profile?: CompanyProfile | null;
  fetched_at: string;
  source: string;
  summary: SummaryRow[];
  balance_sheet: StatementBlock;
  income_statement: StatementBlock;
}
