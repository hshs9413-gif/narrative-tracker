import type { NarrativeEvent } from "@/types/dashboard";
import { LAYER_COLOR, LAYER_LABEL, STATUS_LABEL, PHASE_LABEL, INTENSITY_DOTS, formatDate } from "@/lib/formatters";

// ended/dormant는 색을 더 얹는 대신 카드 전체를 흐리게 해서 "지금 안 중요함"을
// 한눈에 읽히게 한다 — RegimeBadge처럼 라벨마다 새 색을 만들면 레이어 색과 겹쳐 헷갈림.
const STATUS_OPACITY: Record<NarrativeEvent["status"], number> = {
  active: 1,
  dormant: 0.7,
  ended: 0.45,
};

export function NarrativeEventCard({ event }: { event: NarrativeEvent }) {
  const color = LAYER_COLOR[event.layer];

  return (
    <article
      className="rounded-xl border border-grid bg-surface p-4"
      style={{ opacity: STATUS_OPACITY[event.status] }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="font-semibold leading-snug">{event.name}</h3>
        <span className="shrink-0 text-xs text-text-muted whitespace-nowrap">
          {formatDate(event.trigger_date)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2 text-xs">
        <span
          className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5"
          style={{ color, borderColor: color }}
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: color }} />
          {LAYER_LABEL[event.layer]}
        </span>
        {event.layer_secondary && (
          <span className="text-text-muted">+ {LAYER_LABEL[event.layer_secondary]}</span>
        )}
        <span className="text-text-muted">{STATUS_LABEL[event.status]}</span>
        {event.phase && <span className="text-text-muted">· {PHASE_LABEL[event.phase]}</span>}
        <span className="text-text-muted font-mono" title={`강도: ${event.intensity}`}>
          {INTENSITY_DOTS[event.intensity]}
        </span>
      </div>

      {event.notes && <p className="text-sm text-text-muted mb-2">{event.notes}</p>}

      {event.assets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {event.assets.map((asset) => (
            <span key={asset} className="rounded bg-surface-raised px-1.5 py-0.5 text-xs text-text-muted">
              {asset}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
