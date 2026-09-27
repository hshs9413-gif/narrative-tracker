export function NarrativeTimelineSkeleton() {
  return (
    <section className="space-y-3">
      <div className="h-3 w-32 bg-surface-raised rounded animate-pulse" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-grid bg-surface p-4 animate-pulse">
            <div className="h-4 w-3/4 bg-surface-raised rounded mb-3" />
            <div className="h-5 w-40 bg-surface-raised rounded" />
          </div>
        ))}
      </div>
    </section>
  );
}
