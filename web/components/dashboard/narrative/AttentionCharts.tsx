import { LAYER_COLOR } from "@/lib/formatters";
import type { NarrativeMetrics } from "@/lib/narrative-metrics";
import { Sparkline } from "@/components/dashboard/charts/Sparkline";

// 기존 차트는 층 색으로 겹쳐 그려 같은 층끼리 구분이 안 됐다 — 내러티브별로 나누고 판정선을 그린다.

export function AttentionCharts({ metrics }: { metrics: NarrativeMetrics[] }) {
  const tracked = metrics.filter((m) => m.event.status !== "ended" && m.attention.series.length > 0);

  if (tracked.length === 0) {
    return (
      <div className="rounded-xl border border-grid bg-surface p-6">
        <p className="text-sm text-text-muted">아직 언급량 데이터가 없습니다. Actions에서 Collect Market Data를 며칠 실행하면 쌓입니다.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tracked.map(({ event, attention }) => (
        <Sparkline
          key={event.id}
          title={event.name}
          points={attention.series.map((s) => ({ date: s.date, value: s.count }))}
          formatValue={(v) => `${Math.round(v)}건/일`}
          color={LAYER_COLOR[event.layer]}
          subtitle={attention.ratio !== null ? `정점 대비 ${Math.round(attention.ratio * 100)}%` : undefined}
          referenceLines={
            attention.peakAvg
              ? [
                  { value: attention.peakAvg * 0.5, label: "반감기 50%" },
                  { value: attention.peakAvg * 0.25, label: "휴면 25%" },
                ]
              : []
          }
        />
      ))}
    </div>
  );
}
