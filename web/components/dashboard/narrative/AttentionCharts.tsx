import { CCard, CCardBody, CCol, CRow } from "@coreui/react";
import { LAYER_COLOR_NAME, formatShortDate } from "@/lib/formatters";
import type { NarrativeMetrics } from "@/lib/narrative-metrics";
import { TrendChart } from "@/components/dashboard/charts/TrendChart";

const count = (v: number) => `${Math.round(v)}건/일`;

// 기존 차트는 층 색으로 겹쳐 그려 같은 층끼리 구분이 안 됐다 — 내러티브별로 나누고 판정선을 그린다.

export function AttentionCharts({ metrics }: { metrics: NarrativeMetrics[] }) {
  const tracked = metrics.filter((m) => m.event.status !== "ended" && m.attention.series.length > 0);

  if (tracked.length === 0) {
    return (
      <CCard>
        <CCardBody className="text-body-secondary">아직 언급량 데이터가 없습니다. Actions에서 Collect Market Data를 며칠 실행하면 쌓입니다.</CCardBody>
      </CCard>
    );
  }

  return (
    <CRow xs={{ cols: 1, gutter: 3 }} md={{ cols: 2 }} xl={{ cols: 3 }}>
      {tracked.map(({ event, attention }) => {
        const last = attention.series[attention.series.length - 1];
        const values = attention.series.map((s) => s.count);
        return (
          <CCol key={event.id}>
            <CCard className="h-100">
              <CCardBody>
                <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
                  <div className="small fw-semibold">{event.name}</div>
                  <div className="text-end text-nowrap">
                    <span className="fs-5 fw-semibold tnum">{count(last.count)}</span>
                    {attention.ratio !== null && <span className="small text-body-secondary ms-1">정점 대비 {Math.round(attention.ratio * 100)}%</span>}
                  </div>
                </div>
                <TrendChart
                  points={attention.series.map((s) => ({ date: s.date, value: s.count }))}
                  format={count}
                  color={LAYER_COLOR_NAME[event.layer]}
                  references={
                    attention.peakAvg
                      ? [
                          { value: attention.peakAvg * 0.5, label: "반감기 50%" },
                          { value: attention.peakAvg * 0.25, label: "휴면 25%" },
                        ]
                      : []
                  }
                  height={170}
                  ariaLabel={`${event.name} 뉴스 언급량(7일 평균) 추이`}
                />
                <div className="d-flex justify-content-between small text-body-secondary mt-2">
                  <span>{formatShortDate(attention.series[0].date)} ~ {formatShortDate(last.date)}</span>
                  <span>저 {count(Math.min(...values))} · 고 {count(Math.max(...values))}</span>
                </div>
              </CCardBody>
            </CCard>
          </CCol>
        );
      })}
    </CRow>
  );
}
