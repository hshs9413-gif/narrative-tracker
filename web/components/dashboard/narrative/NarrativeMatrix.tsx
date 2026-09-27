import type { ReactNode } from "react";
import { LAYER_COLOR, LAYER_LABEL, PHASE_LABEL } from "@/lib/formatters";
import type { Impact, NarrativeMetrics, Quadrant } from "@/lib/narrative-metrics";

// 기존 대시보드의 '지속기간 · 시장영향 매트릭스' — 넓은 화면은 표, 모바일은 카드처럼 쌓인다.

const COLS = "md:grid md:grid-cols-[1.5fr_1.3fr_1.4fr_1fr_1fr] md:gap-4";
const ARCHIVE_COLS = "md:grid md:grid-cols-[1.5fr_1.3fr_1.4fr] md:gap-4";

const QUADRANT_TAG: Partial<Record<Quadrant, string>> = {
  "지배 내러티브": "bg-layer-political/20 text-signal-hot",
  "소음 (이미 반영)": "bg-text-muted/15 text-text-muted",
  "저평가 리스크": "bg-layer-structural/20 text-signal-warm",
};

const byImpact = (a: NarrativeMetrics, b: NarrativeMetrics) => (b.impact?.peak ?? 0) - (a.impact?.peak ?? 0);
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="mb-0.5 block text-[11px] text-text-muted md:hidden">{label}</span>
      {children}
    </div>
  );
}

function Bar({ width, color }: { width: number; color: string }) {
  return (
    <span className="relative mt-1.5 block h-1 rounded-sm bg-grid">
      <i className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${Math.min(width, 100)}%`, background: color }} />
    </span>
  );
}

function NameCell({ m, withPhase }: { m: NarrativeMetrics; withPhase?: boolean }) {
  const e = m.event;
  return (
    <div>
      <div className="font-semibold">
        <span className="mr-1.5 inline-block h-[7px] w-[7px] rounded-full align-middle" style={{ background: LAYER_COLOR[e.layer] }} />
        {e.name}
      </div>
      <div className="text-[11px] text-text-muted">
        {LAYER_LABEL[e.layer]}
        {withPhase && e.phase ? ` · ${PHASE_LABEL[e.phase] ?? e.phase}` : ""}
      </div>
    </div>
  );
}

function ImpactValue({ impact }: { impact: Impact }) {
  return <span className="whitespace-nowrap font-mono tabular-nums">{signed(impact.top.pct)}</span>;
}

export function NarrativeMatrix({ metrics }: { metrics: NarrativeMetrics[] }) {
  const live = metrics.filter((m) => m.event.status !== "ended").sort(byImpact);
  const archived = metrics.filter((m) => m.event.status === "ended").sort(byImpact);

  return (
    <div className="rounded-xl border border-grid bg-surface px-4 py-3 text-[13px] sm:px-5">
      {live.length === 0 ? (
        <p className="py-2 text-xs text-text-muted">활성·휴면 내러티브가 없습니다.</p>
      ) : (
        <>
          <div className={`hidden border-b border-grid pb-2 text-[11px] text-text-muted ${COLS}`}>
            <span>내러티브</span><span>지속기간</span><span>시장영향 (트리거 전후 5일)</span><span>언급량</span><span>사분면</span>
          </div>
          {live.map((m) => {
            const ratio = m.judgeSpan / m.typical;
            const longRun = ratio >= 1;
            const att = m.attention;
            return (
              <div key={m.event.id} className={`space-y-2 border-b border-grid py-3 last:border-0 md:space-y-0 ${COLS}`}>
                <NameCell m={m} withPhase />
                <Cell label="지속기간">
                  <span className="whitespace-nowrap font-mono tabular-nums">{m.durationLabel}</span>
                  <Bar width={ratio * 100} color={longRun ? "var(--color-layer-structural)" : "var(--color-text-muted)"} />
                  <span className={`text-[11px] ${longRun ? "text-signal-warm" : "text-text-muted"}`}>
                    {m.persistence} · 층 통상 {m.typical}일
                  </span>
                </Cell>
                <Cell label="시장영향">
                  {m.impact ? (
                    <>
                      <ImpactValue impact={m.impact} /> <span className="text-[11px] text-text-muted">{m.impact.top.label}</span>
                      <Bar width={m.impact.peak * 8} color={LAYER_COLOR[m.event.layer]} />
                      <span className="text-[11px] text-text-muted">{m.impact.strong}개 자산 3%+ 반응</span>
                    </>
                  ) : (
                    <span className="text-[11px] text-text-muted">트리거일 시장데이터 없음</span>
                  )}
                </Cell>
                <Cell label="언급량">
                  {att.latest !== null ? (
                    <>
                      <span className="block whitespace-nowrap font-mono tabular-nums">{att.latest}건/일</span>
                      <span className="text-[11px] text-text-muted">
                        {att.series.length >= 3 ? `정점 대비 ${Math.round((att.ratio ?? 0) * 100)}%` : `${att.series.length}일차 측정중`}
                      </span>
                    </>
                  ) : (
                    <span className="text-[11px] text-text-muted">수집 전</span>
                  )}
                </Cell>
                <Cell label="사분면">
                  <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] ${QUADRANT_TAG[m.quadrant] ?? "bg-surface-raised text-text-muted"}`}>
                    {m.quadrant}
                  </span>
                </Cell>
              </div>
            );
          })}
        </>
      )}

      {archived.length > 0 && (
        <details className="group mt-3 border-t border-grid pt-2">
          <summary className="cursor-pointer select-none py-2 text-xs text-text-muted hover:text-text-primary">
            종료된 내러티브 {archived.length}건 — 과거 영향 기록 보기
          </summary>
          {archived.map((m) => (
            <div key={m.event.id} className={`space-y-2 border-b border-grid py-3 opacity-85 last:border-0 md:space-y-0 ${ARCHIVE_COLS}`}>
              <NameCell m={m} />
              <Cell label="활성기간">
                <span className="block font-mono tabular-nums">{m.activeSpan}일</span>
                <span className="text-[11px] text-text-muted">
                  {m.event.trigger_date} ~ {m.event.half_life_date ?? ""}
                </span>
              </Cell>
              <Cell label="시장영향">
                {m.impact ? (
                  <>
                    <ImpactValue impact={m.impact} />
                    <span className="block text-[11px] text-text-muted">
                      {m.impact.top.label} · {m.impact.strong}개 자산 3%+
                    </span>
                  </>
                ) : (
                  <span className="text-[11px] text-text-muted">—</span>
                )}
              </Cell>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
