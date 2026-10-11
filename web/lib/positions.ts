// 지표 하나가 '평소와 얼마나 다른가'를 숫자로 — 판정 라벨 대신 화면이 쓰는 사실들.
//  · 최근 3년 중 위치(백분위): 지금 값이 3년 관측 중 몇 %보다 높은가
//  · 4주 변화: 지금 값 − 28일 전(그날 휴장이면 그 전 마지막 관측) 값
//  · 평소 4주 변화 폭: 3년 동안 모든 날의 4주 변화를 모아 낸 표준편차 — 지금 4주 변화가 그 몇 배인가
// 좋고 나쁨은 판단하지 않는다 (2026-10-11 규칙 판정이 예측력이 없고 '신용 평온'처럼 실제와 다른 인상을 줘서 화면에서 뺐음).

export interface Point {
  date: string;
  value: number;
}

export interface Position {
  latest: Point;
  /** 28일 전 값과의 차이 (단위는 원래 값 그대로) */
  change4w: number | null;
  /** 28일 전 값 대비 비율(%) */
  change4wPct: number | null;
  /** 최근 3년 관측 중 지금 값보다 낮거나 같은 비율 (0~100) */
  pct3y: number;
  min3y: number;
  max3y: number;
  /** 지금 4주 변화가 평소 4주 변화 폭(표준편차)의 몇 배인가 — 부호 포함 */
  z4w: number | null;
  /** 몇 년치로 계산했나 (데이터가 3년보다 짧을 때 표시용) */
  years: number;
}

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** date 이전(포함) 마지막 관측의 인덱스 — points는 날짜 오름차순 */
function indexAtOrBefore(points: Point[], date: number, hi = points.length - 1): number {
  let lo = 0;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t(points[mid].date) <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export function position(points: Point[], years = 3): Position | null {
  if (points.length < 30) return null;
  const latest = points[points.length - 1];
  const end = t(latest.date);
  const start = end - years * 365.25 * DAY;
  const from = Math.max(0, indexAtOrBefore(points, start) + 1);
  const win = points.slice(from);
  if (win.length < 30) return null;

  const values = win.map((p) => p.value);
  const below = values.filter((v) => v <= latest.value).length;

  // 4주 변화 — 지금과, 창 안 모든 날의 것(평소 폭을 재려고)
  const changes: number[] = [];
  for (let i = 0; i < win.length; i++) {
    const j = indexAtOrBefore(points, t(win[i].date) - 28 * DAY, from + i - 1);
    if (j >= 0 && t(win[i].date) - t(points[j].date) <= 35 * DAY) changes.push(win[i].value - points[j].value);
  }
  const k = indexAtOrBefore(points, end - 28 * DAY, points.length - 2);
  const base = k >= 0 && end - t(points[k].date) <= 35 * DAY ? points[k].value : null;
  const change4w = base === null ? null : latest.value - base;
  const mean = changes.reduce((a, b) => a + b, 0) / (changes.length || 1);
  const sd = Math.sqrt(changes.reduce((a, b) => a + (b - mean) ** 2, 0) / (changes.length || 1));

  return {
    latest,
    change4w,
    change4wPct: base ? (change4w! / Math.abs(base)) * 100 : null,
    pct3y: (below / values.length) * 100,
    min3y: Math.min(...values),
    max3y: Math.max(...values),
    z4w: change4w !== null && sd > 0 && changes.length > 50 ? change4w / sd : null,
    years: Math.min(years, (end - t(win[0].date)) / (365.25 * DAY)),
  };
}

/** 20거래일 실현변동성(연율, %) 시계열 — compute_regime.py의 국내 변동성과 같은 식(모표준편차·√252) */
export function realizedVol(points: Point[], window = 20): Point[] {
  const out: Point[] = [];
  const rets = points.slice(1).map((p, i) => Math.log(p.value / points[i].value));
  for (let i = window - 1; i < rets.length; i++) {
    const w = rets.slice(i - window + 1, i + 1);
    const m = w.reduce((a, b) => a + b, 0) / window;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / window);
    out.push({ date: points[i + 1].date, value: sd * Math.sqrt(252) * 100 });
  }
  return out;
}

/** 얼마나 눈에 띄는가 — 3년 극단(상·하위 5%)이거나 4주 변화가 평소의 2배 이상이면 0보다 크다 */
export function notability(p: Position): number {
  const extreme = Math.max(0, (p.pct3y - 95) / 5, (5 - p.pct3y) / 5); // 0~1
  const move = p.z4w === null ? 0 : Math.max(0, Math.abs(p.z4w) - 2 + 1e-9); // 2배 이상부터
  return extreme > 0 || move > 0 ? 1 + extreme + move : 0;
}
