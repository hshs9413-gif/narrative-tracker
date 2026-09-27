"use client";

import { useNarrativeMetrics } from "@/lib/hooks/use-dashboard-data";
import { INTENSITY_RANK } from "@/lib/formatters";
import { Section } from "@/components/dashboard/Section";
import { NarrativeStrata } from "./NarrativeStrata";
import { NarrativeMatrix } from "./NarrativeMatrix";
import { NarrativeEventCard } from "./NarrativeEventCard";
import { AttentionCharts } from "./AttentionCharts";

function Placeholder({ height }: { height: string }) {
  return <div className={`animate-pulse rounded-xl border border-grid bg-surface ${height}`} />;
}

export function NarrativeSections() {
  const { metrics, loading, error } = useNarrativeMetrics();

  if (loading) {
    return (
      <>
        <Section title="지층 단면 — 내러티브 타임라인"><Placeholder height="h-64" /></Section>
        <Section title="지속기간 · 시장영향 매트릭스"><Placeholder height="h-48" /></Section>
      </>
    );
  }

  if (error || !metrics) {
    return (
      <div className="rounded-xl border border-credit-crisis/50 bg-surface p-6">
        <p className="text-sm text-credit-crisis">
          내러티브 이벤트(events.json)를 불러오지 못했습니다{error ? ` (${error})` : ""}.
        </p>
      </div>
    );
  }

  // 활성·휴면 카드는 강도 높은 순, 같으면 최근 트리거 순
  const cards = metrics
    .filter((m) => m.event.status !== "ended")
    .sort(
      (a, b) =>
        (INTENSITY_RANK[b.event.intensity] ?? 0) - (INTENSITY_RANK[a.event.intensity] ?? 0) ||
        b.event.trigger_date.localeCompare(a.event.trigger_date),
    );

  return (
    <>
      <Section title="지층 단면 — 내러티브 타임라인">
        <NarrativeStrata events={metrics.map((m) => m.event)} />
      </Section>

      <Section
        title="지속기간 · 시장영향 매트릭스"
        note={
          <>
            시장영향은 각 이벤트의 <strong>트리거일 전후 실제 자산 변동</strong>을 계산한 값입니다. 전체 시장 지표가
            아니라 이벤트별로 따로 산출하므로, 어떤 내러티브가 실제로 증시를 움직였는지 구분됩니다. 사분면은{" "}
            <strong>관심도 대비 실제 영향</strong>을 교차한 것으로, &lsquo;소음&rsquo;은 뉴스는 많지만 가격에 이미
            반영된 상태, &lsquo;저평가 리스크&rsquo;는 조용한데 자산이 움직인 상태입니다.
          </>
        }
      >
        <NarrativeMatrix metrics={metrics} />
      </Section>

      <Section title="활성 · 휴면 이벤트">
        {cards.length === 0 ? (
          <p className="text-sm text-text-muted">활성·휴면 상태인 내러티브가 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((m) => (
              <NarrativeEventCard key={m.event.id} metrics={m} />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="내러티브 언급량 (Google News 기사 수)"
        note="정점 대비 50% 아래로 내려가면 반감기, 25% 아래면 휴면 전환을 검토합니다. RSS 특성상 최대 100건에서 포화되므로 절대량보다 추이를 보세요."
      >
        <AttentionCharts metrics={metrics} />
      </Section>
    </>
  );
}
