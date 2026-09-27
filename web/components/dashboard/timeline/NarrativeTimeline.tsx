"use client";

import { useNarrativeEvents } from "@/lib/hooks/use-narrative-events";
import { NarrativeEventCard } from "./NarrativeEventCard";
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
  const sorted = [...data].sort((a, b) => b.trigger_date.localeCompare(a.trigger_date));

  return (
    <section className="space-y-3">
      <h2 className="text-xs uppercase tracking-widest text-text-muted">내러티브 타임라인</h2>
      <div className="space-y-3">
        {sorted.map((event) => (
          <NarrativeEventCard key={event.id} event={event} />
        ))}
      </div>
    </section>
  );
}
