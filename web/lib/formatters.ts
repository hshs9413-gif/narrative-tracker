/** bp 단위 표시용 — hy_oas 등 FRED %값(예 2.65)을 265bp로 변환. */
export function toBasisPoints(percent: number): string {
  return `${Math.round(percent * 100)}bp`;
}

export function formatNumber(value: number, maxFractionDigits = 2): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: maxFractionDigits });
}

// "YYYY-MM-DD"는 달력 날짜라 UTC로 고정해 포맷한다(미국 시간대에서 하루 전으로 보이던 문제). 타임스탬프는 KST.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = {}): string {
  const dateOnly = DATE_ONLY.test(iso);
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    timeZone: dateOnly ? "UTC" : "Asia/Seoul",
    ...opts,
  }).format(new Date(dateOnly ? `${iso}T00:00:00Z` : iso));
}

/** 좁은 자리(티커·차트 캡션)용 — 26.09.25 */
export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${y.slice(2)}.${m}.${d}`;
}

/** regime_state.json의 label별 색 — globals.css의 --nt-* (CoreUI 팔레트) 변수. credit_stress/policy_stance 배지용. */
export const CREDIT_STRESS_COLOR: Record<string, string> = {
  "평상": "var(--nt-credit-0)",
  "경계": "var(--nt-credit-1)",
  "경색": "var(--nt-credit-2)",
  "시스템위기": "var(--nt-credit-3)",
};

export const GROWTH_INFLATION_COLOR: Record<string, string> = {
  "골디락스": "var(--cui-success)",
  "인플레이션 레짐": "var(--cui-warning)",
  "스태그플레이션": "var(--cui-danger)",
  "청산·디플레충격": "var(--cui-info)",
};

export const POLICY_STANCE_COLOR: Record<string, string> = {
  "완화": "var(--nt-policy-easing)",
  "중립": "var(--nt-policy-neutral)",
  "긴축": "var(--nt-policy-tightening)",
};

export const LAYER_COLOR: Record<string, string> = {
  structural: "var(--nt-structural)",
  cyclical: "var(--nt-cyclical)",
  political: "var(--nt-political)",
};

/** CoreUI 컴포넌트(CProgress·CBadge 등)의 color prop용 이름 — LAYER_COLOR와 같은 색. */
export const LAYER_COLOR_NAME: Record<string, "warning" | "info" | "danger"> = {
  structural: "warning",
  cyclical: "info",
  political: "danger",
};

// 용어는 기존 대시보드·README와 통일 (경기순환 / 구조테마 / 정치제도).
export const LAYER_LABEL: Record<string, string> = {
  political: "정치/제도",
  cyclical: "경기순환",
  structural: "구조테마",
};

export const LAYER_ORDER = ["political", "cyclical", "structural"] as const;

export const STATUS_LABEL: Record<string, string> = {
  active: "활성",
  dormant: "휴면",
  ended: "종료",
};

export const PHASE_LABEL: Record<string, string> = {
  shock: "① 충격",
  policy: "② 정책대응",
  overshoot: "③ 과잉반응",
  side_effect: "④ 부작용 우려",
  correction: "⑤ 조정",
};

export const INTENSITY_LABEL: Record<string, string> = { high: "상", mid: "중", low: "하" };
export const INTENSITY_RANK: Record<string, number> = { high: 3, mid: 2, low: 1 };

/** 강도 3단계를 점 개수로 — 새 색상 추가 없이 구분. */
export const INTENSITY_DOTS: Record<string, string> = {
  high: "●●●",
  mid: "●●○",
  low: "●○○",
};
