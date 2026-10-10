"use client";

import { CBadge } from "@coreui/react";
import { useMarketSnapshot } from "@/lib/hooks/use-dashboard-data";
import { dataAnchor, pipelineLagDays } from "@/lib/freshness";
import { formatShortDate } from "@/lib/formatters";

// 라이트·다크 둘 다 읽히도록 테마 변수를 따라가는 클래스로 — color="light"는 다크에서도 밝은 바탕이라 글자가 안 보인다.
const QUIET = "bg-body-secondary text-body-secondary border fw-normal";

/** 헤더의 '데이터 기준일' 표시 — 수집이 멈췄으면(4일 넘게 뒤처지면) 색이 바뀐다. */
export function DataStamp() {
  const { data, loading } = useMarketSnapshot();
  const anchor = data ? dataAnchor(data) : null;

  if (loading) return <CBadge className={QUIET}>데이터 확인 중</CBadge>;
  if (!anchor) return <CBadge color="danger">데이터 없음</CBadge>;

  const lag = pipelineLagDays(anchor);
  const stalled = lag > 4;
  return (
    <CBadge color={stalled ? "warning" : undefined} textColor={stalled ? "dark" : undefined} className={stalled ? "" : QUIET} title="시장 데이터(market_snapshot.csv) 마지막 행 날짜">
      데이터 기준 {formatShortDate(anchor)}
      {stalled && ` · ${lag}일 전`}
    </CBadge>
  );
}
