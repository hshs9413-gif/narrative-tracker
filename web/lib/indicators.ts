import type { MarketSnapshotRow } from "@/types/dashboard";
import { formatNumber, toBasisPoints } from "./formatters";

// 위젯·추이 차트가 공유하는 지표 정의. 설명은 기존 대시보드 티커의 툴팁 문구를 그대로 옮겼다.

type NumericKey = Exclude<keyof MarketSnapshotRow, "date">;

/** 전 관측값 대비 변동이 이 기준을 넘으면 '급변'으로 표시한다 — 오류 판정이 아니라 원본 확인 신호. */
export interface JumpRule {
  kind: "pct" | "abs";
  threshold: number;
}

export interface Indicator {
  label: string;
  value: (row: MarketSnapshotRow) => number | null;
  format: (v: number) => string;
  description: string;
  stepped?: boolean;
  /** 데이터 기준일(마지막 행)보다 이만큼(일) 넘게 뒤처지면 '지연'으로 표시. 발표 주기가 긴 지표는 더 크게. */
  staleAfterDays: number;
  jump?: JumpRule;
}

const col = (key: NumericKey) => (row: MarketSnapshotRow) => row[key];
const pct2 = (v: number) => `${v.toFixed(2)}%`;

// 급변 임계값은 3년치 실데이터의 전일 대비 변동 분포를 보고 잡았다 (평상시엔 거의 안 걸리는 수준).
const DAILY = 5; // 일간 지표 — FRED는 보통 1~3일 늦게 올라온다
const WEEKLY = 10; // 주간(H.10 등) 지표

