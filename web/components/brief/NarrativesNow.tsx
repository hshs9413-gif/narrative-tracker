"use client";

import {
  useNarrativeCandidates, useNarrativeEvents, useNarrativeHeadlines, useNarrativeLog,
} from "@/lib/hooks/use-dashboard-data";
import { ACTOR, INTENSITY_WORD, PHASE_WORD, describeChanges, monthDay, sourceName } from "@/lib/brief";
import { INTENSITY_RANK, LAYER_LABEL } from "@/lib/formatters";
import { NarrativeStrata } from "@/components/dashboard/narrative/NarrativeStrata";
import type { Headline, NarrativeEvent, NarrativeLogEntry } from "@/types/dashboard";

// 내러티브 한 곳 — 표 한 줄에 하나(이름·국면·영향·시작·실제 기사 제목), 그 아래 잠잠·정리·후보 한 줄씩,
// 1년 흐름 그림, 최근 바뀐 것 몇 줄. 예전엔 같은 내러티브가 목록·갱신 기록·매트릭스·카드·언급량 차트에 여섯 번
// 나오고 Gemini가 쓴 메모가 섞여 길고 부정확했다(10/11) — 글은 Gemini가 아니라 기사 제목 그대로 싣는다.

const DAY = 86_400_000;
const FRESH_DAYS = 7; // 이보다 오래된 기사는 '최근 기사'로 안 씀
const CHANGES = 6;
const STRUCTURAL = new Set(["status", "phase", "intensity", "merged_into"]);

const age = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

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

/** 상태·단계·강도가 바뀌었거나 새로 들어온 기록만 — 검색어 교체·메모는 화면에서 뺀다 */
function isStructural(x: NarrativeLogEntry) {
  if (x.status !== "applied" || !x.event_id) return false;
  return x.kind === "new" || Object.keys(x.changes ?? {}).some((k) => STRUCTURAL.has(k));
}

function startLabel(iso: string, asOf: string) {
  const [y, m] = iso.split("-");
  return asOf.startsWith(y) ? monthDay(iso) : `${y}년 ${Number(m)}월`;
}

function News({ h }: { h: Headline | null }) {
  if (!h) return <span className="nt-nt-none">최근 7일 기사 없음</span>;
  return (
    <>
      <a href={h.url} target="_blank" rel="noopener noreferrer">
        {h.title}
      </a>
      <small>
        {h.source} {monthDay(h.date)}
      </small>
    </>
  );
}

