import type { FredCatalog, MarketSnapshotRow } from "@/types/dashboard";
import { formatNumber } from "./formatters";
import { dayDiff, toDate } from "./narrative-metrics";

// 연준 유동성 카드 계산 — H.4.1 총자산·지준·TGA와 역레포를 같은 단위(십억 달러)로 맞추고 순유동성을 낸다.
// 순유동성 = 총자산(WALCL) − TGA(WTREGEN) − 역레포(RRPONTSYD). 시장에서 흔히 쓰는 근사식이고, 판정에는 쓰지 않는다.
//
// CSV에는 FRED 원본 단위 그대로 들어 있다(시리즈마다 백만/십억 달러로 다름). 환산 단위는
// ① docs/data/fred_series.json의 FRED API 메타데이터(units)가 있으면 그것을, ② 없으면 FALLBACK_UNITS를 쓴다.

export type LiquidityKey = "fed_assets" | "reserves" | "tga" | "rrp";

export const LIQUIDITY_KEYS: LiquidityKey[] = ["fed_assets", "reserves", "tga", "rrp"];

export const LIQUIDITY_SERIES: Record<LiquidityKey, { id: string; label: string; description: string }> = {
  fed_assets: { id: "WALCL", label: "연준 총자산", description: "H.4.1 총자산 — 매주 수요일 기준, 목요일 발표 (FRED: WALCL)" },
  reserves: { id: "WRESBAL", label: "지급준비금", description: "은행 지준 잔고 — 주간 평균 (FRED: WRESBAL)" },
  tga: { id: "WTREGEN", label: "재무부 TGA", description: "재무부 일반계정 — 주간 평균. 늘면 시중 유동성을 흡수 (FRED: WTREGEN)" },
  rrp: { id: "RRPONTSYD", label: "역레포", description: "연준 익일물 역레포 잔액 — 일간. 늘면 유동성을 흡수 (FRED: RRPONTSYD)" },
};

/** scripts/fred_catalog.py의 EXPECTED_UNITS와 같게 유지 — FRED API 메타데이터가 없을 때의 기본값. */
export const FALLBACK_UNITS: Record<string, string> = {
  WALCL: "Millions of U.S. Dollars",
  WTREGEN: "Millions of U.S. Dollars",
  WRESBAL: "Billions of U.S. Dollars",
  RRPONTSYD: "Billions of U.S. Dollars",
};

/** FRED 단위 문자열 → 십억 달러 환산 계수. 달러 금액이 아니거나 모르는 단위면 null. */
export function billionsFactor(units: string | null | undefined): number | null {
  if (!units) return null;
  const u = units.trim().toLowerCase();
  if (!u.includes("dollar")) return null;
  if (u.startsWith("millions")) return 1e-3;
  if (u.startsWith("billions")) return 1;
  if (u.startsWith("trillions")) return 1e3;
  return null;
}

export interface UnitResolution {
  factor: number | null;
  units: string | null;
  /** fred_api = 메타데이터로 확인한 단위, fallback = 기본값 가정 */
  source: "fred_api" | "fallback";
}

export function resolveUnits(catalog: FredCatalog | null, key: LiquidityKey): UnitResolution {
  const id = LIQUIDITY_SERIES[key].id;
  const metaUnits = catalog?.series.find((s) => s.column === key && s.id === id)?.meta?.units;
  const fromMeta = billionsFactor(metaUnits);
  if (metaUnits && fromMeta !== null) return { factor: fromMeta, units: metaUnits, source: "fred_api" };
  const fallback = FALLBACK_UNITS[id] ?? null;
  return { factor: billionsFactor(fallback), units: fallback, source: "fallback" };
}

/** 값은 전부 십억 달러 */
export interface LiquidityRow {
  date: string;
  fed_assets: number | null;
  reserves: number | null;
  tga: number | null;
  rrp: number | null;
  net: number | null;
}

export type LiquidityField = LiquidityKey | "net";

export function liquidityRows(rows: MarketSnapshotRow[], units: Record<LiquidityKey, UnitResolution>): LiquidityRow[] {
  const out: LiquidityRow[] = [];
  for (const r of rows) {
    const scaled = Object.fromEntries(
      LIQUIDITY_KEYS.map((k) => {
        const raw = r[k];
        const f = units[k].factor;
        return [k, raw === null || f === null ? null : raw * f];
      }),
    ) as Record<LiquidityKey, number | null>;
    if (LIQUIDITY_KEYS.every((k) => scaled[k] === null)) continue;
    const net =
      scaled.fed_assets !== null && scaled.tga !== null && scaled.rrp !== null ? scaled.fed_assets - scaled.tga - scaled.rrp : null;
    out.push({ date: r.date, ...scaled, net });
  }
  return out;
}

export interface LiquidityReading {
  value: number;
  date: string;
  /** lookbackDays 전(그날 값이 없으면 그 이전 마지막 관측) 대비 변화 — 비교값이 없으면 null */
  change: number | null;
}

/** 가장 최근 값과 lookbackDays일 전 대비 변화 (주간 시리즈라 기본 4주). */
export function latestWithChange(rows: LiquidityRow[], field: LiquidityField, lookbackDays = 28): LiquidityReading | null {
  let i = rows.length - 1;
  while (i >= 0 && rows[i][field] === null) i--;
  if (i < 0) return null;
  const latest = { value: rows[i][field] as number, date: rows[i].date };
  const target = toDate(latest.date).getTime() - lookbackDays * 86_400_000;
  for (let j = i - 1; j >= 0; j--) {
    const v = rows[j][field];
    if (v !== null && toDate(rows[j].date).getTime() <= target) {
      // 비교 기준이 목표일보다 2주 넘게 앞서면(수집 공백) 변화를 내지 않는다
      if (dayDiff(toDate(rows[j].date), new Date(target)) > 14) break;
      return { ...latest, change: latest.value - v };
    }
  }
  return { ...latest, change: null };
}

/** 십억 달러 → "6.62조 달러" / "8,420억 달러" */
export function formatUsdBn(bn: number): string {
  const abs = Math.abs(bn);
  if (abs >= 1000) return `${(bn / 1000).toFixed(2)}조 달러`;
  return `${formatNumber(Math.round(bn * 10), 0)}억 달러`;
}

export function formatUsdBnDelta(bn: number): string {
  const sign = bn > 0 ? "+" : bn < 0 ? "−" : "±";
  return `${sign}${formatUsdBn(Math.abs(bn))}`;
}

/** 차트 축용 — 조 달러 한 자리 */
export const formatTrillionAxis = (bn: number) => `${(bn / 1000).toFixed(1)}조`;
