import { INTENSITY_DOTS, INTENSITY_LABEL, LAYER_COLOR, LAYER_LABEL, PHASE_LABEL, STATUS_LABEL } from "@/lib/formatters";
import type { NarrativeMetrics } from "@/lib/narrative-metrics";

const STATUS_BADGE: Record<string, string> = {
  active: "bg-layer-political/20 text-signal-hot",
  dormant: "bg-text-muted/20 text-text-muted",
};

export function NarrativeEventCard({ metrics }: { metrics: NarrativeMetrics }) {
  const { event: e, impact } = metrics;

  return (
    <article
      className="rounded-xl border border-l-[3px] border-grid bg-surface p-4"
      style={{ borderLeftColor: LAYER_COLOR[e.layer] }}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="break-words font-semibold leading-snug">{e.name}</h3>
        <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] ${STATUS_BADGE[e.status] ?? "bg-surface-raised text-text-muted"}`}>
          {STATUS_LABEL[e.status] ?? e.status}
        </span>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
        <span>{LAYER_LABEL[e.layer]}{e.layer_secondary && ` + ${LAYER_LABEL[e.layer_secondary]}`}</span>
        {e.phase && <span>· {PHASE_LABEL[e.phase] ?? e.phase}</span>}
        <span className="font-mono" title={`강도 ${INTENSITY_LABEL[e.intensity] ?? e.intensity}`}>
          {INTENSITY_DOTS[e.intensity]}
        </span>
      </div>

      <p className="mb-2.5 text-xs leading-relaxed text-text-muted">
        {metrics.durationLabel} · {metrics.persistence}
        {impact && ` · 영향 ${impact.top.pct >= 0 ? "+" : ""}${impact.top.pct.toFixed(1)}% (${impact.top.label})`}
        <br />
        트리거 {e.trigger_date}
        {e.half_life_date && ` · 반감기 ${e.half_life_date}`}
      </p>

      {e.keywords.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {e.keywords.map((k) => (
            <span key={k} className="rounded bg-surface-raised px-2 py-0.5 text-[11px]">{k}</span>
          ))}
        </div>
      )}

      {e.notes && <p className="text-[12.5px] leading-relaxed text-text-muted">{e.notes}</p>}

      {e.assets.length > 0 && (
        <p className="mt-2 text-[11px] text-text-muted">자산: {e.assets.join(" · ")}</p>
      )}
    </article>
  );
}
