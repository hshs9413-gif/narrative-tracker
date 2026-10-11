"use client";

import { useAttention, useNarrativeCandidates, useNarrativeEvents } from "@/lib/hooks/use-dashboard-data";
import { ACTOR, INTENSITY_WORD, PHASE_WORD, latestNote, monthDay, sourceName } from "@/lib/brief";
import { INTENSITY_RANK, LAYER_LABEL } from "@/lib/formatters";
import { Sparkline } from "./Sparkline";
import type { AttentionRow, NarrativeCandidate, NarrativeEvent } from "@/types/dashboard";

const RECENT_ENDED_DAYS = 60;
const DAY = 86_400_000;

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

/** 마지막 판정 한 줄 — 'Gemini 10월 11일: 유지. 이유…' (판정 없이 손본 기록이면 누가 언제만) */
function Review({ e }: { e: NarrativeEvent }) {
  const r = e.last_review;
  if (!r) return null;
  return (
    <p className="nt-narr-review" data-verdict={r.verdict ?? "none"}>
      <span className="nt-narr-review-who">
        {ACTOR[r.by] ?? r.by} {monthDay(r.date)}
        {r.verdict && <b>{r.verdict}</b>}
      </span>
      {r.reason && <span>{r.reason}</span>}
    </p>
  );
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
        {e.added_by === "gemini" && `, ${monthDay(e.added_on)} Gemini가 추가`}
      </p>
      <p className="nt-narr-note">{latestNote(e)}</p>
      <Review e={e} />
      {counts.length > 4 && (
        <div className="nt-narr-spark">
          <Sparkline values={counts} width={120} height={26} label={`${e.name} 최근 30일 기사 수`} />
          <span>기사 수 30일</span>
        </div>
      )}
    </li>
  );
}

function Candidates({ items }: { items: NarrativeCandidate[] }) {
  return (
    <div className="nt-aside-block">
      <h3 className="nt-aside-h">지켜보는 후보</h3>
      <p className="nt-aside-lede">아직 기준엔 못 미치지만 Gemini가 목록 밖 주요 기사에서 찾은 주제입니다. 이틀 넘게 이어지고 근거가 쌓이면 목록에 올라갑니다.</p>
      <ul className="nt-cands">
        {items.map((c) => (
          <li key={c.key}>
            <b>{c.name}</b>
            <span className="nt-cands-days tnum">{c.days_seen}일째</span>
            {c.why && <span className="nt-cands-why">{c.why}</span>}
            {!!c.evidence?.length && (
              <span className="nt-cands-src">
                {c.evidence.slice(0, 2).map((ev, i) => (
                  <a key={i} href={ev.url} target="_blank" rel="noopener noreferrer" title={ev.title}>
                    {sourceName(ev)}
                  </a>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NarrativesNow() {
  const events = useNarrativeEvents();
  const attention = useAttention();
  const candidates = useNarrativeCandidates();
  if (!events.data) return null;

  const all = events.data;
  const names = Object.fromEntries(all.map((e) => [e.id, e.name]));
  const order = (a: NarrativeEvent, b: NarrativeEvent) =>
    (INTENSITY_RANK[b.intensity] ?? 0) - (INTENSITY_RANK[a.intensity] ?? 0) || b.trigger_date.localeCompare(a.trigger_date);
  const active = all.filter((e) => e.status === "active").sort(order);
  const dormant = all.filter((e) => e.status === "dormant").sort(order);
  // 기준일은 데이터에서 — 가장 최근 판정·종료일 (렌더 중 Date.now()를 부르지 않으려고)
  const asOf = all.reduce((m, e) => [m, e.last_review?.date ?? "", e.ended_on ?? ""].sort().at(-1) ?? m, "");
  const recentEnded = all
    .filter((e) => e.status === "ended" && e.ended_on && Date.parse(asOf) - Date.parse(e.ended_on) <= RECENT_ENDED_DAYS * DAY)
    .sort((a, b) => (b.ended_on ?? "").localeCompare(a.ended_on ?? ""));
  const cands = candidates.data ?? [];

  return (
    <section id="narratives" className="nt-block">
      <h2 className="nt-h2">지금 움직이는 내러티브</h2>
      <p className="nt-lede">
        시장 영향이 큰 순서입니다. 왼쪽 선 색은 지층(경기순환·구조테마·정치/제도)을, 막대 세 칸은 지금의 시장 영향을 뜻합니다.
        Gemini가 매일 아침 모든 내러티브를 기사로 다시 판정해 유지·강약·잠잠·종료를 정하고, 목록 밖 주요 기사에서 새 이야기를 찾습니다.
      </p>
      <ul className="nt-narr-list">
        {active.map((e) => (
          <Narrative key={e.id} e={e} attention={attention.data ?? []} />
        ))}
      </ul>

      {(dormant.length > 0 || recentEnded.length > 0 || cands.length > 0) && (
        <div className="nt-aside">
          {dormant.length > 0 && (
            <div className="nt-aside-block">
              <h3 className="nt-aside-h">잠잠한 내러티브</h3>
              <p className="nt-aside-lede">기사가 줄었지만 다시 불붙을 수 있어 지켜봅니다. 오래 잠잠하면 끝남으로 정리됩니다.</p>
              <ul className="nt-quiet">
                {dormant.map((e) => (
                  <li key={e.id}>
                    <b>{e.name}</b>
                    <span>{e.dormant_since ? `${monthDay(e.dormant_since)}부터 잠잠` : "잠잠"}</span>
                    {e.last_review?.reason && <span className="nt-quiet-why">{e.last_review.reason}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {recentEnded.length > 0 && (
            <div className="nt-aside-block">
              <h3 className="nt-aside-h">최근 정리된 내러티브</h3>
              <p className="nt-aside-lede">목록에서 뺀 것입니다. 기록은 지우지 않고 지층 단면과 과거 비교에 남깁니다.</p>
              <ul className="nt-quiet">
                {recentEnded.map((e) => (
                  <li key={e.id}>
                    <b>{e.name}</b>
                    <span>
                      {monthDay(e.ended_on)} {e.merged_into ? `'${names[e.merged_into] ?? e.merged_into}'에 합침` : "끝남"}
                    </span>
                    {e.last_review?.reason && <span className="nt-quiet-why">{e.last_review.reason}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {cands.length > 0 && <Candidates items={cands} />}
        </div>
      )}
    </section>
  );
}
