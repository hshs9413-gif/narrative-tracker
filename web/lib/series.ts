import { isJump } from "./freshness";
import type { JumpRule } from "./indicators";
import { dayDiff, toDate } from "./narrative-metrics";

// 차트에 그릴 시계열을 '값이 있는 관측일만' 이어 붙인다 — 휴장일처럼 하루이틀 비는 날은 건너뛰고(주식 차트와 같은 방식),
// 관측 사이가 MAX_GAP_DAYS를 넘게 비면 그 자리에 빈 점을 넣어 선을 끊는다. 값을 보간해 지어내지는 않는다.

export const MAX_GAP_DAYS = 7;

export interface SeriesPoint {
  date: string;
  value: number | null;
}

export interface CompactSeries {
  labels: string[];
  values: (number | null)[];
  /** values 기준 위치 — 직전 관측 대비 급변한 점 */
  jumps: Set<number>;
}

export function compactSeries(points: SeriesPoint[], rule?: JumpRule): CompactSeries {
  const labels: string[] = [];
  const values: (number | null)[] = [];
  const jumps = new Set<number>();
  let prev: { date: string; value: number } | null = null;

  for (const p of points) {
    if (p.value === null) continue;
    if (prev && dayDiff(toDate(prev.date), toDate(p.date)) > MAX_GAP_DAYS) {
      labels.push(prev.date); // 빈 점의 라벨 — 툴팁은 값이 없는 점을 걸러서 안 보인다
      values.push(null);
    }
    if (prev && isJump(rule, prev.value, p.value)) jumps.add(values.length);
    labels.push(p.date);
    values.push(p.value);
    prev = { date: p.date, value: p.value };
  }
  return { labels, values, jumps };
}
