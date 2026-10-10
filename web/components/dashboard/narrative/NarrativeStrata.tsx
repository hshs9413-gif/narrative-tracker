import type { CSSProperties } from "react";
import type { NarrativeEvent } from "@/types/dashboard";
import { INTENSITY_LABEL, LAYER_COLOR, LAYER_LABEL, LAYER_ORDER, STATUS_LABEL } from "@/lib/formatters";
import { dayDiff, toDate } from "@/lib/narrative-metrics";

// 기존 대시보드의 '지층 단면'을 옮긴 것 — 층별 행에 트리거일~반감기(없으면 오늘)를 막대로.
// 레이아웃은 globals.css의 .nt-strata-* 클래스, 색은 CoreUI 팔레트(--nt-*).

const WINDOW_MONTHS = 18; // 최소 표시 기간
const WINDOW_CAP = 40; // 최대 소급 — 이보다 오래된 이벤트는 좌측을 잘라 점선으로 표시

const monthsAgo = (d: Date, n: number) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() - n);
  return x;
};

const INTENSITY_OPACITY: Record<string, number> = { high: 1, mid: 0.82, low: 0.58 };

function barStyle(e: NarrativeEvent, clipped: boolean): CSSProperties {
  const color = LAYER_COLOR[e.layer];
  const style: CSSProperties = { background: color, opacity: INTENSITY_OPACITY[e.intensity] ?? 1 };
  if (e.intensity === "high") style.boxShadow = "0 0 0 1px rgba(255,255,255,.3)";
  if (e.status === "active") style.boxShadow = "inset -3px 0 0 rgba(255,255,255,.55)"; // 오늘까지 이어짐
  if (e.status === "ended") style.opacity = 0.6;
  if (e.status === "dormant") {
    style.background = "transparent";
    style.boxShadow = `inset 0 0 0 1.5px ${color}`;
  }
  if (clipped) {
    style.borderTopLeftRadius = 0;
    style.borderBottomLeftRadius = 0;
    style.borderLeft = "2px dotted var(--cui-secondary-color)";
  }
  return style;
}

export function NarrativeStrata({ events, today = new Date() }: { events: NarrativeEvent[]; today?: Date }) {
  const windowEnd = new Date(today.getTime() + 10 * 86_400_000);
  const earliest = events.reduce((min, e) => Math.min(min, toDate(e.trigger_date).getTime()), today.getTime());
  const windowStart = new Date(Math.max(+monthsAgo(today, WINDOW_CAP), Math.min(earliest, +monthsAgo(today, WINDOW_MONTHS))));
  const span = windowEnd.getTime() - windowStart.getTime();
  const pct = (d: Date) => ((d.getTime() - windowStart.getTime()) / span) * 100;

  const stepMonths = span / (30.44 * 86_400_000) > 28 ? 6 : 3;
  const ticks: { p: number; label: string }[] = [];
  const tick = new Date(Date.UTC(windowStart.getUTCFullYear(), Math.floor(windowStart.getUTCMonth() / 3) * 3, 1));
  while (tick <= windowEnd) {
    const p = pct(tick);
    if (p >= 0 && p <= 93) {
      ticks.push({ p, label: `${String(tick.getUTCFullYear()).slice(2)}.${Math.floor(tick.getUTCMonth() / 3) + 1}Q` });
    }
    tick.setUTCMonth(tick.getUTCMonth() + stepMonths);
  }
  const todayPct = pct(today);

  return (
    <div>
      <div className="nt-strata-axis tnum">
        {ticks.map((t, i) => (
          <span key={t.label} className={i % 2 ? "nt-tick-alt" : ""} style={{ left: `${t.p}%` }}>
            {t.label}
          </span>
        ))}
        {todayPct > 4 && todayPct < 97 && (
          <span className="fw-semibold text-danger" style={{ left: `${todayPct}%` }}>
            오늘
          </span>
        )}
      </div>

      {LAYER_ORDER.map((layer) => {
        const items = events
          .filter((e) => e.layer === layer)
          .filter((e) => (e.half_life_date ? toDate(e.half_life_date) : today) >= windowStart)
          .sort((a, b) => a.trigger_date.localeCompare(b.trigger_date));

        return (
          <div key={layer} className="nt-strata-layer">
            <div className="nt-strata-layer-title" style={{ "--layer-color": LAYER_COLOR[layer] } as CSSProperties}>
              {LAYER_LABEL[layer]}
            </div>
            {items.length === 0 && <p className="small text-body-secondary py-1 mb-0">기록된 이벤트 없음</p>}
            {items.map((e) => {
              const start = toDate(e.trigger_date);
              const end = e.half_life_date ? toDate(e.half_life_date) : today;
              const clipped = start < windowStart;
              const left = Math.max(pct(clipped ? windowStart : start), 0);
              const right = Math.min(pct(end > windowEnd ? windowEnd : end), 100);
              const isOver = e.status === "dormant" || e.status === "ended";
              return (
                <div key={e.id} className="nt-strata-row">
                  <div className="nt-strata-name" title={e.notes}>
                    <span className="nt-dot" style={{ background: LAYER_COLOR[layer] }} />
                    {e.name}
                    <small>{isOver ? `${dayDiff(start, end)}일간 활성` : `${dayDiff(start, today)}일차`}</small>
                  </div>
                  <div className="nt-strata-track">
                    {todayPct > 1 && todayPct < 99.5 && <span className="nt-strata-today" style={{ left: `${todayPct}%` }} />}
                    <div
                      className="nt-strata-bar"
                      style={{ left: `${left}%`, width: `${Math.max(right - left, 0.6)}%`, ...barStyle(e, clipped) }}
                      title={`${e.name} — ${STATUS_LABEL[e.status] ?? e.status} / 강도 ${INTENSITY_LABEL[e.intensity] ?? e.intensity}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      <div className="nt-strata-legend">
        {LAYER_ORDER.map((layer) => (
          <span key={layer}>
            <span className="nt-swatch" style={{ background: LAYER_COLOR[layer] }} />
            {LAYER_LABEL[layer]}
          </span>
        ))}
        <span>진하기 = 강도(상/중/하)</span>
        <span>
          <span className="nt-swatch" style={{ boxShadow: "inset 0 0 0 1.5px var(--cui-secondary-color)" }} />
          휴면
        </span>
        <span>◁ 점선 = 표시 기간 이전부터 지속</span>
      </div>
    </div>
  );
}