const DEFINITIONS = {
  vix: {
    label: "VIX", value: col("vix"), format: (v) => v.toFixed(1), staleAfterDays: DAILY,
    description: "CBOE 변동성지수 종가 (FRED: VIXCLS). FRED는 미국 장 마감 다음 날 밤(한국시간 22~23시)에 반영 — 그 전에는 하루 전 종가", jump: { kind: "pct", threshold: 40 },
  },
  fedrate: {
    label: "연준 기준금리", value: col("fedrate"), format: pct2, stepped: true, staleAfterDays: DAILY,
    description: "연방기금금리 목표 상단 (FRED: DFEDTARU) — FOMC 결정 때만 바뀌는 계단형",
  },
  dxy_ice: {
    label: "달러 DXY", value: col("dxy_ice"), format: (v) => v.toFixed(2), staleAfterDays: DAILY,
    description: "ICE 달러인덱스 — 6개 통화, 1973=100. 뉴스에서 말하는 달러인덱스",
    jump: { kind: "pct", threshold: 1.5 },
  },
  dxy_broad: {
    label: "달러 광의", value: col("dxy_broad"), format: (v) => v.toFixed(2), staleAfterDays: WEEKLY,
    description: "연준 광의 달러지수 — 26개 통화, 2006.1=100. 원화·위안 포함 (주간 발표라 며칠 늦음)",
    jump: { kind: "pct", threshold: 1 },
  },
  gold: {
    label: "금", value: col("gold"), format: (v) => formatNumber(v, 1), staleAfterDays: DAILY,
    description: "금 선물 종가 (GC=F)", jump: { kind: "pct", threshold: 5 },
  },
  wti: {
    label: "WTI 현물", value: col("wti"), format: (v) => v.toFixed(2), staleAfterDays: DAILY,
    description: "WTI 현물가 (FRED: DCOILWTICO) — 선물 근월물(CL=F)과 다를 수 있다",
    jump: { kind: "pct", threshold: 10 },
  },
  us10y: {
    label: "미 10년물", value: col("us10y"), format: pct2, staleAfterDays: DAILY,
    description: "미국채 10년물 수익률 (FRED: DGS10)", jump: { kind: "abs", threshold: 0.25 },
  },
  hy_oas: {
    label: "하이일드 스프레드", value: col("hy_oas"), format: toBasisPoints, staleAfterDays: DAILY,
    description: "ICE BofA 하이일드 옵션조정스프레드 (FRED: BAMLH0A0HYM2)", jump: { kind: "pct", threshold: 15 },
  },
  curve_2s10y: {
    label: "2s10y 스프레드",
    value: (r) => (r.us10y !== null && r.us2y !== null ? r.us10y - r.us2y : null),
    format: (v) => `${v >= 0 ? "+" : ""}${Math.round(v * 100)}bp`, staleAfterDays: DAILY,
    description: "10년물 − 2년물 금리차. 음수면 장단기 역전", jump: { kind: "abs", threshold: 0.2 },
  },
  breakeven10y: {
    label: "10년 기대인플레(BEI)", value: col("breakeven10y"), format: pct2, staleAfterDays: DAILY,
    description: "10년 기대인플레이션 (FRED: T10YIE)", jump: { kind: "abs", threshold: 0.1 },
  },

  // ── 2026-10 추가 수집분: 값이 아직 없으면 화면에서 자동으로 빠진다 ──
  wti_front: {
    label: "WTI 근월물", value: col("wti_front"), format: (v) => v.toFixed(2), staleAfterDays: DAILY,
    description: "WTI 근월물 선물 (CL=F) — 리포트 1차 소스와 같은 기준", jump: { kind: "pct", threshold: 10 },
  },
  brent_front: {
    label: "브렌트 근월물", value: col("brent_front"), format: (v) => v.toFixed(2), staleAfterDays: DAILY,
    description: "브렌트 근월물 선물 (BZ=F)", jump: { kind: "pct", threshold: 10 },
  },
  usdkrw: {
    label: "원/달러", value: col("usdkrw"), format: (v) => formatNumber(v, 1), staleAfterDays: DAILY,
    description: "원/달러 환율 (USD/KRW)", jump: { kind: "pct", threshold: 1.5 },
  },
  kospi: {
    label: "KOSPI", value: col("kospi"), format: (v) => formatNumber(v, 2), staleAfterDays: DAILY,
    description: "코스피 지수 (KS11)", jump: { kind: "pct", threshold: 4 },
  },
  us30y: {
    label: "미 30년물", value: col("us30y"), format: pct2, staleAfterDays: DAILY,
    description: "미국채 30년물 수익률 (FRED: DGS30)", jump: { kind: "abs", threshold: 0.25 },
  },
  real10y: {
    label: "10년 실질금리", value: col("real10y"), format: pct2, staleAfterDays: DAILY,
    description: "10년 TIPS 실질금리 (FRED: DFII10)", jump: { kind: "abs", threshold: 0.25 },
  },
  term_premium10y: {
    label: "10년 기간프리미엄", value: col("term_premium10y"), format: pct2, staleAfterDays: WEEKLY,
    description: "10년 기간프리미엄, ACM 모형 (FRED: THREEFYTP10) — 발표가 늦다", jump: { kind: "abs", threshold: 0.15 },
  },
  ig_oas: {
    label: "투자등급 스프레드", value: col("ig_oas"), format: toBasisPoints, staleAfterDays: DAILY,
    description: "ICE BofA 투자등급 OAS (FRED: BAMLC0A0CM)", jump: { kind: "pct", threshold: 15 },
  },
  ccc_oas: {
    label: "CCC 스프레드", value: col("ccc_oas"), format: toBasisPoints, staleAfterDays: DAILY,
    description: "ICE BofA CCC 이하 OAS (FRED: BAMLH0A3HYC)", jump: { kind: "pct", threshold: 15 },
  },
  sofr: {
    label: "SOFR", value: col("sofr"), format: pct2, staleAfterDays: DAILY,
    description: "담보부 익일물 금리 (FRED: SOFR)", jump: { kind: "abs", threshold: 0.15 },
  },
  iorb: {
    label: "지준금리(IORB)", value: col("iorb"), format: pct2, stepped: true, staleAfterDays: DAILY,
    description: "지급준비금 이자율 (FRED: IORB) — FOMC 때만 바뀌는 계단형",
  },
} satisfies Record<string, Indicator>;

export type IndicatorId = keyof typeof DEFINITIONS;

// 항목마다 stepped·jump가 있고 없고가 달라 리터럴 타입이 제각각이므로, 읽는 쪽에서는 Indicator로 통일해서 본다.
export const INDICATORS: Record<IndicatorId, Indicator> = DEFINITIONS;

/** 뒤에서부터 값이 있는 첫 행 — 지표마다 발표 지연이 달라 마지막 행이 비어 있을 수 있다. */
export function latestReading(rows: MarketSnapshotRow[], indicator: Indicator) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const value = indicator.value(rows[i]);
    if (value !== null) return { value, date: rows[i].date };
  }
  return null;
}
