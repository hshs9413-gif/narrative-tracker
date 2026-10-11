import type { CSSProperties } from "react";
import type { NarrativeEvent } from "@/types/dashboard";
import { INTENSITY_LABEL, LAYER_COLOR, LAYER_LABEL, LAYER_ORDER, STATUS_LABEL } from "@/lib/formatters";
import { dayDiff, toDate } from "@/lib/narrative-metrics";

// 지층 단면 — 최근 12개월만 그린다. 층마다 옅은 띠 안에 내러티브 한 줄씩, 막대 = 시작~반감기(없으면 오늘).
// 표시 기간 전에 끝난 내러티브는 그림에서 뺀다 — 끝난 것 전체는 내러티브 섹션의 '끝난 내러티브' 목록에 있다.

const WINDOW_MONTHS = 12;
const AHEAD_DAYS = 12;
const STATUS_RANK: Record<string, number> = { active: 0, dormant: 1, ended: 2 };

const addMonths = (d: Date, n: number) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
};

export function NarrativeStrata({ events, today = new Date() }: { events: NarrativeEvent[]; today?: Date }) {
  const start = addMonths(today, -WINDOW_MONTHS);
  const end = new Date(today.getTime() + AHEAD_DAYS * 86_400_000);
  const span = end.getTime() - start.getTime();
  const pct = (d: Date) => Math.min(100, Math.max(0, ((d.getTime() - start.getTime()) / span) * 100));
  const endOf = (e: NarrativeEvent) => (e.half_life_date ? toDate(e.half_life_date) : today);

  // 두 달 간격 눈금 — 매월 1일
  const ticks: { p: number; label: string }[] = [];
  const t = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  while (t < end) {
    if (t.getUTCMonth() % 2 === 0) {
      const p = pct(t);
      if (p > 3 && p < 92) ticks.push({ p, label: t.getUTCMonth() === 0 ? `${t.getUTCFullYear()}년 1월` : `${t.getUTCMonth() + 1}월` });
    }
    t.setUTCMonth(t.getUTCMonth() + 1);
  }
  const todayPct = pct(today);

  const shown = events.filter((e) => endOf(e) >= start);

  return (
    <div className="nt-s2" style={{ "--t": todayPct / 100 } as CSSProperties}>
      <div className="nt-s2-axis tnum" aria-hidden="true">
        {ticks.map((k, i) => (
          <span key={k.label} className={i % 2 ? "nt-s2-alt" : undefined} style={{ left: `${k.p}%` }}>
            {k.label}
          </span>
        ))}
        <span className="nt-s2-today-label" style={{ left: `${todayPct}%` }}>
          오늘
        </span>
      </div>

      <div className="nt-s2-body">
        {ticks.map((k) => (
          <span key={k.label} className="nt-s2-grid" style={{ "--g": k.p / 100 } as CSSProperties} aria-hidden="true" />
        ))}
      {LAYER_ORDER.map((layer) => {
        const items = shown
          .filter((e) => e.layer === layer)
          .sort((a, b) => (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3) || a.trigger_date.localeCompare(b.trigger_date));
        if (!items.length) return null;
        return (
          <section key={layer} className="nt-s2-layer" style={{ "--layer-color": LAYER_COLOR[layer] } as CSSProperties}>
            <h4 className="nt-s2-layer-name">{LAYER_LABEL[layer]}</h4>
            {items.map((e) => {
              const s = toDate(e.trigger_date);
              const f = endOf(e);
              const clipped = s < start;
              const left = pct(s);
              const width = Math.max(pct(f) - left, 0.8);
              const days = dayDiff(s, e.status === "active" ? today : f);
              return (
                <div key={e.id} className="nt-s2-row">
                  <span className="nt-s2-name" title={e.name}>
                    {e.name}
                    {clipped && <small> {s.getUTCFullYear()}년부터</small>}
                  </span>
                  <span className="nt-s2-track">
                    <i
                      className="nt-s2-bar"
                      data-status={e.status}
                      data-intensity={e.intensity}
                      data-clipped={clipped || undefined}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${e.name}: ${STATUS_LABEL[e.status] ?? e.status}, 강도 ${INTENSITY_LABEL[e.intensity] ?? e.intensity}, ${days}일`}
                    />
                  </span>
                </div>
              );
            })}
          </section>
        );
      })}
      </div>

      <p className="nt-s2-legend">
        <span><i data-status="active" data-intensity="high" />진행 중(진할수록 강함)</span>
        <span><i data-status="dormant" />잠잠</span>
        <span><i data-status="ended" />끝남</span>
      </p>
    </div>
  );
}
