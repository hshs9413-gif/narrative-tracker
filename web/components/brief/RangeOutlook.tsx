"use client";

import { useMemo } from "react";
import { useKoreaSnapshot, useMarketSnapshot, useRanges } from "@/lib/hooks/use-dashboard-data";
import { BOARD_ROWS, readBoard } from "@/lib/board";
import { monthDay } from "@/lib/brief";
import type { Point } from "@/lib/positions";
import type { RangeItem } from "@/types/dashboard";

// 한 달 뒤 예상 범위 — 방향을 맞히지 않고 '얼마나 움직일 수 있나'만. 계산은 scripts/compute_ranges.py가 하고(최근 60거래일
// 하루 변동 폭 × √20 × 1.645), 여기서는 보여 주기만 한다. 적중률은 같은 계산을 지난 기록에 날마다 되짚은 결과와,
// 실제로 미리 낸 범위의 성적(range_log.csv) 두 가지를 따로 적는다.

const PAST = 60; // 변동 폭을 잰 바로 그 석 달 — 부채꼴 폭이 왜 그만한지 그림에서 보이게
const Z = 1.645;

/** 최근 석 달 선 + 오늘부터 20거래일 동안 넓어지는 범위(부채꼴) */
function Cone({ it, past }: { it: RangeItem; past: Point[] }) {
  const W = 240;
  const H = 52;
  const pad = 3;
  const steps = 20;
  const edge = (h: number, sign: 1 | -1) => {
    const s = Z * it.sigma * Math.sqrt(h);
    return it.kind === "log" ? it.base * Math.exp(sign * s) : it.base + (sign * s) / 100;
  };
  const vals = past.map((p) => p.value);
  const lo = Math.min(...vals, it.lo);
  const hi = Math.max(...vals, it.hi);
  const span = hi - lo || 1;
  const n = past.length - 1 + steps;
  const x = (i: number) => pad + (i / n) * (W - pad * 2);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (H - pad * 2);
  const line = past.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const t0 = past.length - 1;
  const up: string[] = [];
  const down: string[] = [];
  for (let h = 0; h <= steps; h++) {
    up.push(`${x(t0 + h).toFixed(1)},${y(edge(h, 1)).toFixed(1)}`);
    down.push(`${x(t0 + h).toFixed(1)},${y(edge(h, -1)).toFixed(1)}`);
  }
  return (
    <svg className="nt-cone" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
      aria-label={`${it.label} 최근 석 달과 한 달 뒤 90% 범위`}>
      <polygon points={[...up, ...[...down].reverse()].join(" ")} className="nt-cone-band" />
      <polyline points={up.join(" ")} className="nt-cone-edge" />
      <polyline points={down.join(" ")} className="nt-cone-edge" />
      <path d={line} className="nt-cone-line" />
    </svg>
  );
}

function width(it: RangeItem): string {
  if (it.kind === "bp") return `±${Math.round((it.hi - it.base) * 100)}bp`;
  const dn = (it.lo / it.base - 1) * 100;
  const up = (it.hi / it.base - 1) * 100;
  return `−${Math.abs(dn).toFixed(1)}% ~ +${up.toFixed(1)}%`;
}

function Row({ it, past }: { it: RangeItem; past: Point[] }) {
  const fmt = BOARD_ROWS.find((r) => r.id === it.id)?.format ?? ((v: number) => v.toFixed(2));
  const bt = it.backtest;
  const rate = bt.rate === null ? null : Math.round(bt.rate * 100);
  const years = bt.from && bt.to ? (Date.parse(bt.to) - Date.parse(bt.from)) / (365.25 * 86_400_000) : 0;
  const missed = bt.above + bt.below;
  const lopsided = missed >= 10 && Math.max(bt.above, bt.below) / missed >= 0.75;
  const low = rate !== null && rate < 85;

  return (
    <li className="nt-range-row">
      <span className="nt-range-name">
        {it.label}
        <small>
          지금 <span className="tnum">{fmt(it.base)}</span> · {monthDay(it.base_date)}
        </small>
      </span>
      <span className="nt-range-cone">{past.length > 20 && <Cone it={it} past={past} />}</span>
      <span className="nt-range-band">
        <b className="tnum">
          {fmt(it.lo)} ~ {fmt(it.hi)}
        </b>
        <small className="nt-range-sub">
          <span className="tnum">{width(it)}</span>
          <span> · {monthDay(it.due)} 무렵</span>
        </small>
      </span>
      <span className="nt-range-hit" data-low={low ? "" : undefined}>
        <span>
          <b className="tnum">{rate === null ? "—" : `${rate}%`}</b> <small>지난 {years.toFixed(1)}년 되짚은 적중률</small>
        </span>
        {(low || lopsided) && (
          <small>
            {low && "90%에 못 미침"}
            {low && lopsided && " · "}
            {lopsided && `빗나간 ${missed}일 중 ${Math.max(bt.above, bt.below)}일이 범위 ${bt.above > bt.below ? "위" : "아래"}로`}
          </small>
        )}
        <small>
          {it.live.n > 0
            ? `미리 낸 범위 ${it.live.n}번 중 ${it.live.inside}번 적중`
            : it.live.next_due
              ? `미리 낸 범위 채점은 ${monthDay(it.live.next_due)}부터`
              : null}
        </small>
      </span>
    </li>
  );
}

export function RangeOutlook() {
  const ranges = useRanges();
  const market = useMarketSnapshot();
  const korea = useKoreaSnapshot();
  const series = useMemo(() => {
    if (!market.data) return {} as Record<string, Point[]>;
    const rs = readBoard({ market: market.data, korea: korea.data ?? [] });
    return Object.fromEntries(rs.map((r) => [r.row.id, r.points]));
  }, [market.data, korea.data]);
  const items = ranges.data?.items ?? [];
  if (!items.length) return null;

  return (
    <section id="ranges" className="nt-block">
      <h2 className="nt-h2">한 달 뒤 예상 범위</h2>
      <p className="nt-lede">
        오를지 내릴지 맞히는 예측이 아닙니다. 최근 석 달(60거래일)의 하루 변동 폭이 이어진다고 보고, 20거래일 뒤 값이 열 번 중 아홉 번
        들어올 범위를 계산했습니다. 적중률은 같은 계산을 지난 기록에 날마다 되짚어 실제로 범위 안에 든 비율로, 90%에 가까울수록 믿을 만합니다.
      </p>
      <ul className="nt-range">
        {items.map((it) => {
          const pts = series[it.id] ?? [];
          // 범위의 기준일까지만 — 화면 데이터가 그 뒤로 더 있어도 부채꼴이 기준값에서 시작하게
          const upto = pts.filter((p) => p.date <= it.base_date).slice(-PAST);
          return <Row key={it.id} it={it} past={upto} />;
        })}
      </ul>
      <p className="nt-note">
        VIX와 신용 스프레드는 이 방법이 맞지 않아 뺐습니다(되짚어 보면 VIX는 범위를 너무 넓게, 스프레드는 너무 좁게 잡음). 범위는 매일
        기록해 20거래일 뒤 실제 값으로 채점하며, 구글 시트 range_log 탭에서도 볼 수 있습니다. 최근 석 달에 큰 급등락이 있었으면 그만큼
        범위가 넓게 나오고, 그 날들이 석 달 밖으로 빠지면 좁아집니다.
      </p>
    </section>
  );
}
