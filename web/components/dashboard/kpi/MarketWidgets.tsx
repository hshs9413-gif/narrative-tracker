"use client";

import { CBadge, CCard, CCardBody, CCol, CPlaceholder, CRow, CTooltip, CWidgetStatsA } from "@coreui/react";
import CIcon from "@coreui/icons-react";
import { cilArrowBottom, cilArrowTop, cilInfo } from "@coreui/icons";
import { useMarketSnapshot } from "@/lib/hooks/use-dashboard-data";
import { INDICATORS, type IndicatorId } from "@/lib/indicators";
import { formatDelta, statusOf } from "@/lib/freshness";
import { compactSeries } from "@/lib/series";
import { formatShortDate } from "@/lib/formatters";
import { MiniSparkline } from "@/components/dashboard/charts/MiniSparkline";
import type { MarketSnapshotRow } from "@/types/dashboard";

type WidgetColor = "danger" | "primary" | "info" | "warning";

// 색은 성격별로 묶는다 — 위험지표(빨강) · 금리(보라) · 달러(파랑) · 원자재(노랑). 순서는 위→아래, 왼쪽→오른쪽.
export const WIDGETS: { id: IndicatorId; color: WidgetColor }[] = [
  { id: "vix", color: "danger" },
  { id: "us10y", color: "primary" },
  { id: "dxy_ice", color: "info" },
  { id: "gold", color: "warning" },
  { id: "hy_oas", color: "danger" },
  { id: "fedrate", color: "primary" },
  { id: "dxy_broad", color: "info" },
  { id: "wti", color: "warning" },
];

const SPARK_POINTS = 45; // 스파크라인에 그릴 최근 관측 수

function MarketWidget({ rows, id, color }: { rows: MarketSnapshotRow[]; id: IndicatorId; color: WidgetColor }) {
  const ind = INDICATORS[id];
  const status = statusOf(rows, ind);
  // 밝은 배경(info·warning)은 어두운 글자·선으로 — 흰 글자는 대비가 모자란다 (globals.css 참고)
  const darkText = color === "info" || color === "warning";
  const ink = darkText ? "rgba(8, 10, 12, 0.7)" : "rgba(255, 255, 255, 0.8)";

  const recent = rows.slice(-SPARK_POINTS);
  const series = compactSeries(recent.map((r) => ({ date: r.date, value: ind.value(r) })), ind.jump);
  const delta = status ? formatDelta(ind, status) : null;

  return (
    <CWidgetStatsA
      className={`h-100 ${darkText ? "nt-widget-dark-text" : ""}`}
      color={color}
      value={
        status ? (
          <>
            <span className="tnum">{ind.format(status.latest.value)}</span>
            {delta && (
              <span className="fs-6 fw-normal ms-md-2 d-block d-md-inline tnum">
                ({delta}
                {status.change !== null && status.change !== 0 && (
                  <>
                    {" "}
                    <CIcon icon={status.change > 0 ? cilArrowTop : cilArrowBottom} />
                  </>
                )}
                )
              </span>
            )}
          </>
        ) : (
          "—"
        )
      }
      title={
        <>
          <div>{ind.label}</div>
          <div className="nt-widget-meta mt-1 mb-2">
            {status ? (
              <>
                <span title="이 값의 기준일">기준 {formatShortDate(status.latest.date)}</span>
                {status.lagDays > 0 && <span>· {status.lagDays}일 늦음</span>}
                {status.stale && <CBadge color="dark">지연</CBadge>}
                {status.jump && (
                  <CBadge color="light" textColor="danger" title="직전 관측값 대비 큰 변동 — 원본과 대조해 보세요">
                    급변
                  </CBadge>
                )}
              </>
            ) : (
              <span>데이터 없음</span>
            )}
          </div>
        </>
      }
      action={
        <CTooltip content={ind.description} placement="bottom">
          <span role="img" aria-label={`${ind.label} 설명`} tabIndex={0} style={{ cursor: "help" }}>
            <CIcon icon={cilInfo} />
          </span>
        </CTooltip>
      }
      chart={
        status ? (
          <MiniSparkline
            labels={series.labels}
            values={series.values}
            stroke={ink}
            jumpColor={darkText ? "#b32424" : "#ffffff"}
            format={ind.format}
            stepped={ind.stepped}
            jumps={series.jumps}
            ariaLabel={`${ind.label} 최근 ${recent.length}개 관측 추이`}
          />
        ) : undefined
      }
    />
  );
}

export function MarketWidgets() {
  const { data, loading, error } = useMarketSnapshot();

  return (
    <CRow xs={{ cols: 2, gutter: 3 }} md={{ gutter: 4 }} xl={{ cols: 4 }} className="mb-4">
      {WIDGETS.map(({ id, color }) => (
        <CCol key={id}>
          {loading ? (
            <CCard className="h-100">
              <CCardBody>
                <CPlaceholder animation="glow">
                  <CPlaceholder xs={5} size="lg" className="d-block mb-2" />
                  <CPlaceholder xs={7} className="d-block mb-4" />
                  <CPlaceholder xs={12} style={{ height: 40 }} />
                </CPlaceholder>
              </CCardBody>
            </CCard>
          ) : data && data.length ? (
            <MarketWidget rows={data} id={id} color={color} />
          ) : (
            <CCard className="h-100">
              <CCardBody className="text-body-secondary small">
                {INDICATORS[id].label} — {error ? `불러오지 못했습니다 (${error})` : "데이터가 없습니다"}
              </CCardBody>
            </CCard>
          )}
        </CCol>
      ))}
    </CRow>
  );
}
