"use client";

import { useMemo, useState } from "react";
import { useMarketSnapshot } from "@/lib/hooks/use-dashboard-data";
import { INDICATORS, type IndicatorId } from "@/lib/indicators";
import { toDate } from "@/lib/narrative-metrics";
import { Sparkline } from "./Sparkline";
import { MarketIndicatorsChartSkeleton } from "./MarketIndicatorsChartSkeleton";

// 기존의 y축 3개짜리 단일 차트는 스케일이 달라 읽기 어려워 지표별로 나눴다 — 기간 필터는 전부에 적용.

const RANGES = [
  { days: 90, label: "3개월" },
  { days: 365, label: "1년" },
  { days: 1095, label: "3년" },
  { days: 0, label: "전체" },
] as const;

const GROUPS: { title: string; ids: IndicatorId[] }[] = [
  { title: "시장", ids: ["vix", "dxy_ice", "gold", "wti"] },
  { title: "금리 · 신용 · 기대인플레", ids: ["fedrate", "us10y", "curve_2s10y", "hy_oas", "breakeven10y"] },
];

export function MarketIndicatorsChart() {
  const { data, loading, error } = useMarketSnapshot();
  const [days, setDays] = useState<number>(365);

  // 기간은 오늘이 아니라 마지막 데이터 날짜 기준 — 수집이 며칠 멈춰도 창이 비지 않게.
  const view = useMemo(() => {
    if (!data?.length || days === 0) return data ?? [];
    const cutoff = toDate(data[data.length - 1].date).getTime() - days * 86_400_000;
    const filtered = data.filter((r) => toDate(r.date).getTime() >= cutoff);
    return filtered.length >= 2 ? filtered : data;
  }, [data, days]);

  if (loading) return <MarketIndicatorsChartSkeleton />;

  if (error || !data) {
    return (
      <div className="rounded-xl border border-credit-crisis/50 bg-surface p-6">
        <p className="text-sm text-credit-crisis">시장 지표를 불러오지 못했습니다{error ? ` (${error})` : ""}.</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-grid bg-surface p-6">
        <p className="text-sm text-text-muted">시장 데이터가 없습니다. Actions에서 Backfill 또는 Collect Market Data를 실행하세요.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="기간">
        {RANGES.map((r) => (
          <button
            key={r.days}
            type="button"
            aria-pressed={days === r.days}
            onClick={() => setDays(r.days)}
            className="rounded border border-grid bg-surface px-3 py-1 text-xs text-text-muted transition-colors hover:text-text-primary aria-pressed:border-text-muted aria-pressed:bg-surface-raised aria-pressed:text-text-primary"
          >
            {r.label}
          </button>
        ))}
      </div>

      {GROUPS.map((group) => (
        <div key={group.title} className="space-y-2">
          <h3 className="text-xs text-text-muted">{group.title}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.ids.map((id) => {
              const ind = INDICATORS[id];
              return (
                <Sparkline
                  key={id}
                  title={ind.label}
                  points={view.map((r) => ({ date: r.date, value: ind.value(r) }))}
                  formatValue={ind.format}
                  stepped={"stepped" in ind && ind.stepped}
                  description={ind.description}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
