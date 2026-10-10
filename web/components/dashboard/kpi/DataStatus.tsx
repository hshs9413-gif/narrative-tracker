"use client";

import { useMarketSnapshot, useRegimeState } from "@/lib/hooks/use-dashboard-data";
import { INDICATORS } from "@/lib/indicators";
import { dataAnchor, pipelineLagDays, pmiStatus, statusOf, PMI_MAX_AGE_DAYS } from "@/lib/freshness";
import { monthDay } from "@/lib/brief";
import { WIDGETS } from "./MarketWidgets";

/** 숫자를 믿고 써도 되는지 먼저 알려야 할 때만 나타나는 안내 — 수집 중단, PMI 만료 임박, 크게 늦은 지표. */
export function DataStatus() {
  const market = useMarketSnapshot();
  const regime = useRegimeState();
  if (!market.data?.length) return null;

  const rows = market.data;
  const anchor = dataAnchor(rows)!;
  const behind = WIDGETS.map(({ id }) => ({ ind: INDICATORS[id], status: statusOf(rows, INDICATORS[id]) }))
    .filter((s) => s.status && s.status.lagDays >= 4)
    .sort((a, b) => b.status!.lagDays - a.status!.lagDays);
  const stalledDays = pipelineLagDays(anchor);
  const pmi = regime.data ? pmiStatus(regime.data.growth_inflation.pmi_as_of) : null;
  const notes: { tone: "warn" | "info"; text: string }[] = [];

  if (stalledDays > 4) notes.push({ tone: "warn", text: `수집이 ${stalledDays}일 멈춘 것 같습니다. 마지막 데이터가 ${monthDay(anchor)}입니다. Actions의 Collect Market Data 실행 기록을 확인하세요.` });
  if (pmi && (pmi.expired || pmi.soon) && regime.data) {
    notes.push({
      tone: pmi.expired ? "warn" : "info",
      text: `ISM PMI가 ${regime.data.growth_inflation.pmi_as_of?.slice(0, 7)} 지표로 ${pmi.ageDays}일 지났습니다. ${
        pmi.expired ? `${PMI_MAX_AGE_DAYS}일이 넘어 성장·물가 판정이 보류됩니다.` : `${pmi.daysLeft}일 뒤부터 성장·물가 판정이 보류됩니다.`
      } 매달 2일 이후 Gemini가 발표 기사에서 새 값을 확인합니다.`,
    });
  }
  if (behind.length) notes.push({ tone: "info", text: `값이 4일 이상 늦은 지표: ${behind.map((s) => `${s.ind.label}(${monthDay(s.status!.latest.date)})`).join(", ")}` });
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
