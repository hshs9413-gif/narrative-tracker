"use client";

import { useMemo } from "react";
import { useMarketSnapshot, useRegimeState } from "@/lib/hooks/use-dashboard-data";
import { BOARD, readBoard, formatChange, positionWords, type Reading } from "@/lib/board";
import { notability } from "@/lib/positions";
import { monthDay } from "@/lib/brief";
import { Sparkline } from "./Sparkline";

// 주요 지표 한 표 — 묶음(금리·신용·변동성·물가·환율·원자재·주식)마다 한 줄씩: 값과 기준일, 4주 변화, 최근 3년 중 위치, 6개월 흐름.
// 예전에는 같은 값이 판정 근거·숫자 타일·큰 차트에 세 번 나왔다(10/11 정리).

const SPARK = 130; // 약 6개월(거래일)

function Bar({ r }: { r: Reading }) {
  // 점 위치 = 3년 관측 중 백분위(옆 글자 '상위 n%'와 같은 기준). 왼쪽 끝 3년 최저, 오른쪽 끝 3년 최고
  const p = r.pos!;
  const at = p.latest.value >= p.max3y ? 100 : p.latest.value <= p.min3y ? 0 : p.pct3y;
  return (
    <span className="nt-pos">
      <span className="nt-pos-track" aria-hidden="true">
        <i style={{ left: `${Math.min(100, Math.max(0, at))}%` }} />
      </span>
      <span className="nt-pos-words">{positionWords(p)}</span>
    </span>
  );
}

function Row({ r }: { r: Reading }) {
  const p = r.pos;
  const latest = p?.latest ?? r.points.at(-1);
  if (!latest) return null;
  const chg = p ? formatChange(r.row, p) : null;
  const big = p?.z4w != null && Math.abs(p.z4w) >= 2;
  return (
    <li className="nt-board-row" data-notable={p && notability(p) > 0 ? "" : undefined}>
      <span className="nt-board-name">
        {r.row.label}
        <small>{r.row.source}</small>
      </span>
      <span className="nt-board-value">
        <b className="tnum">{r.row.format(latest.value)}</b>
        <small>{monthDay(latest.date)}</small>
      </span>
      <span className="nt-board-chg tnum" data-big={big ? "" : undefined} title={big ? `평소 4주 변동의 ${Math.abs(p!.z4w!).toFixed(1)}배` : undefined}>
        {chg ?? "—"}
      </span>
      <span className="nt-board-pos">{p ? <Bar r={r} /> : <span className="nt-pos-words">기록 부족</span>}</span>
      <span className="nt-board-spark">
        <Sparkline values={r.points.slice(-SPARK).map((x) => x.value)} stepped={r.row.stepped} width={140} height={28} label={`${r.row.label} 최근 6개월`} />
      </span>
    </li>
  );
}

export function IndicatorTable() {
  const market = useMarketSnapshot();
  const regime = useRegimeState();
  const readings = useMemo(() => (market.data ? readBoard(market.data) : []), [market.data]);
  if (!market.data?.length) return null;
  const byId = Object.fromEntries(readings.map((r) => [r.row.id, r]));
  const gi = regime.data?.growth_inflation;

  return (
    <section id="indicators" className="nt-block">
      <h2 className="nt-h2">주요 지표</h2>
      <p className="nt-lede">
        값 옆 날짜는 그 값이 나온 날입니다. 막대의 점은 최근 3년 관측 중 지금 값의 위치(왼쪽이 낮음), 선은 최근 6개월 흐름입니다.
        색이 깔린 줄은 위의 &lsquo;평소와 다른 지표&rsquo;이고, 붉은 4주 변화는 평소 4주 변동 폭의 2배를 넘은 것입니다.
      </p>
      <div className="nt-board">
        <div className="nt-board-row nt-board-head" aria-hidden="true">
          <span>지표</span>
          <span>값</span>
          <span>4주 변화</span>
          <span>최근 3년 중 위치</span>
          <span>6개월</span>
        </div>
        {BOARD.map((g) => (
          <section key={g.name} className="nt-board-group">
            <h3>{g.name}</h3>
            <ul>
              {g.rows.map((row) => byId[row.id] && <Row key={row.id} r={byId[row.id]} />)}
              {g.name === "물가" && gi?.pmi != null && (
                <li className="nt-board-row">
                  <span className="nt-board-name">
                    ISM 제조업 PMI
                    <small>월 1회 발표, 50 이상이면 확장</small>
                  </span>
                  <span className="nt-board-value">
                    <b className="tnum">{gi.pmi}</b>
                    <small>{gi.pmi_as_of ? `${Number(gi.pmi_as_of.slice(5, 7))}월 지표` : ""}</small>
                  </span>
                  <span className="nt-board-chg">—</span>
                  <span className="nt-board-pos" />
                  <span className="nt-board-spark" />
                </li>
              )}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
