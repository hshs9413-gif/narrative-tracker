import type { AttentionRow, MarketSnapshotRow } from "@/types/dashboard";

// 수집 스크립트가 쓰는 CSV 전용 — 모든 컬럼이 숫자·날짜·id라 따옴표/이스케이프 콤마는 지원 안 함.
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(header.map((key, i) => [key, (cells[i] ?? "").trim()]));
  });
}

const toNumber = (raw: string | undefined) => (raw ? Number(raw) : null);

const MARKET_COLUMNS = [
  "vix", "dxy_ice", "dxy_broad", "gold", "wti", "us10y",
  "fedrate", "us2y", "hy_oas", "breakeven10y", "nfci", "stlfsi4",
  "wti_front", "brent_front", "usdkrw", "kospi", "usdkrw_fred", "us30y", "real10y",
  "term_premium10y", "ig_oas", "ccc_oas", "sofr", "iorb", "fed_assets", "reserves", "rrp", "tga",
] as const;

export function parseMarketSnapshotCsv(text: string): MarketSnapshotRow[] {
  return parseCsv(text).map((raw) => {
    const row: Record<string, string | number | null> = { date: raw.date };
    for (const key of MARKET_COLUMNS) row[key] = toNumber(raw[key]);
    return row as unknown as MarketSnapshotRow;
  });
}

export function parseAttentionCsv(text: string): AttentionRow[] {
  return parseCsv(text).map((raw) => ({ date: raw.date, event_id: raw.event_id, count: toNumber(raw.count) }));
}
