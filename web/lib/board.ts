import type { KoreaRow, MarketSnapshotRow } from "@/types/dashboard";
import { formatNumber } from "./formatters";
import { position, realizedVol, type Point, type Position } from "./positions";

// 첫 화면 지표 표의 줄 — 묶음마다 몇 개씩. 같은 값이 여러 곳에 반복되던 것(판정 근거·숫자 타일·차트)을 이 표 하나로 모았다.
// change: 4주 변화를 어떻게 읽을지 — pct(%) · pp(%포인트) · bp(베이시스포인트) · pt(지수 포인트) · none(안 보임, 수급처럼 누적값)
// up/down: 값이 오르거나 내릴 때의 뜻 — 좋고 나쁨이 아니라 방향 설명이다.

export type ChangeUnit = "pct" | "pp" | "bp" | "pt" | "none";

/** 표가 읽는 원자료 — 시장(market_snapshot.csv)과 한국(korea_snapshot.csv, 한국은행 ECOS) */
export interface BoardData {
  market: MarketSnapshotRow[];
  korea: KoreaRow[];
}

export interface BoardRow {
  id: string;
  label: string;
  source: string;
  series: (d: BoardData) => Point[];
  format: (v: number) => string;
  change: ChangeUnit;
  stepped?: boolean;
  up?: string;
  down?: string;
}

export interface BoardGroup {
  name: string;
  rows: BoardRow[];
}

function points<T extends { date: string }>(rows: T[], key: keyof T): Point[] {
  return rows.flatMap((r) => {
    const v = r[key] as unknown;
    return typeof v === "number" && Number.isFinite(v) ? [{ date: r.date, value: v }] : [];
  });
}
const col = (key: Exclude<keyof MarketSnapshotRow, "date">) => (d: BoardData) => points(d.market, key);
const kcol = (key: Exclude<keyof KoreaRow, "date">) => (d: BoardData) => points(d.korea, key);

/** 최근 n관측 합 — 외국인 순매수처럼 하루 값이 들쭉날쭉한 수급은 20거래일 누적으로 본다 */
function rollingSum(ps: Point[], n = 20): Point[] {
  const out: Point[] = [];
  let sum = 0;
  ps.forEach((p, i) => {
    sum += p.value;
    if (i >= n) sum -= ps[i - n].value;
    if (i >= n - 1) out.push({ date: p.date, value: sum });
  });
  return out;
}

const pct2 = (v: number) => `${v.toFixed(2)}%`;
const bp = (v: number) => `${formatNumber(Math.round(v * 100), 0)}bp`;

