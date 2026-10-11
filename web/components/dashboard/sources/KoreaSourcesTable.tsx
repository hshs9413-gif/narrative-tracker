"use client";

import { CBadge, CCard, CCardHeader, CTable, CTableBody, CTableDataCell, CTableHead, CTableHeaderCell, CTableRow } from "@coreui/react";
import { useKoreaSeries } from "@/lib/hooks/use-dashboard-data";
import { formatShortDate } from "@/lib/formatters";

const CYCLE: Record<string, string> = { D: "일", M: "월", Q: "분기", A: "연" };

/** 한국은행 ECOS 시리즈 — 통계표·항목(코드는 수집 때 이름으로 찾은 것)·주기·단위·관측 기간 (collect_korea.py가 남긴 korea_series.json) */
export function KoreaSourcesTable() {
  const meta = useKoreaSeries();
  if (meta.loading) return null;
  if (!meta.data) {
    return (
      <p className="nt-note">
        한국은행 ECOS 시리즈 정보(korea_series.json)는 다음 수집 때 생깁니다. 키는 저장소 Secret <code>BOK_ECOS_API_KEY</code>(또는{" "}
        <code>ECOS_API_KEY</code>)에서 읽습니다.
      </p>
    );
  }
  const fetched = new Date(meta.data.fetched_at);
  return (
    <CCard className="mb-4">
      <CCardHeader className="d-flex flex-wrap justify-content-between align-items-center gap-2">
        <span>한국은행 ECOS 시리즈 {meta.data.series.length}개</span>
        <span className="small text-body-secondary">
          <CBadge color="success">ECOS API {meta.data.series.length}</CBadge>{" "}
          받은 시각 {fetched.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </span>
      </CCardHeader>
      <CTable align="middle" className="mb-0" hover responsive>
        <CTableHead className="text-nowrap">
          <CTableRow>
            <CTableHeaderCell className="bg-body-tertiary">지표</CTableHeaderCell>
            <CTableHeaderCell className="bg-body-tertiary">ECOS 통계표 · 항목</CTableHeaderCell>
            <CTableHeaderCell className="bg-body-tertiary">주기 · 단위</CTableHeaderCell>
            <CTableHeaderCell className="bg-body-tertiary">관측 기간</CTableHeaderCell>
          </CTableRow>
        </CTableHead>
        <CTableBody>
          {meta.data.series.map((s) => (
            <CTableRow key={s.column}>
              <CTableDataCell>
                <div className="fw-semibold">{s.label}</div>
                <code className="small">{s.column}</code>
              </CTableDataCell>
              <CTableDataCell className="small">
                <div>
                  {s.stat_code} {s.stat_name}
                </div>
                <div className="text-body-secondary">
                  {s.item_code} {s.item_name}
                </div>
              </CTableDataCell>
              <CTableDataCell className="small text-nowrap">
                {CYCLE[s.cycle] ?? s.cycle} · {s.unit || "—"}
              </CTableDataCell>
              <CTableDataCell className="small text-nowrap tnum">
                {formatShortDate(s.first)} ~ {formatShortDate(s.last)}
                <div className="text-body-secondary">{s.count.toLocaleString("ko-KR")}개 관측</div>
              </CTableDataCell>
            </CTableRow>
          ))}
        </CTableBody>
      </CTable>
    </CCard>
  );
}
