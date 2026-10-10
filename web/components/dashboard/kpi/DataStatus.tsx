"use client";

import { CCallout } from "@coreui/react";
import { useMarketSnapshot, useRegimeState } from "@/lib/hooks/use-dashboard-data";
import { INDICATORS } from "@/lib/indicators";
import { dataAnchor, pipelineLagDays, pmiStatus, statusOf, PMI_MAX_AGE_DAYS } from "@/lib/freshness";
import { formatShortDate } from "@/lib/formatters";
import { WIDGETS } from "./MarketWidgets";

/** 숫자를 믿고 써도 되는 상태인지 먼저 알려주는 줄 — 기준일 범위, 수집 중단, PMI 만료 임박. */
export function DataStatus() {
  const market = useMarketSnapshot();
  const regime = useRegimeState();
  if (!market.data?.length) return null;

  const rows = market.data;
  const anchor = dataAnchor(rows)!;
  const statuses = WIDGETS.map(({ id }) => ({ id, ind: INDICATORS[id], status: statusOf(rows, INDICATORS[id]) })).filter(
    (s): s is typeof s & { status: NonNullable<typeof s.status> } => s.status !== null,
  );
  const dates = statuses.map((s) => s.status.latest.date).sort();
  const behind = statuses.filter((s) => s.status.lagDays >= 3).sort((a, b) => b.status.lagDays - a.status.lagDays);
  const stalledDays = pipelineLagDays(anchor);
  const pmi = regime.data ? pmiStatus(regime.data.growth_inflation.pmi_as_of) : null;

  return (
    <div className="mb-4">
      {stalledDays > 4 && (
        <CCallout color="danger" className="mt-0 mb-2">
          <strong>수집이 {stalledDays}일 멈춘 것으로 보입니다.</strong> 마지막 데이터가 {formatShortDate(anchor)}입니다. Actions의 Collect Market Data 실행 기록을 확인하세요.
        </CCallout>
      )}

      {pmi && (pmi.expired || pmi.soon) && regime.data && (
        <CCallout color={pmi.expired ? "danger" : "warning"} className="mt-0 mb-2">
          <strong>ISM PMI 갱신이 필요합니다.</strong> 현재 값은 {regime.data.growth_inflation.pmi_as_of?.slice(0, 7)}분으로 {pmi.ageDays}일이 지났습니다.{" "}
          {pmi.expired
            ? `${PMI_MAX_AGE_DAYS}일을 넘겨 성장·물가 판정이 '미확인'으로 바뀝니다.`
            : `${PMI_MAX_AGE_DAYS}일이 되는 ${pmi.daysLeft}일 뒤부터 성장·물가 판정이 '미확인'으로 바뀝니다.`}{" "}
          <code>docs/data/manual_inputs.json</code>에 최신 헤드라인 값을 넣어 주세요.
        </CCallout>
      )}

      <CCallout color="info" className="mt-0 mb-0">
        <strong>데이터 기준일 {formatShortDate(anchor)}</strong>
        <span className="text-body-secondary">
          {" "}· 지표별 값 날짜는 {formatShortDate(dates[0])} ~ {formatShortDate(dates[dates.length - 1])} (FRED 발표 지연 때문에 지표마다 다릅니다 — 카드의 &lsquo;기준&rsquo; 날짜 확인)
        </span>
        {behind.length > 0 && (
          <div className="small text-body-secondary mt-1">
            기준일이 3일 이상 뒤처진 지표: {behind.map((s) => `${s.ind.label} ${formatShortDate(s.status.latest.date)}`).join(" · ")}
          </div>
        )}
      </CCallout>
    </div>
  );
}
