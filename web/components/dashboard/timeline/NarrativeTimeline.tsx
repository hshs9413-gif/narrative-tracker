"use client";

import { useNarrativeEvents } from "@/lib/hooks/use-narrative-events";
import { NarrativeEventCard } from "./NarrativeEventCard";
import { EndedNarrativeRow } from "./EndedNarrativeRow";
import { NarrativeTimelineSkeleton } from "./NarrativeTimelineSkeleton";

export function NarrativeTimeline() {
  const { data, loading, error } = useNarrativeEvents();

  if (loading) return <NarrativeTimelineSkeleton />;

  if (error || !data) {
    return (
      <div className="rounded-xl border border-credit-crisis/50 bg-surface p-6">
        <p className="text-credit-crisis text-sm">
          내러티브 이벤트를 불러오지 못했습니다{error ? ` (${error})` : ""}.
        </p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-grid bg-surface p-6">
        <p className="text-sm text-text-muted">등록된 내러티브 이벤트가 없습니다.</p>
      </div>
    );
  }

  // trigger_date desc — 최근 발화한 내러티브가 위로.
  const byDateDesc = (a: (typeof data)[number], b: (typeof data)[number]) =>
    b.trigger_date.localeCompare(a.trigger_date);

  // 살아있는(active/dormant) 것은 카드로 위에, 종료된 건 압축 목록으로 아래에 —
  // 시간순으로 다 섞으면 몇 년치 종료 이벤트 사이에서 "지금 뭐가 진행 중인가"가
  // 안 보이게 된다.
  const alive = data.filter((e) => e.status !== "ended").sort(byDateDesc);
  const ended = data.filter((e) => e.status === "ended").sort(byDateDesc);

  return (
    <section className="space-y-3">
      <h2 className="text-xs uppercase tracking-widest text-text-muted">내러티브 타임라인</h2>

      {alive.length > 0 ? (
        <div className="space-y-3">
          {alive.map((event) => (
            <NarrativeEventCard key={event.id} event={event} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-text-muted">진행 중이거나 휴면 상태인 내러티브가 없습니다.</p>
      )}

      {ended.length > 0 && (
        <details className="rounded-xl border border-grid bg-surface">
          <summary className="cursor-pointer select-none px-4 py-3 text-xs uppercase tracking-widest text-text-muted">
            종료됨 ({ended.length})
          </summary>
          <div className="divide-y divide-grid border-t border-grid">
            {ended.map((event) => (
              <EndedNarrativeRow key={event.id} event={event} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
