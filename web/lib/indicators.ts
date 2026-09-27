import type { MarketSnapshotRow } from "@/types/dashboard";
import { formatNumber, toBasisPoints } from "./formatters";

// 티커·차트가 공유하는 지표 정의. 설명은 기존 대시보드 티커의 툴팁 문구를 그대로 옮겼다.

type NumericKey = Exclude<keyof MarketSnapshotRow, "date">;

export interface Indicator {
  label: string;
  value: (row: MarketSnapshotRow) => number | null;
  format: (v: number) => string;
  description: string;
  stepped?: boolean;
}

const col = (key: NumericKey) => (row: MarketSnapshotRow) => row[key];

export const INDICATORS = {
  vix: { label: "VIX", value: col("vix"), format: (v) => v.toFixed(1), description: "CBOE 변동성지수 (FRED: VIXCLS)" },
  fedrate: {
    label: "연준 기준금리", value: col("fedrate"), format: (v) => `${v.toFixed(2)}%`, stepped: true,
    description: "연방기금금리 목표 상단 (FRED: DFEDTARU) — FOMC 결정 때만 바뀌는 계단형",
  },
  dxy_ice: {
    label: "달러 DXY", value: col("dxy_ice"), format: (v) => v.toFixed(2),
    description: "ICE 달러인덱스 — 6개 통화, 1973=100. 뉴스에서 말하는 달러인덱스",
  },
  dxy_broad: {
    label: "달러 광의", value: col("dxy_broad"), format: (v) => v.toFixed(2),
    description: "연준 광의 달러지수 — 26개 통화, 2006.1=100. 원화·위안 포함",
  },
  gold: { label: "금", value: col("gold"), format: (v) => formatNumber(v, 1), description: "금 선물 종가 (GC=F)" },
  wti: { label: "WTI", value: col("wti"), format: (v) => v.toFixed(2), description: "WTI 현물가 (FRED: DCOILWTICO)" },
  us10y: { label: "미 10년물", value: col("us10y"), format: (v) => `${v.toFixed(2)}%`, description: "미국채 10년물 수익률 (FRED: DGS10)" },
  hy_oas: {
    label: "하이일드 스프레드", value: col("hy_oas"), format: toBasisPoints,
    description: "ICE BofA 하이일드 옵션조정스프레드 (FRED: BAMLH0A0HYM2)",
  },
  curve_2s10y: {
    label: "2s10y 스프레드",
    value: (r) => (r.us10y !== null && r.us2y !== null ? r.us10y - r.us2y : null),
    format: (v) => `${v >= 0 ? "+" : ""}${Math.round(v * 100)}bp`,
    description: "10년물 − 2년물 금리차. 음수면 장단기 역전",
  },
  breakeven10y: {
    label: "10년 기대인플레(BEI)", value: col("breakeven10y"), format: (v) => `${v.toFixed(2)}%`,
    description: "10년 기대인플레이션 (FRED: T10YIE)",
  },
} satisfies Record<string, Indicator>;

export type IndicatorId = keyof typeof INDICATORS;

/** 뒤에서부터 값이 있는 첫 행 — 지표마다 발표 지연이 달라 마지막 행이 비어 있을 수 있다. */
export function latestReading(rows: MarketSnapshotRow[], indicator: Indicator) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const value = indicator.value(rows[i]);
    if (value !== null) return { value, date: rows[i].date };
  }
  return null;
}
