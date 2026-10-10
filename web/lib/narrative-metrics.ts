import type { AttentionRow, MarketSnapshotRow, NarrativeEvent, NarrativeLayer } from "@/types/dashboard";

// 기존 docs/index.html의 계산을 따르되(영향은 전체 지표가 아니라 트리거일 전후 변동으로 이벤트마다 낸다), 시장영향의 기준·종료 시점은 자산별 관측일로 잡는다(아래 computeImpact).

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
  /** 7일 이동평균 (판정 대상) */
  series: { date: string; count: number }[];
  days: number;
  recentAvg: number | null;
  peakAvg: number | null;
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

/** 트리거일 전후로 이 일수를 넘게 떨어진 관측은 '그 시점 값'으로 인정하지 않는다 (데이터 공백 방어). */
const MAX_GAP_DAYS = 10;
/** 트리거 이후 몇 번째 관측까지를 반응 구간으로 볼지 — 노트의 'T+5'. */
const AFTER_OBSERVATIONS = 5;

/**
 * 자산별로 '값이 있는 관측일'만 놓고 계산한다: 트리거일 직전 마지막 관측(T-1) → 트리거일 이후 첫 관측(T)에서
 * 5번째 뒤 관측(T+5)의 변동률.
 *
 * 예전에는 '트리거일에 가장 가까운 행의 인덱스 ±'로 계산했는데, CSV에는 월말 주말처럼 VIX·금·WTI가 비어 있는 행이
 * 끼어 있어서 직전 행이 그런 행이면 영향이 통째로 사라지고(연준 정치화·AI 밸류에이션이 '측정중'), 주말 트리거(이란 전쟁·
 * 하마스)는 기준일이 하루씩 어긋났다. 평일 트리거는 두 방식의 결과가 같다.
 */
function computeImpact(rows: MarketSnapshotRow[], iso: string): Impact | null {
  const trigger = toDate(iso).getTime();
  const moves = IMPACT_ASSETS.flatMap(([col, label]) => {
    let base: { value: number; at: number } | null = null;
    const after: { value: number; at: number }[] = [];
    for (const row of rows) {
      const value = row[col];
      if (value === null) continue;
      const at = toDate(row.date).getTime();
      if (at < trigger) base = { value, at };
      else {
        after.push({ value, at });
        if (after.length > AFTER_OBSERVATIONS) break;
      }
    }
    if (!base || base.value === 0 || after.length < 2) return [];
    if (trigger - base.at > MAX_GAP_DAYS * DAY_MS || after[0].at - trigger > MAX_GAP_DAYS * DAY_MS) return [];
    const end = after[Math.min(AFTER_OBSERVATIONS, after.length - 1)]; // 아직 T+5까지 안 쌓였으면 가장 최근 관측
    return [{ label, pct: (end.value / base.value - 1) * 100 }];
  });
  if (!moves.length) return null;
  moves.sort((x, y) => Math.abs(y.pct) - Math.abs(x.pct));
  const peak = Math.abs(moves[0].pct);
  const strong = moves.filter((m) => Math.abs(m.pct) >= 3).length;
  const grade = peak >= 8 || strong >= 3 ? "high" : peak >= 3 || strong >= 1 ? "mid" : "low";
  return { top: moves[0], peak, strong, grade };
}

// 최근 7개 평균 ÷ 7일 이동평균 최대, 3일 미만은 판정 안 함. 정점은 auto_transition.py와 같은 7일 이동평균 최대값 — 하루치로 재면 들쭉날쭉하다.
export function summarizeAttention(rows: AttentionRow[], eventId: string): AttentionSummary {
  const raw = rows
    .filter((r) => r.event_id === eventId && r.count !== null)
    .map((r) => ({ date: r.date, count: r.count as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const series = raw.map((s, i) => {
    const window = raw.slice(Math.max(0, i - 6), i + 1);
    return { date: s.date, count: window.reduce((sum, w) => sum + w.count, 0) / window.length };
  });
  if (raw.length < 3) return { series, days: raw.length, recentAvg: null, peakAvg: null, ratio: null };
  const recentAvg = series[series.length - 1].count;
  const peakAvg = Math.max(...series.map((s) => s.count));
  return { series, days: raw.length, recentAvg, peakAvg, ratio: peakAvg ? recentAvg / peakAvg : 0 };
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
    if (att.ratio !== null && impact) {
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
