import type { AttentionRow, MarketSnapshotRow, NarrativeEvent, NarrativeLayer } from "@/types/dashboard";

// 기존 docs/index.html의 계산 그대로 — 영향은 전체 지표가 아니라 트리거일 전후 변동으로 이벤트마다 낸다.

const DAY_MS = 86_400_000;

const IMPACT_ASSETS = [
  ["vix", "VIX"], ["gold", "금"], ["wti", "WTI"], ["dxy_ice", "달러"], ["us10y", "10년물"],
] as const;

/** 층별 통상 지속기간(일) — 지정학 2~4주, 경기순환 수개월, 구조테마 수년. */
export const TYPICAL_DURATION: Record<NarrativeLayer, number> = { political: 28, cyclical: 180, structural: 730 };

export interface Impact {
  top: { label: string; pct: number };
  peak: number;
  /** 3% 이상 움직인 자산 수 */
  strong: number;
  grade: "high" | "mid" | "low";
}

export interface AttentionSummary {
  series: { date: string; count: number }[];
  latest: number | null;
  peak: number | null;
  ratio: number | null;
}

export type Quadrant =
  | "지배 내러티브" | "소음 (이미 반영)" | "저평가 리스크" | "휴면"
  | "영향 확인됨 (관심도 측정중)" | "영향 낮음" | "측정중";

export interface NarrativeMetrics {
  event: NarrativeEvent;
  elapsed: number;
  activeSpan: number;
  judgeSpan: number;
  isOver: boolean;
  durationLabel: string;
  typical: number;
  persistence: "단기" | "통상 범위" | "장기화" | "구조화";
  impact: Impact | null;
  attention: AttentionSummary;
  quadrant: Quadrant;
}

export const toDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
export const dayDiff = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY_MS);

/** 기준일에 가장 가까운 행 — 10일 넘게 떨어지면 무효(-1). */
function rowIndexNear(rows: MarketSnapshotRow[], iso: string): number {
  const t = toDate(iso).getTime();
  let best = -1;
  let bestGap = Infinity;
  rows.forEach((r, i) => {
    const gap = Math.abs(toDate(r.date).getTime() - t);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  });
  return bestGap <= 10 * DAY_MS ? best : -1;
}

/** 트리거 직전 행 → 5행 뒤 변동률. */
function computeImpact(rows: MarketSnapshotRow[], iso: string): Impact | null {
  const i = rowIndexNear(rows, iso);
  if (i < 1) return null;
  const before = rows[i - 1];
  const after = rows[Math.min(i + 5, rows.length - 1)];
  const moves = IMPACT_ASSETS.flatMap(([col, label]) => {
    const a = before[col];
    const b = after[col];
    return a === null || b === null || a === 0 ? [] : [{ label, pct: (b / a - 1) * 100 }];
  });
  if (!moves.length) return null;
  moves.sort((x, y) => Math.abs(y.pct) - Math.abs(x.pct));
  const peak = Math.abs(moves[0].pct);
  const strong = moves.filter((m) => Math.abs(m.pct) >= 3).length;
  const grade = peak >= 8 || strong >= 3 ? "high" : peak >= 3 || strong >= 1 ? "mid" : "low";
  return { top: moves[0], peak, strong, grade };
}

export function summarizeAttention(rows: AttentionRow[], eventId: string): AttentionSummary {
  const series = rows
    .filter((r) => r.event_id === eventId && r.count !== null)
    .map((r) => ({ date: r.date, count: r.count as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!series.length) return { series, latest: null, peak: null, ratio: null };
  const latest = series[series.length - 1].count;
  const peak = Math.max(...series.map((s) => s.count));
  return { series, latest, peak, ratio: peak ? latest / peak : 0 };
}

export function computeMetrics(
  events: NarrativeEvent[],
  market: MarketSnapshotRow[],
  attention: AttentionRow[],
  today = new Date(),
): NarrativeMetrics[] {
  return events.map((event) => {
    const trigger = toDate(event.trigger_date);
    const elapsed = dayDiff(trigger, today);
    const activeSpan = event.half_life_date ? dayDiff(trigger, toDate(event.half_life_date)) : elapsed;
    const typical = TYPICAL_DURATION[event.layer] ?? 180;
    const impact = computeImpact(market, event.trigger_date);
    const att = summarizeAttention(attention, event.id);

    // 휴면·종료는 '활성이었던 기간'으로 평가 — 경과일로 재면 끝난 이슈가 '구조화'로 잘못 분류된다.
    const isOver = event.status === "dormant" || event.status === "ended";
    const judgeSpan = isOver ? activeSpan : elapsed;
    const persistence =
      judgeSpan < typical * 0.5 ? "단기" : judgeSpan < typical ? "통상 범위" : judgeSpan < typical * 3 ? "장기화" : "구조화";
    const durationLabel = isOver
      ? `${activeSpan}일간 활성 후 ${event.status === "dormant" ? "휴면" : "종료"}`
      : `${elapsed}일차 진행중`;

    // 관심 vs 영향 사분면
    let quadrant: Quadrant = "측정중";
    if (att.series.length >= 3 && impact) {
      const hiAtt = (att.ratio ?? 0) >= 0.5;
      const hiImp = impact.grade !== "low";
      quadrant = hiAtt ? (hiImp ? "지배 내러티브" : "소음 (이미 반영)") : hiImp ? "저평가 리스크" : "휴면";
    } else if (impact) {
      quadrant = impact.grade !== "low" ? "영향 확인됨 (관심도 측정중)" : "영향 낮음";
    }

    return {
      event, elapsed, activeSpan, judgeSpan, isOver, durationLabel, typical, persistence,
      impact, attention: att, quadrant,
    };
  });
}
