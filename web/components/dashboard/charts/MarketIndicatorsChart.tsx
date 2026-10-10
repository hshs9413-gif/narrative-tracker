"use client";

import { useMemo, useState } from "react";
import { CBadge, CButton, CButtonGroup, CCard, CCardBody, CCol, CPlaceholder, CRow } from "@coreui/react";
import { useMarketSnapshot } from "@/lib/hooks/use-dashboard-data";
import { INDICATORS, type IndicatorId } from "@/lib/indicators";
import { formatDelta, statusOf } from "@/lib/freshness";
import { formatShortDate } from "@/lib/formatters";
import { toDate } from "@/lib/narrative-metrics";
import { TrendChart } from "./TrendChart";

// 기존의 y축 3개짜리 단일 차트는 스케일이 달라 읽기 어려워 지표별로 나눴다 — 기간 필터는 전부에 적용.

const RANGES = [
  { days: 90, label: "3개월" },
  { days: 365, label: "1년" },
  { days: 1095, label: "3년" },
  { days: 0, label: "전체" },
] as const;

type Color = "primary" | "info" | "warning" | "danger" | "success";

// 값이 한 번도 없는 지표(아직 수집 전인 새 컬럼)는 카드가 자동으로 빠지고, 그룹이 비면 그룹째 빠진다.
const GROUPS: { title: string; ids: { id: IndicatorId; color: Color }[] }[] = [
  {
    title: "시장",
    ids: [
      { id: "vix", color: "danger" }, { id: "dxy_ice", color: "info" }, { id: "gold", color: "warning" }, { id: "wti", color: "warning" },
    ],
  },
  {
    title: "금리 · 신용 · 기대인플레",
    ids: [
      { id: "fedrate", color: "primary" }, { id: "us10y", color: "primary" }, { id: "curve_2s10y", color: "primary" },
      { id: "hy_oas", color: "danger" }, { id: "breakeven10y", color: "info" },
    ],
  },
  {
    title: "원자재 선물 · 한국 시장",
    ids: [
      { id: "wti_front", color: "warning" }, { id: "brent_front", color: "warning" }, { id: "usdkrw", color: "success" }, { id: "kospi", color: "success" },
    ],
  },
  {
    title: "장기금리 · 신용 · 단기자금 (추가 수집분)",
    ids: [
      { id: "us30y", color: "primary" }, { id: "real10y", color: "primary" }, { id: "term_premium10y", color: "primary" },
      { id: "ig_oas", color: "danger" }, { id: "ccc_oas", color: "danger" }, { id: "sofr", color: "info" }, { id: "iorb", color: "info" },
    ],
  },
];

export function MarketIndicatorsChart() {
  const { data, loading, error } = useMarketSnapshot();
  const [days, setDays] = useState<number>(365);

  // 기간은 오늘이 아니라 마지막 데이터 날짜 기준 — 수집이 며칠 멈춰도 창이 비지 않게.
  const view = useMemo(() => {
    if (!data?.length || days === 0) return data ?? [];
    const cutoff = toDate(data[data.length - 1].date).getTime() - days * 86_400_000;
    const filtered = data.filter((r) => toDate(r.date).getTime() >= cutoff);
    return filtered.length >= 2 ? filtered : data;
  }, [data, days]);

  if (loading) {
    return (
      <CCard>
        <CCardBody>
          <CPlaceholder animation="glow">
            <CPlaceholder xs={3} size="lg" className="d-block mb-4" />
            <CPlaceholder xs={12} style={{ height: 180 }} />
          </CPlaceholder>
        </CCardBody>
      </CCard>
    );
  }

  if (error || !data) {
    return <CCard><CCardBody className="text-danger">시장 지표를 불러오지 못했습니다{error ? ` (${error})` : ""}.</CCardBody></CCard>;
  }
  if (data.length === 0) {
    return <CCard><CCardBody className="text-body-secondary">시장 데이터가 없습니다. Actions에서 Backfill 또는 Collect Market Data를 실행하세요.</CCardBody></CCard>;
  }

  return (
    <CCard className="mb-4">
      <CCardBody>
        <CRow className="align-items-center mb-3">
          <CCol sm={6}>
            <h4 className="card-title mb-0">정량 지표 추이</h4>
            <div className="small text-body-secondary">
              {formatShortDate(view[0].date)} ~ {formatShortDate(view[view.length - 1].date)} · 빨간 점 = 직전 관측 대비 큰 변동(급변) 지점 — 실제 급변일 수도, 수집 오류일 수도 있어 원본 확인용
            </div>
          </CCol>
          <CCol sm={6} className="mt-2 mt-sm-0 d-flex justify-content-sm-end">
            <CButtonGroup role="group" aria-label="기간">
              {RANGES.map((r) => (
                <CButton key={r.days} color="outline-secondary" active={days === r.days} aria-pressed={days === r.days} onClick={() => setDays(r.days)}>
                  {r.label}
                </CButton>
              ))}
            </CButtonGroup>
          </CCol>
        </CRow>

        {GROUPS.map((group) => {
          const items = group.ids.filter(({ id }) => view.some((r) => INDICATORS[id].value(r) !== null));
          if (!items.length) return null;
          return (
            <div key={group.title} className="mb-4">
              <h6 className="text-body-secondary mb-3">{group.title}</h6>
              <CRow xs={{ cols: 1, gutter: 3 }} md={{ cols: 2 }} xl={{ cols: 3 }}>
                {items.map(({ id, color }) => {
                  const ind = INDICATORS[id];
                  const status = statusOf(view, ind);
                  const points = view.map((r) => ({ date: r.date, value: ind.value(r) }));
                  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
                  const delta = status ? formatDelta(ind, status) : null;
                  return (
                    <CCol key={id}>
                      <CCard className="h-100">
                        <CCardBody>
                          <div className="d-flex justify-content-between align-items-start mb-2 gap-2">
                            <div className="small text-body-secondary text-uppercase fw-semibold" title={ind.description}>{ind.label}</div>
                            {status && (
                              <div className="text-end text-nowrap">
                                <span className="fs-5 fw-semibold tnum">{ind.format(status.latest.value)}</span>
                                {delta && <span className="small text-body-secondary ms-1 tnum">{delta}</span>}
                              </div>
                            )}
                          </div>
                          {status && (
                            <div className="d-flex flex-wrap gap-1 align-items-center small text-body-secondary mb-2">
                              <span>기준 {formatShortDate(status.latest.date)}</span>
                              {status.stale && <CBadge color="warning" textColor="dark">지연 {status.lagDays}일</CBadge>}
                              {status.jump && <CBadge color="danger">급변</CBadge>}
                            </div>
                          )}
                          <TrendChart
                            key={`${id}-${days}`}
                            points={points}
                            format={ind.format}
                            color={color}
                            stepped={ind.stepped}
                            jump={ind.jump}
                            ariaLabel={`${ind.label} 추이`}
                          />
                          <div className="d-flex justify-content-between small text-body-secondary mt-2">
                            <span>저 {ind.format(Math.min(...values))}</span>
                            <span>고 {ind.format(Math.max(...values))}</span>
                          </div>
                        </CCardBody>
                      </CCard>
                    </CCol>
                  );
                })}
              </CRow>
            </div>
          );
        })}
      </CCardBody>
    </CCard>
  );
}
