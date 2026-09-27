import type { MarketSnapshotRow } from "@/types/dashboard";

const NUMERIC_COLUMNS = [
  "vix", "dxy_ice", "dxy_broad", "gold", "wti", "us10y",
  "fedrate", "us2y", "hy_oas", "breakeven10y", "nfci", "stlfsi4",
] as const;

/** collect_market_data.py 출력 CSV 전용 — 범용 CSV 파서 아님(따옴표·콤마 이스케이프
 * 미지원). 이 파일은 순수 숫자/날짜 컬럼만 갖는다는 스키마 전제로 단순하게 짰다. */
export function parseMarketSnapshotCsv(text: string): MarketSnapshotRow[] {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");

  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const raw: Record<string, string> = {};
    header.forEach((key, i) => {
      raw[key] = cells[i] ?? "";
    });

    const row: Record<string, string | number | null> = { date: raw.date };
    for (const key of NUMERIC_COLUMNS) {
      row[key] = raw[key] ? Number(raw[key]) : null;
    }
    return row as unknown as MarketSnapshotRow;
  });
}
