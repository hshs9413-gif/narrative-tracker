"use client";

import { useMarketSnapshot } from "@/lib/hooks/use-dashboard-data";
import { INDICATORS, latestReading, type IndicatorId } from "@/lib/indicators";
import { formatShortDate } from "@/lib/formatters";

// 기존 대시보드 상단 티커와 같은 7개 지표.
const TICKER: IndicatorId[] = ["vix", "fedrate", "dxy_ice", "dxy_broad", "gold", "wti", "us10y"];

export function MarketTicker() {
  const { data, loading } = useMarketSnapshot();

  return (
    <div className="flex flex-wrap gap-x-7 gap-y-3 font-mono">
      {TICKER.map((id) => {
        const ind = INDICATORS[id];
        const reading = data ? latestReading(data, ind) : null;
        return (
          <div key={id} className="min-w-[72px] sm:min-w-[82px]" title={ind.description}>
            <div className="mb-1 font-sans text-[11px] tracking-wide text-text-muted">{ind.label}</div>
            {loading ? (
              <div className="h-6 w-14 animate-pulse rounded bg-surface-raised" />
            ) : (
              <>
                <div className="text-[17px] font-semibold sm:text-[19px]">{reading ? ind.format(reading.value) : "—"}</div>
                {reading && <div className="text-[11px] text-text-muted">{formatShortDate(reading.date)}</div>}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
