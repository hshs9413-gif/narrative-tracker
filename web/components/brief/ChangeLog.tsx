"use client";

import { useNarrativeEvents, useNarrativeLog } from "@/lib/hooks/use-dashboard-data";
import { ACTOR, describeChanges, monthDay, sourceName } from "@/lib/brief";
import type { NarrativeLogEntry } from "@/types/dashboard";

const SHOW = 12;

function Entry({ x, names }: { x: NarrativeLogEntry; names: Record<string, string> }) {
  const subject = x.kind === "pmi" ? "ISM 제조업 PMI" : x.name ?? (x.event_id ? names[x.event_id] ?? x.event_id : "");
  return (
    <li className="nt-log-item" data-by={x.by}>
      <p className="nt-log-when">
        <time dateTime={x.date}>{monthDay(x.date)}</time>
        <span className="nt-log-by">{ACTOR[x.by] ?? x.by}</span>
      </p>
      <div className="nt-log-body">
        <p className="nt-log-what">
          <b>{subject}</b> {describeChanges(x).join(", ")}
        </p>
        {x.reason && <p className="nt-log-why">{x.reason}</p>}
        {!!x.evidence?.length && (
          <p className="nt-log-src">
            근거{" "}
            {x.evidence.slice(0, 3).map((ev, i) => (
              <a key={i} href={ev.url} target="_blank" rel="noopener noreferrer" title={ev.title || undefined}>
                {sourceName(ev)}
              </a>
            ))}
          </p>
        )}
      </div>
    </li>
  );
}

export function ChangeLog() {
  const log = useNarrativeLog();
  const events = useNarrativeEvents();
  const all = log.data ?? [];
  const names = Object.fromEntries((events.data ?? []).map((e) => [e.id, e.name]));
  const applied = all.filter((x) => x.status === "applied").reverse();
  const rejected = all.filter((x) => x.status === "rejected").reverse();
  const summary = [...all].reverse().find((x) => x.kind === "summary");

  return (
    <section id="log" className="nt-block">
      <h2 className="nt-h2">갱신 기록</h2>
      <p className="nt-lede">
        내러티브 목록을 누가, 무엇을 근거로 바꿨는지입니다. Gemini 제안은 코드가 근거 기사 수·매체 수·변경 폭을 검사해 통과한 것만 반영합니다.
      </p>
      {summary && (
        <blockquote className="nt-log-summary">
          <p>{summary.reason}</p>
          <footer>
            {ACTOR[summary.by] ?? summary.by}, {monthDay(summary.date)}
          </footer>
        </blockquote>
      )}
      {log.loading ? null : applied.length === 0 ? (
        <p className="nt-empty">아직 기록이 없습니다. 매일 07:30 수집 때 Gemini가 처음 검토하면 여기에 쌓입니다.</p>
      ) : (
        <ol className="nt-log">
          {applied.slice(0, SHOW).map((x, i) => (
            <Entry key={`${x.date}-${x.event_id ?? x.kind}-${i}`} x={x} names={names} />
          ))}
        </ol>
      )}
      {rejected.length > 0 && (
        <details className="nt-log-rejected">
          <summary>반영하지 않은 제안 {rejected.length}건</summary>
          <ul>
            {rejected.slice(0, 20).map((x, i) => (
              <li key={i}>
                {monthDay(x.date)} {x.kind === "pmi" ? "PMI" : x.name ?? names[x.event_id ?? ""] ?? x.event_id}: {x.reject_reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
