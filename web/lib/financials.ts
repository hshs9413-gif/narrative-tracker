import type { SummaryRow } from "@/types/dashboard";

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

const PROXY_TIMEOUT_MS = 45_000;

/** Apps Script 프록시 GET — 응답의 {error}는 예외로 바꾼다. 키는 프록시에만 있다. */
export async function proxyGet<T>(base: string, params: Record<string, string>): Promise<T> {
  const url = new URL(base);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROXY_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as T & { error?: string };
    if (body && typeof body === "object" && "error" in body && body.error) throw new Error(body.error);
    return body;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw new Error("응답이 너무 늦습니다 — 잠시 뒤 다시 시도하세요");
    if (err instanceof TypeError) throw new Error("프록시에 연결하지 못했습니다 — Apps Script 배포(액세스: 모든 사용자)와 URL을 확인하세요");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
