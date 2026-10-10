"use client";

import {
  CBadge, CCallout, CCard, CCardBody, CCardHeader, CPlaceholder, CTable, CTableBody, CTableDataCell, CTableHead,
  CTableHeaderCell, CTableRow,
} from "@coreui/react";
import CIcon from "@coreui/icons-react";
import { cilExternalLink } from "@coreui/icons";
import { useFredCatalog, useMarketSnapshot } from "@/lib/hooks/use-dashboard-data";
import { columnLabel, formatKstShort, fredSeriesUrl, parseFredTimestamp } from "@/lib/fred";
import { formatShortDate } from "@/lib/formatters";
import type { FredCatalogEntry, FredVia, MarketSnapshotRow } from "@/types/dashboard";

// CoreUI 대시보드 하단의 표 카드 형식 — 시리즈마다 어느 경로로 받았는지, FRED 원본이 언제 갱신됐는지를 보여준다.

const VIA_BADGE: Record<FredVia, { color: string; text: string; title: string }> = {
  fred_api: { color: "success", text: "FRED API", title: "FRED 공식 API(api.stlouisfed.org)로 받음" },
  fdr: { color: "secondary", text: "fdr", title: "FinanceDataReader(fredgraph.csv)로 받음 — 키가 없거나 API 호출이 실패해 대체 경로를 씀" },
  failed: { color: "danger", text: "실패", title: "이번 수집에서 두 경로 모두 실패 — 기존 값 유지" },
};

function KeySetup() {
  return (
    <ol className="small mb-0 ps-3">
      <li>
        <a href="https://fredaccount.stlouisfed.org/apikeys" target="_blank" rel="noopener noreferrer">fredaccount.stlouisfed.org/apikeys</a>
        에서 무료 API 키 발급 (32자리)
      </li>
      <li>저장소 <strong>Settings → Secrets and variables → Actions → New repository secret</strong> — 이름 <code>FRED_API_KEY</code></li>
      <li><strong>Actions → Collect Market Data → Run workflow</strong>로 바로 확인 (아니면 다음 날 07:30 KST 자동 실행)</li>
    </ol>
  );
}

/** CSV에서 그 컬럼의 마지막 값 날짜 — 메타데이터가 없을 때 '마지막 관측' 칸에 쓴다. */
function lastCsvDate(rows: MarketSnapshotRow[] | null, column: string): string | null {
  if (!rows) return null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = (rows[i] as unknown as Record<string, number | null | string>)[column];
    if (v !== null && v !== undefined && v !== "") return rows[i].date;
  }
  return null;
}

function SourceRow({ entry, rows }: { entry: FredCatalogEntry; rows: MarketSnapshotRow[] | null }) {
  const meta = entry.meta;
  const updated = parseFredTimestamp(meta?.last_updated);
  const csvDate = lastCsvDate(rows, entry.column);
  const via = entry.via ? VIA_BADGE[entry.via] : null;

  return (
    <CTableRow>
      <CTableDataCell>
        <div className="fw-semibold text-nowrap">{columnLabel(entry.column)}</div>
        <div className="small text-body-secondary"><code>{entry.column}</code></div>
      </CTableDataCell>
      <CTableDataCell>
        <a href={fredSeriesUrl(entry.id)} target="_blank" rel="noopener noreferrer" className="text-nowrap">
          {entry.id} <CIcon icon={cilExternalLink} size="sm" />
        </a>
        {meta && <div className="small text-body-secondary nt-source-title" title={meta.title}>{meta.title}</div>}
      </CTableDataCell>
      <CTableDataCell className="small">
        {meta ? (
          <>
            <div className="text-nowrap">{meta.frequency_short} · {meta.seasonal_adjustment_short}</div>
            <div className="text-body-secondary">{meta.units_short}</div>
          </>
        ) : (
          <span className="text-body-secondary">—</span>
        )}
      </CTableDataCell>
      <CTableDataCell className="small text-nowrap tnum">
        {meta?.observation_end ? formatShortDate(meta.observation_end) : csvDate ? formatShortDate(csvDate) : "—"}
        {meta?.observation_end && csvDate && csvDate < meta.observation_end && (
          <div><CBadge color="warning" textColor="dark" title={`CSV에는 ${csvDate}까지 — 다음 수집 때 채워짐`}>CSV {formatShortDate(csvDate)}</CBadge></div>
        )}
      </CTableDataCell>
      <CTableDataCell className="small text-nowrap tnum">{updated ? formatKstShort(updated) : "—"}</CTableDataCell>
      <CTableDataCell>
        {via ? <CBadge color={via.color} title={via.title}>{via.text}</CBadge> : <span className="small text-body-secondary">기록 없음</span>}
      </CTableDataCell>
    </CTableRow>
  );
}

