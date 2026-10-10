"use client";

import { useState, type ReactNode } from "react";
import {
  CBadge, CButton, CButtonGroup, CCallout, CCard, CCardBody, CCardHeader, CCol, CFormInput, CInputGroup, CInputGroupText,
  CListGroup, CListGroupItem, CPlaceholder, CRow, CTable, CTableBody, CTableDataCell, CTableHead, CTableHeaderCell, CTableRow,
} from "@coreui/react";
import { CChartBar } from "@coreui/react-chartjs";
import CIcon from "@coreui/icons-react";
import { cilExternalLink, cilSearch } from "@coreui/icons";
import type { ChartData, ChartOptions } from "chart.js";
import { useCompanyFinancials, useFinancialsIndex } from "@/lib/hooks/use-dashboard-data";
import { useChartTheme } from "@/lib/hooks/use-chart-theme";
import {
  FINANCIALS_WORKFLOW_URL, axisUnit, bases, fmtBzno, fmtCrno, formatKrw, numberKind, pct, ratio, searchCompanies, yoy,
} from "@/lib/financials";
import type { AccountRow, CompanyFinancials as CompanyData, SummaryRow } from "@/types/dashboard";

// 금융위원회_기업 재무정보 — Actions(Company Financials)가 받아 둔 기업만 보여준다. API 키를 브라우저에 둘 수 없어서다.

function HowToAdd({ query }: { query?: string }) {
  const kind = query ? numberKind(query) : null;
  return (
    <div className="small">
      <a href={FINANCIALS_WORKFLOW_URL} target="_blank" rel="noopener noreferrer">
        Actions → Company Financials <CIcon icon={cilExternalLink} size="sm" />
      </a>{" "}
      → <strong>Run workflow</strong> → <code>number</code>에{" "}
      {kind === "bzno" ? <>사업자등록번호 <code>{fmtBzno(query)}</code></> : kind === "crno" ? <>법인등록번호 <code>{fmtCrno(query)}</code></> : "사업자등록번호(10자리) 또는 법인등록번호(13자리)"}
      을 넣고 실행하면 1~2분 뒤 여기에 나타납니다.
      {kind !== "crno" && <> 사업자등록번호로 찾을 때는 <code>name</code>에 회사명도 넣는 것이 확실합니다.</>}
    </div>
  );
}

export function CompanyFinancials() {
  const index = useFinancialsIndex();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  if (index.loading) {
    return (
      <CCard className="mb-4">
        <CCardBody>
          <CPlaceholder animation="glow"><CPlaceholder xs={12} style={{ height: 220 }} /></CPlaceholder>
        </CCardBody>
      </CCard>
    );
  }

  const list = index.data?.companies ?? [];
  if (!list.length) {
    return (
      <CCallout color="info" className="mt-0">
        <strong>아직 수집된 기업이 없습니다.</strong>
        <div className="mt-2"><HowToAdd /></div>
      </CCallout>
    );
  }

  const matches = searchCompanies(list, query);
  const crno = selected && list.some((c) => c.crno === selected) ? selected : list[0].crno;

  return (
    <>
      <CCard className="mb-4">
        <CCardBody>
          <CRow className="g-3 align-items-center">
            <CCol md={7}>
              <CInputGroup>
                <CInputGroupText><CIcon icon={cilSearch} /></CInputGroupText>
                <CFormInput
                  type="search"
                  placeholder="회사명 · 사업자등록번호 · 법인등록번호"
                  aria-label="기업 검색"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </CInputGroup>
            </CCol>
            <CCol md={5} className="small text-body-secondary">
              수집된 기업 {list.length}곳 · 목록에 없으면 아래 방법으로 추가
            </CCol>
          </CRow>

          {query.trim() && (
            matches.length ? (
              <CListGroup className="mt-3">
                {matches.slice(0, 8).map((c) => (
                  <CListGroupItem
                    key={c.crno}
                    as="button"
                    active={c.crno === crno}
                    onClick={() => { setSelected(c.crno); setQuery(""); }}
                    className="d-flex flex-wrap justify-content-between gap-2"
                  >
                    <span className="fw-semibold">{c.name}</span>
                    <span className="small tnum">
                      법인 {fmtCrno(c.crno)}{c.bzno && <> · 사업자 {fmtBzno(c.bzno)}</>} · {c.years[0]}~{c.years[1]}
                    </span>
                  </CListGroupItem>
                ))}
              </CListGroup>
            ) : (
              <CCallout color="warning" className="mt-3 mb-0">
                <strong>&lsquo;{query}&rsquo;와 맞는 기업이 목록에 없습니다.</strong>
                <div className="mt-1"><HowToAdd query={query} /></div>
              </CCallout>
            )
          )}

          {!query.trim() && list.length > 1 && (
            <div className="d-flex flex-wrap gap-2 mt-3">
              {list.map((c) => (
                <CButton key={c.crno} size="sm" color="secondary" variant={c.crno === crno ? undefined : "outline"} onClick={() => setSelected(c.crno)}>
                  {c.name}
                </CButton>
              ))}
            </div>
          )}

          <details className="mt-3 small text-body-secondary">
            <summary>기업 추가 방법</summary>
            <div className="mt-2"><HowToAdd /></div>
          </details>
        </CCardBody>
      </CCard>

      <CompanyView key={crno} crno={crno} />
    </>
  );
}

