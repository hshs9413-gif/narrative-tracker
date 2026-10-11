"use client";

import { useMarketSnapshot, useRegimeState } from "@/lib/hooks/use-dashboard-data";
import { dataAnchor, pipelineLagDays, pmiStatus } from "@/lib/freshness";
import { monthDay } from "@/lib/brief";
import type { Reading } from "@/lib/board";

const DAY = 86_400_000;

/** 숫자를 믿고 써도 되는지 먼저 알려야 할 때만 나타나는 안내 — 수집 중단, PMI가 오래됨, 크게 늦은 지표. */
export function DataStatus({ readings }: { readings: Reading[] }) {
  const market = useMarketSnapshot();
  const regime = useRegimeState();
  if (!market.data?.length) return null;

  const anchor = dataAnchor(market.data)!;
  const behind = readings
    .map((r) => ({ r, last: r.points.at(-1) }))
    .filter((x) => x.last && !x.r.row.stepped && (Date.parse(anchor) - Date.parse(x.last.date)) / DAY >= 4)
    .sort((a, b) => a.last!.date.localeCompare(b.last!.date));
  const stalledDays = pipelineLagDays(anchor);
  const gi = regime.data?.growth_inflation;
  const pmi = gi ? pmiStatus(gi.pmi_as_of) : null;
  const notes: { tone: "warn" | "info"; text: string }[] = [];

  if (stalledDays > 4) notes.push({ tone: "warn", text: `수집이 ${stalledDays}일 멈춘 것 같습니다. 마지막 데이터가 ${monthDay(anchor)}입니다. Actions의 Collect Market Data 실행 기록을 확인하세요.` });
  if (pmi?.expired && gi) notes.push({ tone: "info", text: `ISM PMI가 ${gi.pmi_as_of?.slice(0, 7)} 지표로 ${pmi.ageDays}일 지났습니다. 매달 2일 이후 Gemini가 발표 기사에서 새 값을 확인합니다.` });
  if (behind.length) notes.push({ tone: "info", text: `값이 4일 이상 늦은 지표: ${behind.map((x) => `${x.r.row.label}(${monthDay(x.last!.date)})`).join(", ")}` });
  if (!notes.length) return null;

  return (
    <div className="nt-status">
      {notes.map((n) => (
        <p key={n.text} data-tone={n.tone}>
          {n.text}
        </p>
      ))}
    </div>
  );
}
