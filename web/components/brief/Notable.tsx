"use client";

import { useMemo } from "react";
import { useKoreaSnapshot, useMarketSnapshot } from "@/lib/hooks/use-dashboard-data";
import { readBoard, formatChange, positionWords, type Reading } from "@/lib/board";
import { notability } from "@/lib/positions";
import { dataAnchor } from "@/lib/freshness";
import { monthDay } from "@/lib/brief";
import { DataStatus } from "@/components/dashboard/kpi/DataStatus";

// 첫 화면 — '오늘의 판정' 대신 평소와 다른 지표만. 규칙 판정(인플레이션 레짐·신용 평상 …)은 예측력이 없고(점수와 20일 뒤
// 코스피 수익률 상관 0.11) 10/11에는 CCC 스프레드가 3년 최고인데 '신용 평온'이라고 써서 화면에서 뺐다.
// 고르는 기준은 두 가지뿐: 최근 3년 중 상·하위 5% 안에 있거나, 4주 변화가 평소 4주 변화 폭(표준편차)의 2배를 넘거나.

const SHOW = 6;

function direction(r: Reading): string | null {
  const p = r.pos!;
  const byMove = p.z4w !== null && Math.abs(p.z4w) >= 2 && p.change4w !== null ? (p.change4w > 0 ? r.row.up : r.row.down) : null;
  const byLevel = p.pct3y >= 95 ? r.row.up : p.pct3y <= 5 ? r.row.down : null;
  return byLevel ?? byMove ?? null;
}

export function Notable() {
  const market = useMarketSnapshot();
  const korea = useKoreaSnapshot();
  const readings = useMemo(() => (market.data ? readBoard({ market: market.data, korea: korea.data ?? [] }) : []), [market.data, korea.data]);

  if (market.loading) {
    return (
      <section id="today" className="nt-hero" aria-busy="true">
        <p className="nt-hero-stamp">지표를 불러오는 중입니다</p>
        <div className="nt-skeleton nt-skeleton-verdict" />
      </section>
    );
  }
  if (!market.data?.length) {
    return (
      <section id="today" className="nt-hero">
        <h1 className="nt-verdict">시장 데이터를 불러오지 못했습니다.</h1>
        <p className="nt-hero-lede">docs/data/market_snapshot.csv가 있는지, 수집이 성공했는지 Actions에서 확인하세요.</p>
      </section>
    );
  }

  const anchor = dataAnchor(market.data);
  const notable = readings
    .filter((r) => r.pos && notability(r.pos) > 0)
    .sort((a, b) => notability(b.pos!) - notability(a.pos!))
    .slice(0, SHOW);

  return (
    <section id="today" className="nt-hero">
      <p className="nt-hero-stamp">{anchor && `${monthDay(anchor)} 미국 장 마감까지의 데이터`}</p>
      <h1 className="nt-verdict">{notable.length ? `평소와 다른 지표 ${notable.length}개` : "평소 범위를 크게 벗어난 지표가 없습니다"}</h1>

      {notable.length > 0 && (
        <ul className="nt-notable">
          {notable.map((r) => {
            const p = r.pos!;
            const chg = formatChange(r.row, p);
            const big = p.z4w !== null && Math.abs(p.z4w) >= 2;
            const dir = direction(r);
            return (
              <li key={r.row.id}>
                <span className="nt-notable-name">{r.row.label}</span>
                <span className="nt-notable-value tnum">{r.row.format(p.latest.value)}</span>
                <span className="nt-notable-why">
                  {positionWords(p)}
                  {chg && (
                    <>
                      , 4주 <b className="tnum">{chg}</b>
                      {big && ` (평소 4주 변동의 ${Math.abs(p.z4w!).toFixed(1)}배)`}
                    </>
                  )}
                  {dir && <em> — {dir} 쪽</em>}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <p className="nt-hero-lede">
        좋고 나쁨을 판정하지 않고 사실만 골랐습니다. 최근 3년 중 상·하위 5% 안에 있거나, 4주 변화가 평소 4주 변동 폭의 2배를 넘은
        지표입니다. 앞으로의 방향을 맞히는 신호가 아닙니다.
      </p>
      <DataStatus readings={readings} />
    </section>
  );
}
