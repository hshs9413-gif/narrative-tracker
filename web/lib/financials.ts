import type { FinancialsIndexEntry, SummaryRow } from "@/types/dashboard";

// 기업 재무 화면 계산·표시 — 금액은 원 단위로 받아 조/억으로 줄여 보여준다.

export const digitsOnly = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

export const fmtBzno = (d: string | null | undefined) => {
  const x = digitsOnly(d);
  return x.length === 10 ? `${x.slice(0, 3)}-${x.slice(3, 5)}-${x.slice(5)}` : x;
};

export const fmtCrno = (d: string | null | undefined) => {
  const x = digitsOnly(d);
  return x.length === 13 ? `${x.slice(0, 6)}-${x.slice(6)}` : x;
};

/** 원 → "300.9조" / "8,420억" / "5,000만" */
export function formatKrw(won: number | null | undefined, digits = 1): string {
  if (won === null || won === undefined || Number.isNaN(won)) return "—";
  const abs = Math.abs(won);
  const sign = won < 0 ? "−" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: digits })}조`;
  if (abs >= 1e8) return `${sign}${Math.round(abs / 1e8).toLocaleString("ko-KR")}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString("ko-KR")}만`;
  return `${sign}${abs.toLocaleString("ko-KR")}`;
}

/** 차트 축 — 단위를 축 전체에서 하나로 맞춘다 */
export function axisUnit(maxAbs: number): { div: number; label: string } {
  if (maxAbs >= 1e12) return { div: 1e12, label: "조원" };
  if (maxAbs >= 1e8) return { div: 1e8, label: "억원" };
  return { div: 1, label: "원" };
}

export const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v.toFixed(digits)}%`;

export function ratio(num: number | null, den: number | null): number | null {
  if (num === null || den === null || den === 0) return null;
  return (num / den) * 100;
}

/** 전년 대비 증감률(%) — 기준값이 0 이하면(적자 등) 비율이 뜻이 없어 null */
export function yoy(curr: number | null, prev: number | null): number | null {
  if (curr === null || prev === null || prev <= 0) return null;
  return (curr / prev - 1) * 100;
}

export function bases(rows: SummaryRow[]): string[] {
  const order = ["연결", "별도"];
  const found = Array.from(new Set(rows.map((r) => r.basis)));
  return found.sort((a, b) => (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9));
}

/** 회사명 일부, 사업자등록번호·법인등록번호(하이픈 무관, 앞자리 일부도)로 찾는다. */
export function searchCompanies(list: FinancialsIndexEntry[], query: string): FinancialsIndexEntry[] {
  const q = query.trim();
  if (!q) return list;
  const d = digitsOnly(q);
  const lower = q.toLowerCase();
  return list.filter((c) => {
    if (c.name.toLowerCase().includes(lower)) return true;
    if (d.length >= 3 && (digitsOnly(c.bzno).startsWith(d) || digitsOnly(c.crno).startsWith(d))) return true;
    return false;
  });
}

/** 입력이 '목록에 없는 번호'면 무엇인지 — 조회 요청 안내에 쓴다 */
export function numberKind(query: string): "bzno" | "crno" | null {
  const d = digitsOnly(query);
  if (d.length === 10) return "bzno";
  if (d.length === 13) return "crno";
  return null;
}

export const FINANCIALS_WORKFLOW_URL =
  "https://github.com/hshs9413-gif/narrative-tracker/actions/workflows/financials.yml";
