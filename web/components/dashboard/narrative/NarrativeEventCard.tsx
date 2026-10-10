import type { CSSProperties } from "react";
import { CBadge, CCard, CCardBody } from "@coreui/react";
import { INTENSITY_DOTS, INTENSITY_LABEL, LAYER_COLOR, LAYER_LABEL, PHASE_LABEL, STATUS_LABEL } from "@/lib/formatters";
import type { NarrativeMetrics } from "@/lib/narrative-metrics";

const STATUS_COLOR: Record<string, "primary" | "secondary"> = { active: "primary", dormant: "secondary" };

export function NarrativeEventCard({ metrics }: { metrics: NarrativeMetrics }) {
  const { event: e, impact } = metrics;

  return (
    <CCard className="nt-event-card h-100" style={{ "--layer-color": LAYER_COLOR[e.layer] } as CSSProperties}>
      <CCardBody>
        <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
          <h3 className="h6 mb-0">{e.name}</h3>
          <CBadge color={STATUS_COLOR[e.status] ?? "light"} shape="rounded-pill" className="flex-shrink-0">
            {STATUS_LABEL[e.status] ?? e.status}
          </CBadge>
        </div>

        <div className="d-flex flex-wrap align-items-center gap-x-2 small text-body-secondary mb-2" style={{ columnGap: "0.5rem" }}>
          <span>
            {LAYER_LABEL[e.layer]}
            {e.layer_secondary && ` + ${LAYER_LABEL[e.layer_secondary]}`}
          </span>
          {e.phase && <span>· {PHASE_LABEL[e.phase] ?? e.phase}</span>}
          <span title={`강도 ${INTENSITY_LABEL[e.intensity] ?? e.intensity}`}>{INTENSITY_DOTS[e.intensity]}</span>
        </div>

        <p className="small text-body-secondary mb-2">
          {metrics.durationLabel} · {metrics.persistence}
          {impact && ` · 영향 ${impact.top.pct >= 0 ? "+" : ""}${impact.top.pct.toFixed(1)}% (${impact.top.label})`}
          <br />
          트리거 {e.trigger_date}
          {e.half_life_date && ` · 반감기 ${e.half_life_date}`}
        </p>

        {e.keywords.length > 0 && (
          <div className="d-flex flex-wrap gap-1 mb-2">
            {e.keywords.map((k) => (
              <CBadge key={k} className="bg-body-secondary text-body border fw-normal">{k}</CBadge>
            ))}
          </div>
        )}

        {e.notes && <p className="small mb-0">{e.notes}</p>}

        {e.assets.length > 0 && <p className="small text-body-secondary mt-2 mb-0">자산: {e.assets.join(" · ")}</p>}
      </CCardBody>
    </CCard>
  );
}
