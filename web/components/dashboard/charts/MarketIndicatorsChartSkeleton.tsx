export function MarketIndicatorsChartSkeleton() {
  return (
    <div className="space-y-5">
      <div className="h-7 w-64 animate-pulse rounded bg-surface-raised" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="animate-pulse rounded-xl border border-grid bg-surface p-4">
            <div className="mb-4 h-3 w-20 rounded bg-surface-raised" />
            <div className="h-20 w-full rounded bg-surface-raised" />
          </div>
        ))}
      </div>
    </div>
  );
}
