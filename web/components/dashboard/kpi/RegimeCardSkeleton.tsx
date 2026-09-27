// dashboard-project 컨벤션: 로딩 중엔 빈 화면/에러 대신 스켈레톤을 보여준다.

export function RegimeCardSkeleton() {
  return (
    <div className="rounded-xl border border-grid bg-surface p-6 animate-pulse">
      <div className="h-3 w-24 bg-surface-raised rounded mb-4" />
      <div className="h-8 w-64 bg-surface-raised rounded mb-6" />
      <div className="flex gap-2 mb-6">
        <div className="h-7 w-20 bg-surface-raised rounded-full" />
        <div className="h-7 w-20 bg-surface-raised rounded-full" />
      </div>
      <div className="h-4 w-16 bg-surface-raised rounded" />
    </div>
  );
}
