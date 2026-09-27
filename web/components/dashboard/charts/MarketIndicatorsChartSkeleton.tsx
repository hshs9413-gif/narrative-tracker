export function MarketIndicatorsChartSkeleton() {
  return (
    <section className="space-y-3">
      <div className="h-3 w-32 bg-surface-raised rounded animate-pulse" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-grid bg-surface p-4 animate-pulse">
            <div className="h-3 w-20 bg-surface-raised rounded mb-4" />
            <div className="h-20 w-full bg-surface-raised rounded" />
          </div>
        ))}
      </div>
    </section>
  );
}
