import { INDICATORS, type IndicatorId } from "./indicators";
import { LIQUIDITY_SERIES, type LiquidityKey } from "./liquidity";

// '데이터 소스' 표용 — market_snapshot.csv 컬럼 이름을 화면 이름으로.
// 위젯·차트에 이미 있는 지표는 그 이름을 그대로 쓰고, 표에만 나오는 컬럼은 여기서 붙인다.
const EXTRA_LABELS: Record<string, string> = {
  us2y: "미 2년물",
  nfci: "NFCI 금융여건",
  stlfsi4: "STLFSI4 금융스트레스",
  usdkrw_fred: "원/달러 (연준 H.10)",
};

export function columnLabel(column: string): string {
  if (column in INDICATORS) return INDICATORS[column as IndicatorId].label;
  if (column in LIQUIDITY_SERIES) return LIQUIDITY_SERIES[column as LiquidityKey].label;
  return EXTRA_LABELS[column] ?? column;
}

export const fredSeriesUrl = (id: string) => `https://fred.stlouisfed.org/series/${encodeURIComponent(id)}`;

/** FRED last_updated("2026-10-08 15:31:02-05") → Date. 형식이 다르면 null. */
export function parseFredTimestamp(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})([+-]\d{2})(?::?(\d{2}))?$/.exec(raw.trim());
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}${m[3]}:${m[4] ?? "00"}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 한국시간 "26.10.09 05:31" */
export function formatKstShort(d: Date): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}.${get("month")}.${get("day")} ${get("hour")}:${get("minute")}`;
}
