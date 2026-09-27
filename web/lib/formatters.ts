/** dashboard-project 컨벤션: 축/툴팁 수치는 Intl.NumberFormat 축약 표기(1.2M, 350K)로. */
export function formatCompact(value: number, opts: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
    ...opts,
  }).format(value);
}

/** bp 단위 표시용 — hy_oas 등 FRED %값(예 2.65)을 265bp로 변환. */
export function toBasisPoints(percent: number): string {
  return `${Math.round(percent * 100)}bp`;
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    ...opts,
  }).format(new Date(iso));
}

/** regime_state.json의 label별 CSS 변수 색상 매핑 — credit_stress/policy_stance 배지용. */
export const CREDIT_STRESS_COLOR: Record<string, string> = {
  "평상": "var(--color-credit-normal)",
  "경계": "var(--color-credit-watch)",
  "경색": "var(--color-credit-crunch)",
  "시스템위기": "var(--color-credit-crisis)",
};

export const POLICY_STANCE_COLOR: Record<string, string> = {
  "완화": "var(--color-policy-easing)",
  "중립": "var(--color-policy-neutral)",
  "긴축": "var(--color-policy-tightening)",
};

export const LAYER_COLOR: Record<string, string> = {
  structural: "var(--color-layer-structural)",
  cyclical: "var(--color-layer-cyclical)",
  political: "var(--color-layer-political)",
};

export const LAYER_LABEL: Record<string, string> = {
  structural: "구조적",
  cyclical: "경기순환",
  political: "정치적",
};

export const STATUS_LABEL: Record<string, string> = {
  active: "진행중",
  dormant: "휴면",
  ended: "종료",
};

export const PHASE_LABEL: Record<string, string> = {
  shock: "충격",
  overshoot: "과잉반응",
  correction: "조정",
};

/** 강도 3단계를 점 개수로 — 새 색상 추가 없이 채도로만 구분(active/dormant/ended는
 * NarrativeEventCard에서 opacity로 이미 구분하므로 여기서 또 색을 쓰면 과함). */
export const INTENSITY_DOTS: Record<string, string> = {
  high: "●●●",
  mid: "●●○",
  low: "●○○",
};