export function NarrativesNow() {
  const events = useNarrativeEvents();
  const log = useNarrativeLog();
  const headlines = useNarrativeHeadlines();
  const candidates = useNarrativeCandidates();
  if (!events.data) return null;

  const all = events.data;
  const names = Object.fromEntries(all.map((e) => [e.id, e.name]));
  const changes = (log.data ?? []).filter(isStructural);
  // 기준일은 데이터에서 — 렌더 중에 Date.now()를 부르지 않으려고 가장 최근 판정·기록 날짜를 쓴다
  const asOf = [...all.map((e) => e.last_review?.date ?? ""), ...(log.data ?? []).map((x) => x.date), headlines.data?.updated ?? ""]
    .sort()
    .at(-1) ?? "";

  const fresh = (h?: Headline | null) => (h && h.date && age(h.date, asOf) <= FRESH_DAYS ? h : null);
  const headlineOf = (e: NarrativeEvent) => fresh(e.headline) ?? fresh(headlines.data?.items[e.id]?.[0]);

  const order = (a: NarrativeEvent, b: NarrativeEvent) =>
    (INTENSITY_RANK[b.intensity] ?? 0) - (INTENSITY_RANK[a.intensity] ?? 0) || b.trigger_date.localeCompare(a.trigger_date);
  const active = all.filter((e) => e.status === "active").sort(order);
  const dormant = all.filter((e) => e.status === "dormant").sort(order);
  // 끝난 내러티브는 따로 한 목록 — 지운 게 아니라 옮겨 둔 것. 끝난 날은 ended_on(정리한 날), 없으면 반감기
  const endDate = (e: NarrativeEvent) => e.ended_on ?? e.half_life_date ?? e.trigger_date;
  const ended = all.filter((e) => e.status === "ended").sort((a, b) => endDate(b).localeCompare(endDate(a)));
  const cands = candidates.data ?? [];
  const recent = [...changes].reverse().slice(0, CHANGES);

  return (
    <section id="narratives" className="nt-block">
      <h2 className="nt-h2">내러티브</h2>
      <p className="nt-lede">
        지금 시장을 움직이는 이야기입니다. 국면과 영향은 Gemini가 매일 기사로 판정하고 코드가 근거를 확인해 반영합니다.
        오른쪽은 요약이 아니라 실제 기사 제목입니다.
      </p>

      <ul className="nt-nt">
        <li className="nt-nt-row nt-nt-head" aria-hidden="true">
          <span>이야기</span>
          <span>국면·영향</span>
          <span>시작</span>
          <span>최근 기사</span>
        </li>
        {active.map((e) => {
          return (
            <li key={e.id} className="nt-nt-row" data-layer={e.layer}>
              <h3 className="nt-nt-name" title={`${LAYER_LABEL[e.layer]} 층`}>
                {e.name}
              </h3>
              <span className="nt-nt-state">
                {PHASE_WORD[e.phase ?? ""] ?? "미정"} <Meter intensity={e.intensity} />
              </span>
              <span className="nt-nt-start tnum">{startLabel(e.trigger_date, asOf)}</span>
              <span className="nt-nt-news">
                <News h={headlineOf(e)} />
              </span>
            </li>
          );
        })}
      </ul>

      {(dormant.length > 0 || cands.length > 0) && (
        <dl className="nt-nt-more">
          {dormant.length > 0 && (
            <>
              <dt>잠잠</dt>
              <dd>
                {dormant.map((e) => (
                  <span key={e.id}>{e.name}</span>
                ))}
              </dd>
            </>
          )}
          {cands.length > 0 && (
            <>
              <dt>지켜보는 후보</dt>
              <dd>
                {cands.map((c) => (
                  <span key={c.key}>
                    {c.name} ({c.days_seen}일째
                    {c.evidence?.[0] && (
                      <>
                        ,{" "}
                        <a href={c.evidence[0].url} target="_blank" rel="noopener noreferrer" title={c.evidence[0].title}>
                          {sourceName(c.evidence[0])}
                        </a>
                      </>
                    )}
                    )
                  </span>
                ))}
              </dd>
            </>
          )}
        </dl>
      )}

      {ended.length > 0 && (
        <details className="nt-ended">
          <summary>
            끝난 내러티브 <span className="tnum">{ended.length}</span>
          </summary>
          <ul>
            {ended.map((e) => (
              <li key={e.id}>
                <b>{e.name}</b>
                <span className="tnum">
                  {startLabel(e.trigger_date, "")} ~ {startLabel(endDate(e), "")}, {age(e.trigger_date, endDate(e))}일
                </span>
                {e.merged_into && <span>&lsquo;{names[e.merged_into] ?? e.merged_into}&rsquo;에 합침</span>}
                {e.ended_on && <span>{monthDay(e.ended_on)} 정리</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <h3 className="nt-nt-sub">최근 1년 흐름</h3>
      <div className="nt-panel">
        <NarrativeStrata events={all} />
      </div>

      {recent.length > 0 && (
        <>
          <h3 className="nt-nt-sub">최근 바뀐 것</h3>
          <ol className="nt-nt-changes">
            {recent.map((x, i) => (
              <li key={`${x.date}-${x.event_id}-${i}`}>
                <time dateTime={x.date}>{monthDay(x.date)}</time>
                <span>
                  <b>{x.name ?? names[x.event_id ?? ""] ?? x.event_id}</b>{" "}
                  {describeChanges({ ...x, changes: Object.fromEntries(Object.entries(x.changes ?? {}).filter(([k]) => STRUCTURAL.has(k))) }, names).join(", ")}
                  <span className="nt-by">{ACTOR[x.by] ?? x.by}</span>
                  {x.evidence?.slice(0, 2).map((ev, j) => (
                    <a key={j} href={ev.url} target="_blank" rel="noopener noreferrer" title={ev.title || undefined}>
                      {sourceName(ev)}
                    </a>
                  ))}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
