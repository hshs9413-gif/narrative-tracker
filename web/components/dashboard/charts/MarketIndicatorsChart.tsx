"use client";

import { useMarketSnapshot } from "@/lib/hooks/use-market-snapshot";
import { Sparkline } from "./Sparkline";
import { MarketIndicatorsChartSkeleton } from "./MarketIndicatorsChartSkeleton";
import { toBasisPoints } from "@/lib/formatters";

// RegimeCard가 보여주는 "지금" 수치들(VIX·HY OAS·2s10y·BEI) 뒤에 있는 추세를
// small multiple로 붙인다 — 스케일이 전부 달라(지수·bp·%) 한 차트에 겹치면
// dataviz 컨벤션 위반(이중 축)이라 4개 독립 카드로 분리했다.

export function MarketIndicatorsChart() {
  const { data, loading, error } = useMarketSnapshot();

  if (loading) return <MarketIndicatorsChartSkeleton />;

  if (error || !data) {
    return (
      <div className="rounded-xl border border-credit-crisis/50 bg-surface p-6">
        <p className="text-credit-crisis text-sm">
          시장 지표를 불러오지 못했습니다{error ? ` (${error})` : ""}.
        </p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-grid bg-surface p-6">
        <p className="text-sm text-text-muted">시장 지표 데이터가 없습니다.</p>
      </div>
    );
  }

  const vix = data.map((r) => ({ date: r.date, value: r.vix }));
  const hyOas = data.map((r) => ({ date: r.date, value: r.hy_oas }));
  const curve2s10y = data.map((r) => ({
    date: r.date,
    value: r.us10y !== null && r.us2y !== null ? r.us10y - r.us2y : null,
  }));
  const breakeven = data.map((r) => ({ date: r.date, value: r.breakeven10y }));

  return (
    <section className="space-y-3">
      <h2 className="text-xs uppercase tracking-widest text-text-muted">시장 지표 추이</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Sparkline title="VIX" points={vix} formatValue={(v) => v.toFixed(1)} />
        <Sparkline title="하이일드 스프레드(OAS)" points={hyOas} formatValue={toBasisPoints} />
        <Sparkline title="2s10y 스프레드" points={curve2s10y} formatValue={toBasisPoints} />
        <Sparkline title="10년 기대인플레이션(BEI)" points={breakeven} formatValue={(v) => `${v.toFixed(2)}%`} />
      </div>
    </section>
  );
}
