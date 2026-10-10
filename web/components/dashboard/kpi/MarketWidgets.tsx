"use client";

import { useMarketSnapshot } from "@/lib/hooks/use-dashboard-data";
import { INDICATORS, type IndicatorId } from "@/lib/indicators";
import { formatDelta, statusOf } from "@/lib/freshness";
import { monthDay } from "@/lib/brief";
import { Sparkline } from "@/components/brief/Sparkline";
import type { MarketSnapshotRow } from "@/types/dashboard";

// 위험지표 → 금리 → 달러 → 원자재 순. DataStatus도 이 목록으로 지표별 기준일을 확인한다.
export const WIDGETS: { id: IndicatorId }[] = [
  { id: "vix" }, { id: "hy_oas" }, { id: "us10y" }, { id: "fedrate" },
  { id: "dxy_ice" }, { id: "dxy_broad" }, { id: "gold" }, { id: "wti" },
];

const SPARK_POINTS = 60;

function Figure({ rows, id }: { rows: MarketSnapshotRow[]; id: IndicatorId }) {
  const ind = INDICATORS[id];
  const status = statusOf(rows, ind);
  const delta = status ? formatDelta(ind, status) : null;
  const values = rows.slice(-SPARK_POINTS).map((r) => ind.value(r));
  return (
    <div className="nt-fig" title={ind.description}>
      <p className="nt-fig-label">{ind.label}</p>
      {status ? (
        <>
          <p className="nt-fig-value tnum">{ind.format(status.latest.value)}</p>
          <p className="nt-fig-meta">
            {delta && <span className="tnum" data-dir={status.change ? Math.sign(status.change) : 0}>{delta}</span>} {monthDay(status.latest.date)}
            {status.lagDays > 2 && `, ${status.lagDays}일 늦음`}
            {status.jump && <span className="nt-flag">급변</span>}
          </p>
          <Sparkline values={values} stepped={ind.stepped} width={150} height={30} label={`${ind.label} 최근 ${SPARK_POINTS}개 관측`} />
        </>
      ) : (
        <p className="nt-fig-meta">데이터 없음</p>
      )}
    </div>
  );
}

/** 시장 지표 한눈에 — 값, 직전 대비, 기준일, 최근 흐름 */
export function MarketWidgets() {
  const { data, loading, error } = useMarketSnapshot();
  if (loading) return <div className="nt-skeleton" style={{ height: 180 }} />;
  if (!data?.length) return <p className="nt-empty">시장 데이터를 불러오지 못했습니다{error ? ` (${error})` : ""}.</p>;
  return (
    <div className="nt-figs">
      {WIDGETS.map(({ id }) => (
        <Figure key={id} rows={data} id={id} />
      ))}
    </div>
  );
}
