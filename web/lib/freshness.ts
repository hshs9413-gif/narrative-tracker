import type { MarketSnapshotRow } from "@/types/dashboard";
import type { Indicator, JumpRule } from "./indicators";
import { dayDiff, toDate } from "./narrative-metrics";

// '값이 얼마냐'만큼 '언제 값이냐 · 이상하지 않으냐'를 화면에 드러내기 위한 계산.
// 데이터를 고치지 않고 보여주기만 한다 — 수집·판정 로직과 무관.

/** config/regime_thresholds.json의 growth_inflation.pmi_max_age_days와 같은 값 — 바꾸면 여기도 맞출 것. */
export const PMI_MAX_AGE_DAYS = 75;

export interface Reading {
  date: string;
  value: number;
}

export interface IndicatorStatus {
  latest: Reading;
  previous: Reading | null;
  /** 절대 변화 (latest − previous) */
  change: number | null;
  /** 상대 변화 (%) */
  changePct: number | null;
  /** 데이터 기준일(마지막 행)보다 며칠 뒤처진 값인가 */
  lagDays: number;
  stale: boolean;
  jump: boolean;
}

export function isJump(rule: JumpRule | undefined, previous: number, current: number): boolean {
  if (!rule) return false;
  const move = rule.kind === "pct" ? (previous === 0 ? 0 : Math.abs(current / previous - 1) * 100) : Math.abs(current - previous);
  return move >= rule.threshold;
}

/** 데이터 기준일 — 시장 CSV의 마지막 행 날짜. 지표별 값 날짜는 이보다 늦은 발표 때문에 뒤처질 수 있다. */
export function dataAnchor(rows: MarketSnapshotRow[]): string | null {
  return rows.length ? rows[rows.length - 1].date : null;
}

export function statusOf(rows: MarketSnapshotRow[], ind: Indicator): IndicatorStatus | null {
  const anchor = dataAnchor(rows);
  if (!anchor) return null;

  let latest: Reading | null = null;
  let previous: Reading | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const value = ind.value(rows[i]);
    if (value === null) continue;
    if (!latest) latest = { date: rows[i].date, value };
    else {
      previous = { date: rows[i].date, value };
      break;
    }
  }
  if (!latest) return null;

  const change = previous ? latest.value - previous.value : null;
  const changePct = previous && previous.value !== 0 ? (latest.value / previous.value - 1) * 100 : null;
  const lagDays = dayDiff(toDate(latest.date), toDate(anchor));
  return {
    latest, previous, change, changePct, lagDays,
    stale: lagDays > ind.staleAfterDays,
    jump: previous ? isJump(ind.jump, previous.value, latest.value) : false,
  };
}

/** 수집이 멈췄는지 — 데이터 기준일이 오늘(보는 사람 시계)보다 며칠 전인가. 주말·휴일을 감안해 4일까지는 정상. */
export function pipelineLagDays(anchor: string, today = new Date()): number {
  return dayDiff(toDate(anchor), new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())));
}

export interface PmiStatus {
  ageDays: number;
  /** 만료(= 레짐 성장·물가 축이 '미확인'으로 바뀜)까지 남은 일수. 음수면 이미 지남 */
  daysLeft: number;
  expired: boolean;
  /** 만료 임박(14일 이내) */
  soon: boolean;
}

export function pmiStatus(asOf: string | null | undefined, today = new Date()): PmiStatus | null {
  if (!asOf) return null;
  const todayUtc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const ageDays = dayDiff(toDate(asOf), todayUtc);
  const daysLeft = PMI_MAX_AGE_DAYS - ageDays;
  return { ageDays, daysLeft, expired: daysLeft < 0, soon: daysLeft >= 0 && daysLeft <= 14 };
}

/** 변동 표시 문자열 — 금리·스프레드류는 bp, 그 밖은 %. */
export function formatDelta(ind: Indicator, status: IndicatorStatus): string | null {
  if (status.change === null) return null;
  const rateLike = ind.stepped || ind.jump?.kind === "abs";
  if (rateLike) {
    const bp = Math.round(status.change * 100);
    return `${bp > 0 ? "+" : ""}${bp}bp`;
  }
  if (status.changePct === null) return null;
  return `${status.changePct > 0 ? "+" : ""}${status.changePct.toFixed(1)}%`;
}
