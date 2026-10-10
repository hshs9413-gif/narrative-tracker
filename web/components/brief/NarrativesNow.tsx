"use client";

import { useAttention, useNarrativeEvents } from "@/lib/hooks/use-dashboard-data";
import { INTENSITY_WORD, PHASE_WORD, latestNote, monthDay } from "@/lib/brief";
import { INTENSITY_RANK, LAYER_LABEL } from "@/lib/formatters";
import { Sparkline } from "./Sparkline";
import type { AttentionRow, NarrativeEvent } from "@/types/dashboard";

function Meter({ intensity }: { intensity: string }) {
  const n = INTENSITY_RANK[intensity] ?? 0;
  return (
    <span className="nt-meter" role="img" aria-label={`시장 영향 ${INTENSITY_WORD[intensity] ?? intensity}`}>
      {[1, 2, 3].map((i) => (
        <i key={i} data-on={i <= n} />
      ))}
    </span>
  );
}

function attentionSeries(rows: AttentionRow[], id: string, days = 30) {
  return rows.filter((r) => r.event_id === id).slice(-days).map((r) => r.count);
}

function Narrative({ e, attention }: { e: NarrativeEvent; attention: AttentionRow[] }) {
  const counts = attentionSeries(attention, e.id);
  return (
    <li className="nt-narr" data-layer={e.layer}>
      <div className="nt-narr-head">
        <h3>{e.name}</h3>
        <p className="nt-narr-state">
          <span>{PHASE_WORD[e.phase ?? ""] ?? "단계 미정"}</span>
          <Meter intensity={e.intensity} />
        </p>
      </div>
      <p className="nt-narr-meta">
        {LAYER_LABEL[e.layer]} 층, {monthDay(e.trigger_date)} 시작{e.trigger_date.slice(0, 4) !== "2026" ? `(${e.trigger_date.slice(0, 4)}년)` : ""}
        {e.added_by === "gemini" && ", Gemini가 추가"}
      </p>
      <p className="nt-narr-note">{latestNote(e)}</p>
      {counts.length > 4 && (
        <div className="nt-narr-spark">
          <Sparkline values={counts} width={120} height={26} label={`${e.name} 최근 30일 기사 수`} />
          <span>기사 수 30일</span>
        </div>
      )}
    </li>
  );
}

export function NarrativesNow() {
  const events = useNarrativeEvents();
  const attention = useAttention();
  if (!events.data) return null;

  const order = (a: NarrativeEvent, b: NarrativeEvent) =>
    (INTENSITY_RANK[b.intensity] ?? 0) - (INTENSITY_RANK[a.intensity] ?? 0) || b.trigger_date.localeCompare(a.trigger_date);
  const active = events.data.filter((e) => e.status === "active").sort(order);
  const dormant = events.data.filter((e) => e.status === "dormant").sort(order);

  return (
    <section id="narratives" className="nt-block">
      <h2 className="nt-h2">지금 움직이는 내러티브</h2>
      <p className="nt-lede">
        시장 영향이 큰 순서입니다. 왼쪽 선 색은 지층(경기순환·구조테마·정치/제도)을, 막대 세 칸은 지금의 시장 영향을 뜻합니다.
        Gemini가 매일 아침 기사를 근거로 갱신합니다.
      </p>
      <ul className="nt-narr-list">
        {active.map((e) => (
          <Narrative key={e.id} e={e} attention={attention.data ?? []} />
        ))}
      </ul>
      {dormant.length > 0 && (
        <p className="nt-dormant">
          잠잠하지만 다시 불붙을 수 있는 내러티브: {dormant.map((e) => e.name).join(", ")}
        </p>
      )}
    </section>
  );
}