export function FredSourcesTable() {
  const catalog = useFredCatalog();
  const market = useMarketSnapshot();

  if (catalog.loading) {
    return (
      <CCard className="mb-4">
        <CCardBody>
          <CPlaceholder animation="glow">
            <CPlaceholder xs={4} size="lg" className="d-block mb-3" />
            <CPlaceholder xs={12} style={{ height: 160 }} />
          </CPlaceholder>
        </CCardBody>
      </CCard>
    );
  }

  if (catalog.error || !catalog.data) {
    return (
      <CCallout color="info" className="mt-0">
        <strong>FRED 수집 현황 파일(fred_series.json)이 아직 없습니다.</strong>{" "}
        <span className="text-body-secondary">다음 일일 수집 때 생깁니다. FRED 시리즈를 공식 API로 받으려면 미리 키를 등록하세요:</span>
        <div className="mt-2"><KeySetup /></div>
      </CCallout>
    );
  }

  const { series, api_key_configured: keyOn, generated_at: generatedAt } = catalog.data;
  const counts = series.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.via ?? "none"]: (acc[s.via ?? "none"] ?? 0) + 1 }), {});
  const withMeta = series.filter((s) => s.meta).length;

  return (
    <>
      {!keyOn && (
        <CCallout color="warning" className="mt-0 mb-3">
          <strong>FRED_API_KEY가 설정되지 않아 FRED 시리즈를 fdr(fredgraph.csv) 경로로 받고 있습니다.</strong>{" "}
          <span className="text-body-secondary">값은 같은 FRED 원본이지만, 키를 넣으면 공식 API로 받고 시리즈 메타데이터(단위·갱신 시각)도 함께 기록합니다.</span>
          <div className="mt-2"><KeySetup /></div>
        </CCallout>
      )}
      <CCard className="mb-4">
        <CCardHeader className="d-flex flex-wrap justify-content-between align-items-center gap-2">
          <span>FRED 시리즈 {series.length}개</span>
          <span className="d-flex flex-wrap gap-1 align-items-center small">
            {(Object.keys(VIA_BADGE) as FredVia[]).filter((v) => counts[v]).map((v) => (
              <CBadge key={v} color={VIA_BADGE[v].color}>{VIA_BADGE[v].text} {counts[v]}</CBadge>
            ))}
            <span className="text-body-secondary ms-1">메타데이터 {withMeta}/{series.length} · 기록 {formatKstShort(new Date(generatedAt))}</span>
          </span>
        </CCardHeader>
        <CTable align="middle" className="mb-0" hover responsive>
          <CTableHead className="text-nowrap">
            <CTableRow>
              <CTableHeaderCell className="bg-body-tertiary">지표</CTableHeaderCell>
              <CTableHeaderCell className="bg-body-tertiary">FRED 시리즈</CTableHeaderCell>
              <CTableHeaderCell className="bg-body-tertiary">주기 · 단위</CTableHeaderCell>
              <CTableHeaderCell className="bg-body-tertiary">마지막 관측</CTableHeaderCell>
              <CTableHeaderCell className="bg-body-tertiary">FRED 갱신 (KST)</CTableHeaderCell>
              <CTableHeaderCell className="bg-body-tertiary">수집 경로</CTableHeaderCell>
            </CTableRow>
          </CTableHead>
          <CTableBody>
            {series.map((entry) => <SourceRow key={entry.column} entry={entry} rows={market.data} />)}
          </CTableBody>
        </CTable>
      </CCard>
    </>
  );
}
