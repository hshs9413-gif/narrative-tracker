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