function CompanyView({ crno }: { crno: string }) {
  const { data, loading, error } = useCompanyFinancials(crno);
  const [basis, setBasis] = useState<string | null>(null);

  if (loading) {
    return (
      <CCard className="mb-4"><CCardBody>
        <CPlaceholder animation="glow"><CPlaceholder xs={12} style={{ height: 320 }} /></CPlaceholder>
      </CCardBody></CCard>
    );
  }
  if (error || !data) {
    return <CCallout color="danger" className="mt-0">{fmtCrno(crno)} 재무자료를 불러오지 못했습니다{error ? ` (${error})` : ""}.</CCallout>;
  }

  const options = bases(data.summary);
  const b = basis && options.includes(basis) ? basis : options[0];
  const rows = data.summary.filter((r) => r.basis === b).sort((x, y) => x.year.localeCompare(y.year));
  const latest = rows[rows.length - 1];

  return (
    <>
      <CCard className="mb-4">
        <CCardBody>
          <CRow className="align-items-center g-2">
            <CCol md={7}>
              <h4 className="card-title mb-1">{data.name}</h4>
              <div className="small text-body-secondary tnum">
                법인등록번호 {fmtCrno(data.crno)}
                {data.bzno && <> · 사업자등록번호 {fmtBzno(data.bzno)}</>}
                {latest?.as_of && <> · 최근 결산 {latest.as_of.slice(0, 4)}.{latest.as_of.slice(4, 6)}</>}
              </div>
            </CCol>
            <CCol md={5} className="d-flex justify-content-md-end">
              <CButtonGroup role="group" aria-label="연결·별도">
                {options.map((o) => (
                  <CButton key={o} color="outline-secondary" active={o === b} aria-pressed={o === b} onClick={() => setBasis(o)}>
                    {o}
                  </CButton>
                ))}
              </CButtonGroup>
            </CCol>
          </CRow>
        </CCardBody>
      </CCard>

      {rows.length > 0 && <Kpis rows={rows} />}

      <CRow className="g-4 mb-4">
        <CCol lg={6}><IncomeChart rows={rows} /></CCol>
        <CCol lg={6}><BalanceChart rows={rows} /></CCol>
      </CRow>

      <SummaryTable rows={rows} basis={b} />
      <Statements data={data} basis={b} />

      <p className="small text-body-secondary">
        출처: {data.source} · 수집 {new Date(data.fetched_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · 금액 단위 원(조·억으로 줄여 표시)
      </p>
    </>
  );
}

function Kpis({ rows }: { rows: SummaryRow[] }) {
  const cur = rows[rows.length - 1];
  const prev = rows.length > 1 ? rows[rows.length - 2] : null;
  const delta = (v: number | null) => (v === null ? null : `전년비 ${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
  const items = [
    { label: "매출액", value: formatKrw(cur.revenue), sub: delta(yoy(cur.revenue, prev?.revenue ?? null)), color: "primary" },
    {
      label: "영업이익", value: formatKrw(cur.operating_income),
      sub: `이익률 ${pct(ratio(cur.operating_income, cur.revenue))}`, color: "info",
    },
    { label: "당기순이익", value: formatKrw(cur.net_income), sub: delta(yoy(cur.net_income, prev?.net_income ?? null)), color: "success" },
    {
      label: "부채비율", value: pct(cur.debt_ratio),
      sub: prev?.debt_ratio != null && cur.debt_ratio != null ? `전년 ${pct(prev.debt_ratio)}` : null, color: "warning",
    },
  ];
  return (
    <CRow xs={{ cols: 2, gutter: 3 }} lg={{ cols: 4 }} className="mb-4">
      {items.map((k) => (
        <CCol key={k.label}>
          <CCard className={`h-100 border-top-${k.color} border-top-3`}>
            <CCardBody className="py-3">
              <div className="small text-body-secondary">{k.label} <span className="ms-1">({cur.year})</span></div>
              <div className="fs-5 fw-semibold tnum">{k.value}</div>
              {k.sub && <div className="small text-body-secondary tnum">{k.sub}</div>}
            </CCardBody>
          </CCard>
        </CCol>
      ))}
    </CRow>
  );
}

function axisFor(values: (number | null)[]) {
  const maxAbs = Math.max(0, ...values.filter((v): v is number => v !== null).map(Math.abs));
  return axisUnit(maxAbs);
}

function IncomeChart({ rows }: { rows: SummaryRow[] }) {
  const t = useChartTheme();
  const unit = axisFor(rows.flatMap((r) => [r.revenue, r.operating_income, r.net_income]));
  const scale = (v: number | null) => (v === null ? null : v / unit.div);

  const data = {
    labels: rows.map((r) => r.year),
    datasets: [
      { type: "bar" as const, label: "매출액", data: rows.map((r) => scale(r.revenue)), backgroundColor: t.color("primary"), yAxisID: "y", order: 2 },
      { type: "bar" as const, label: "영업이익", data: rows.map((r) => scale(r.operating_income)), backgroundColor: t.color("info"), yAxisID: "y", order: 2 },
      { type: "bar" as const, label: "당기순이익", data: rows.map((r) => scale(r.net_income)), backgroundColor: t.color("success"), yAxisID: "y", order: 2 },
      {
        type: "line" as const, label: "영업이익률(%)", data: rows.map((r) => ratio(r.operating_income, r.revenue)),
        borderColor: t.color("warning"), backgroundColor: t.color("warning"), yAxisID: "y1", tension: 0.2, pointRadius: 3, order: 1,
      },
    ],
  };
  return (
    <ChartCard title="손익 추이" subtitle={`막대 ${unit.label} · 선 영업이익률(%)`}>
      <CChartBar
        key={`${t.theme}-inc-${rows.length}`}
        style={{ height: 280 }}
        aria-label="연도별 매출액·영업이익·당기순이익과 영업이익률"
        role="img"
        data={data as unknown as ChartData}
        options={dualAxisOptions(t, unit.label, (v) => `${v.toFixed(0)}%`, (label, v, i) =>
          i === 3 ? `${label} ${pct(v)}` : `${label} ${formatKrw(v * unit.div)}`) as ChartOptions}
      />
    </ChartCard>
  );
}

function BalanceChart({ rows }: { rows: SummaryRow[] }) {
  const t = useChartTheme();
  const unit = axisFor(rows.flatMap((r) => [r.assets]));
  const scale = (v: number | null) => (v === null ? null : v / unit.div);
  const data = {
    labels: rows.map((r) => r.year),
    datasets: [
      { type: "bar" as const, label: "부채총계", data: rows.map((r) => scale(r.liabilities)), backgroundColor: t.color("danger"), stack: "bs", yAxisID: "y", order: 2 },
      { type: "bar" as const, label: "자본총계", data: rows.map((r) => scale(r.equity)), backgroundColor: t.color("primary"), stack: "bs", yAxisID: "y", order: 2 },
      {
        type: "line" as const, label: "부채비율(%)", data: rows.map((r) => r.debt_ratio),
        borderColor: t.color("warning"), backgroundColor: t.color("warning"), yAxisID: "y1", tension: 0.2, pointRadius: 3, order: 1,
      },
    ],
  };
  return (
    <ChartCard title="재무상태 추이" subtitle={`막대 = 자산총계(부채+자본, ${unit.label}) · 선 부채비율(%)`}>
      <CChartBar
        key={`${t.theme}-bs-${rows.length}`}
        style={{ height: 280 }}
        aria-label="연도별 부채총계·자본총계와 부채비율"
        role="img"
        data={data as unknown as ChartData}
        options={dualAxisOptions(t, unit.label, (v) => `${v.toFixed(0)}%`, (label, v, i) =>
          i === 2 ? `${label} ${pct(v)}` : `${label} ${formatKrw(v * unit.div)}`, true) as ChartOptions}
      />
    </ChartCard>
  );
}

function dualAxisOptions(
  t: ReturnType<typeof useChartTheme>, unitLabel: string, fmtRight: (v: number) => string,
  tooltipLabel: (label: string, v: number, datasetIndex: number) => string, stacked = false,
): ChartOptions<"bar"> {
  return {
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "bottom", labels: { color: t.text, boxWidth: 12, font: { size: 12 } } },
      tooltip: {
        callbacks: {
          label: (item) => (item.parsed.y === null ? "" : tooltipLabel(String(item.dataset.label), item.parsed.y, item.datasetIndex)),
        },
      },
    },
    scales: {
      x: { stacked, grid: { display: false }, border: { display: false }, ticks: { color: t.text, font: { size: 11 } } },
      y: {
        stacked, grid: { color: t.grid }, border: { display: false },
        title: { display: true, text: unitLabel, color: t.text, font: { size: 11 } },
        ticks: { color: t.text, maxTicksLimit: 6, font: { size: 11 } },
      },
      y1: {
        position: "right", grid: { display: false }, border: { display: false },
        ticks: { color: t.text, maxTicksLimit: 6, font: { size: 11 }, callback: (v) => fmtRight(Number(v)) },
      },
    },
  };
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <CCard className="h-100">
      <CCardBody>
        <h5 className="card-title mb-0">{title}</h5>
        <div className="small text-body-secondary mb-3">{subtitle}</div>
        <div style={{ height: 280 }}>{children}</div>
      </CCardBody>
    </CCard>
  );
}

const METRICS: { label: string; get: (r: SummaryRow) => string; strong?: boolean }[] = [
  { label: "매출액", get: (r) => formatKrw(r.revenue), strong: true },
  { label: "영업이익", get: (r) => formatKrw(r.operating_income), strong: true },
  { label: "영업이익률", get: (r) => pct(ratio(r.operating_income, r.revenue)) },
  { label: "당기순이익", get: (r) => formatKrw(r.net_income), strong: true },
  { label: "순이익률", get: (r) => pct(ratio(r.net_income, r.revenue)) },
  { label: "포괄손익", get: (r) => formatKrw(r.comprehensive_income) },
  { label: "자산총계", get: (r) => formatKrw(r.assets), strong: true },
  { label: "부채총계", get: (r) => formatKrw(r.liabilities) },
  { label: "자본총계", get: (r) => formatKrw(r.equity) },
  { label: "자본금", get: (r) => formatKrw(r.capital) },
  { label: "부채비율", get: (r) => pct(r.debt_ratio) },
];

function SummaryTable({ rows, basis }: { rows: SummaryRow[]; basis: string }) {
  const years = rows.slice(-8); // 화면에는 최근 8개 연도
  return (
    <CCard className="mb-4">
      <CCardHeader className="d-flex justify-content-between flex-wrap gap-2">
        <span>요약재무제표 ({basis})</span>
        <span className="small text-body-secondary">{rows.length > years.length ? `최근 ${years.length}개 연도 · 전체 ${rows[0].year}~` : ""}</span>
      </CCardHeader>
      <CTable align="middle" className="mb-0 nt-fin-table" hover responsive small>
        <CTableHead>
          <CTableRow>
            <CTableHeaderCell className="bg-body-tertiary">항목</CTableHeaderCell>
            {years.map((r) => <CTableHeaderCell key={r.year} className="bg-body-tertiary text-end tnum">{r.year}</CTableHeaderCell>)}
          </CTableRow>
        </CTableHead>
        <CTableBody>
          {METRICS.map((m) => (
            <CTableRow key={m.label}>
              <CTableDataCell className={`text-nowrap ${m.strong ? "fw-semibold" : "text-body-secondary"}`}>{m.label}</CTableDataCell>
              {years.map((r) => <CTableDataCell key={r.year} className="text-end text-nowrap tnum">{m.get(r)}</CTableDataCell>)}
            </CTableRow>
          ))}
        </CTableBody>
      </CTable>
    </CCard>
  );
}

function Statements({ data, basis }: { data: CompanyData; basis: string }) {
  const blocks = [
    { title: "재무상태표", block: data.balance_sheet },
    { title: "손익계산서", block: data.income_statement },
  ];
  return (
    <CRow className="g-4 mb-4">
      {blocks.map(({ title, block }) => {
        const items = block.items.filter((i) => i.basis === basis);
        const y = Number(block.year);
        return (
          <CCol lg={6} key={title}>
            <CCard className="h-100">
              <CCardHeader className="d-flex justify-content-between">
                <span>{title} ({basis}, {block.year} 사업연도)</span>
                {block.error && <CBadge color="warning" textColor="dark">수집 실패</CBadge>}
              </CCardHeader>
              {items.length ? (
                <CTable align="middle" className="mb-0" hover responsive small>
                  <CTableHead>
                    <CTableRow>
                      <CTableHeaderCell className="bg-body-tertiary">계정</CTableHeaderCell>
                      <CTableHeaderCell className="bg-body-tertiary text-end">{y}</CTableHeaderCell>
                      <CTableHeaderCell className="bg-body-tertiary text-end">{y - 1}</CTableHeaderCell>
                      <CTableHeaderCell className="bg-body-tertiary text-end">{y - 2}</CTableHeaderCell>
                    </CTableRow>
                  </CTableHead>
                  <CTableBody>
                    {items.map((i: AccountRow, n) => (
                      <CTableRow key={`${i.account_id}-${n}`}>
                        <CTableDataCell className="text-nowrap">{i.account}</CTableDataCell>
                        <CTableDataCell className="text-end text-nowrap tnum">{formatKrw(i.current)}</CTableDataCell>
                        <CTableDataCell className="text-end text-nowrap tnum">{formatKrw(i.previous)}</CTableDataCell>
                        <CTableDataCell className="text-end text-nowrap tnum">{formatKrw(i.before_previous)}</CTableDataCell>
                      </CTableRow>
                    ))}
                  </CTableBody>
                </CTable>
              ) : (
                <CCardBody className="small text-body-secondary">
                  {basis} 기준 계정이 없습니다{block.error ? ` (${block.error})` : ""}.
                </CCardBody>
              )}
            </CCard>
          </CCol>
        );
      })}
    </CRow>
  );
}