export const BOARD: BoardGroup[] = [
  {
    name: "금리",
    rows: [
      { id: "us10y", label: "미 10년물", source: "FRED DGS10", series: col("us10y"), format: pct2, change: "bp" },
      { id: "us2y", label: "미 2년물", source: "FRED DGS2", series: col("us2y"), format: pct2, change: "bp" },
      { id: "real10y", label: "미 10년 실질금리", source: "FRED DFII10", series: col("real10y"), format: pct2, change: "bp" },
      { id: "fedrate", label: "연준 기준금리(상단)", source: "FRED DFEDTARU", series: col("fedrate"), format: pct2, change: "bp", stepped: true },
    ],
  },
  {
    name: "신용",
    rows: [
      { id: "hy_oas", label: "하이일드 스프레드", source: "FRED BAMLH0A0HYM2", series: col("hy_oas"), format: bp, change: "bp", up: "위험 회피", down: "위험 선호" },
      { id: "ccc_oas", label: "CCC 등급 스프레드", source: "FRED BAMLH0A3HYC", series: col("ccc_oas"), format: bp, change: "bp", up: "위험 회피", down: "위험 선호" },
      { id: "ig_oas", label: "투자등급 스프레드", source: "FRED BAMLC0A0CM", series: col("ig_oas"), format: bp, change: "bp", up: "위험 회피", down: "위험 선호" },
    ],
  },
  {
    name: "변동성",
    rows: [
      { id: "vix", label: "VIX (미국 주식)", source: "FRED VIXCLS", series: col("vix"), format: (v) => v.toFixed(1), change: "pt", up: "불안 커짐", down: "안정" },
    ],
  },
  {
    name: "물가",
    rows: [
      { id: "breakeven10y", label: "미 10년 기대인플레", source: "FRED T10YIE", series: col("breakeven10y"), format: pct2, change: "bp" },
    ],
  },
  {
    name: "환율·원자재",
    rows: [
      { id: "dxy_ice", label: "달러인덱스", source: "ICE DXY", series: col("dxy_ice"), format: (v) => v.toFixed(2), change: "pct", up: "달러 강세", down: "달러 약세" },
      { id: "gold", label: "금", source: "금 선물(GC=F)", series: col("gold"), format: (v) => formatNumber(v, 0), change: "pct" },
      { id: "wti_front", label: "WTI 원유", source: "근월물 선물(CL=F)", series: col("wti_front"), format: (v) => v.toFixed(2), change: "pct" },
      { id: "brent_front", label: "브렌트 원유", source: "근월물 선물(BZ=F)", series: col("brent_front"), format: (v) => v.toFixed(2), change: "pct" },
    ],
  },
  {
    // 한국은행 ECOS(기준금리·국고채·외국인 순매수)는 키가 등록돼 수집이 돈 뒤부터 보인다 — 그 전에는 그 줄만 빠진다
    name: "한국",
    rows: [
      { id: "bok_rate", label: "한국은행 기준금리", source: "한국은행 ECOS 722Y001", series: kcol("bok_rate"), format: pct2, change: "bp", stepped: true },
      { id: "ktb3y", label: "국고채 3년", source: "한국은행 ECOS 817Y002", series: kcol("ktb3y"), format: (v) => `${v.toFixed(3)}%`, change: "bp" },
      { id: "ktb10y", label: "국고채 10년", source: "한국은행 ECOS 817Y002", series: kcol("ktb10y"), format: (v) => `${v.toFixed(3)}%`, change: "bp" },
      { id: "usdkrw", label: "원/달러", source: "시장 환율(KRW=X)", series: col("usdkrw"), format: (v) => formatNumber(v, 1), change: "pct", up: "원화 약세", down: "원화 강세" },
      { id: "kospi", label: "코스피", source: "KS11", series: col("kospi"), format: (v) => formatNumber(v, 0), change: "pct" },
      {
        id: "kospi_rv20", label: "코스피 20일 변동성", source: "코스피 일간 수익률로 계산(연율)",
        series: (d) => realizedVol(col("kospi")(d)), format: (v) => `${v.toFixed(0)}%`, change: "pp", up: "출렁임 커짐", down: "안정",
      },
      {
        id: "foreign_net20", label: "외국인 순매수 20일 누적", source: "한국은행 ECOS 802Y001, 유가증권시장",
        series: (d) => rollingSum(kcol("foreign_net")(d)), change: "none", up: "외국인 매수", down: "외국인 매도",
        format: (v) => `${v >= 0 ? "+" : "−"}${formatNumber(Math.abs(v) / 10000, 1)}조원`,
      },
    ],
  },
];

export const BOARD_ROWS = BOARD.flatMap((g) => g.rows);

export interface Reading {
  row: BoardRow;
  points: Point[];
  pos: Position | null;
}

export function readBoard(d: BoardData): Reading[] {
  return BOARD_ROWS.map((row) => {
    const pts = row.series(d);
    const pos = position(pts);
    // 누적 수급은 '4주 변화'가 뜻이 없어 빼고, 3년 중 위치(역대급 순매도·순매수인지)만 본다
    return { row, points: pts, pos: pos && row.change === "none" ? { ...pos, change4w: null, change4wPct: null, z4w: null } : pos };
  });
}

/** 4주 변화를 단위에 맞춰 — '+0.45%p'가 아니라 하이일드는 '+45bp', 코스피는 '-5.3%' */
export function formatChange(r: BoardRow, p: Position): string | null {
  if (p.change4w === null || r.change === "none") return null;
  const s = (v: number, d = 0) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(d)}`;
  switch (r.change) {
    case "pct":
      return p.change4wPct === null ? null : `${s(p.change4wPct, 1)}%`;
    case "bp":
      return `${s(p.change4w * 100)}bp`;
    case "pp":
      return `${s(p.change4w, 0)}%p`;
    case "pt":
      return s(p.change4w, 1);
    default:
      return null;
  }
}

/** 3년 중 위치를 말로 — '3년 최고', '상위 4%', '하위 12%', '중간쯤' */
export function positionWords(p: Position): string {
  const span = p.years >= 2.9 ? "3년" : `${p.years.toFixed(1)}년`;
  if (p.latest.value >= p.max3y) return `${span} 최고`;
  if (p.latest.value <= p.min3y) return `${span} 최저`;
  const hi = 100 - p.pct3y;
  if (hi <= 50) return `${span} 중 상위 ${Math.max(1, Math.round(hi))}%`;
  return `${span} 중 하위 ${Math.max(1, Math.round(p.pct3y))}%`;
}
