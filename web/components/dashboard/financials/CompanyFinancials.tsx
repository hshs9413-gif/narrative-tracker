"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  CBadge, CButton, CButtonGroup, CCallout, CCard, CCardBody, CCardHeader, CCol, CForm, CFormInput, CInputGroup, CInputGroupText,
  CListGroup, CListGroupItem, CPlaceholder, CRow, CSpinner, CTable, CTableBody, CTableDataCell, CTableHead, CTableHeaderCell, CTableRow,
} from "@coreui/react";
import { CChartBar } from "@coreui/react-chartjs";
import CIcon from "@coreui/icons-react";
import { cilSearch } from "@coreui/icons";
import type { ChartData, ChartOptions } from "chart.js";
import { useAppConfig } from "@/lib/hooks/use-dashboard-data";
import { useChartTheme } from "@/lib/hooks/use-chart-theme";
import { axisUnit, bases, fmtBzno, fmtCrno, formatKrw, pct, proxyGet, ratio, yoy } from "@/lib/financials";
import type {
  AccountRow, CompanyFinancials as CompanyData, CompanyProfile, CompanySearchResponse, SummaryRow,
} from "@/types/dashboard";

// 금융위원회_기업 재무정보·기업기본정보 — 저장하지 않고 검색할 때마다 실시간 조회한다.
// API 키는 브라우저에 둘 수 없어 Apps Script 웹 앱(scripts/fsc_proxy.gs)이 대신 호출하고, 그 주소는 data/app_config.json에 있다.

const CRNO_PARAM = "crno";

function readCrnoFromUrl(): string | null {
  try {
    const v = new URLSearchParams(window.location.search).get(CRNO_PARAM);
    return v && /^\d{13}$/.test(v.replace(/\D/g, "")) ? v.replace(/\D/g, "") : null;
  } catch {
    return null;
  }
}

function writeCrnoToUrl(crno: string | null) {
  try {
    const url = new URL(window.location.href);
    if (crno) url.searchParams.set(CRNO_PARAM, crno);
    else url.searchParams.delete(CRNO_PARAM);
    window.history.replaceState(null, "", url.toString());
  } catch {
    /* 주소 갱신은 편의 기능 — 실패해도 화면은 그대로 */
  }
}

function ProxySetup() {
  return (
    <CCallout color="info" className="mt-0">
      <strong>실시간 조회용 Apps Script 웹 앱 주소가 아직 설정되지 않았습니다.</strong>
      <ol className="small mt-2 mb-0 ps-3">
        <li><a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener noreferrer">script.google.com</a>에서 새 프로젝트 → 저장소 <code>scripts/fsc_proxy.gs</code> 내용을 붙여넣고 저장</li>
        <li>프로젝트 설정 → 스크립트 속성 → <code>DATA_GO_KR_KEY</code> = 공공데이터포털 일반 인증키</li>
        <li>배포 → 새 배포 → 유형 <strong>웹 앱</strong>, 실행 <strong>나</strong>, 액세스 <strong>모든 사용자</strong> → 웹 앱 URL 복사</li>
        <li><code>docs/data/app_config.json</code>의 <code>fsc_proxy_url</code>에 그 URL을 넣기 (Claude에게 URL을 알려줘도 됨)</li>
      </ol>
    </CCallout>
  );
}

export function CompanyFinancials() {
  const cfg = useAppConfig();
  if (cfg.loading) {
    return (
      <CCard className="mb-4"><CCardBody>
        <CPlaceholder animation="glow"><CPlaceholder xs={12} style={{ height: 120 }} /></CPlaceholder>
      </CCardBody></CCard>
    );
  }
  const proxy = cfg.data?.fsc_proxy_url?.trim();
  if (!proxy) return <ProxySetup />;
  return <LiveFinancials proxy={proxy} />;
}

type SearchState =
  | { status: "idle" }
  | { status: "loading"; query: string }
  | { status: "done"; query: string; data: CompanySearchResponse }
  | { status: "error"; query: string; error: string };

function LiveFinancials({ proxy }: { proxy: string }) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  // 주소에 ?crno=가 있으면 그 기업을 바로 연다 (공유·즐겨찾기용). 이 컴포넌트는 설정 파일을 받은 뒤에만
  // 브라우저에서 그려지므로 window를 바로 읽어도 서버 렌더와 어긋나지 않는다.
  const [crno, setCrno] = useState<string | null>(readCrnoFromUrl);
  // 기업을 고르면 검색 목록은 접고 재무만 보여준다 — 목록은 '다시 보기'로 펼친다
  const [showList, setShowList] = useState(false);
  const seq = useRef(0);
  const companyRef = useRef<HTMLDivElement>(null);

  function open(next: string | null) {
    setCrno(next);
    setShowList(false);
    writeCrnoToUrl(next);
    // 목록이 접히며 위치가 바뀌므로 다음 그리기 뒤에 기업 화면 머리로 옮긴다
    requestAnimationFrame(() => companyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function run(e?: FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    const my = ++seq.current;
    setSearch({ status: "loading", query: q });
    try {
      const data = await proxyGet<CompanySearchResponse>(proxy, { action: "search", q });
      if (my !== seq.current) return;
      setSearch({ status: "done", query: q, data });
      if (data.results.length === 1) open(data.results[0].crno);
      else setShowList(true);
    } catch (err) {
      if (my !== seq.current) return;
      setSearch({ status: "error", query: q, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <>
      <CCard className="mb-4">
        <CCardBody>
          <CForm onSubmit={run}>
            <CInputGroup>
              <CInputGroupText><CIcon icon={cilSearch} /></CInputGroupText>
              <CFormInput
                type="search"
                placeholder="회사명 · 사업자등록번호 · 법인등록번호"
                aria-label="기업 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <CButton type="submit" color="primary" disabled={!query.trim() || search.status === "loading"}>
                {search.status === "loading" ? <CSpinner size="sm" aria-label="검색 중" /> : "검색"}
              </CButton>
            </CInputGroup>
          </CForm>
          <div className="small text-body-secondary mt-2">
            금융위원회 공공데이터를 검색할 때마다 실시간으로 불러옵니다 (저장하지 않음 · 같은 조회는 6시간 캐시). 회사명은 일부만 써도 됩니다.
          </div>

          {search.status === "error" && (
            <CCallout color="danger" className="mt-3 mb-0">검색하지 못했습니다 — {search.error}</CCallout>
          )}
          {search.status === "done" && (showList || !crno) && <SearchResults res={search.data} selected={crno} onPick={open} />}
          {search.status === "done" && !showList && crno && search.data.results.length > 1 && (
            <div className="small text-body-secondary mt-3">
              &lsquo;{search.query}&rsquo; 검색 결과 {search.data.total}곳{" "}
              <CButton color="link" size="sm" className="p-0 align-baseline" onClick={() => setShowList(true)}>
                목록 다시 보기
              </CButton>
            </div>
          )}
        </CCardBody>
      </CCard>

      <div ref={companyRef} className="nt-scroll-anchor">
        {crno && <LiveCompany key={crno} proxy={proxy} crno={crno} />}
      </div>
    </>
  );
}

function SearchResults({ res, selected, onPick }: { res: CompanySearchResponse; selected: string | null; onPick: (c: string) => void }) {
  if (!res.results.length) {
    return (
      <CCallout color="warning" className="mt-3 mb-0">
        &lsquo;{res.query}&rsquo;로 찾은 법인이 없습니다. 회사명은 &lsquo;(주)&rsquo;를 빼고, 번호는 사업자등록번호 10자리·법인등록번호 13자리로 넣어 보세요.
      </CCallout>
    );
  }
  return (
    <>
      <div className="small text-body-secondary mt-3 mb-2">
        {res.total}곳{res.total > res.results.length ? ` 중 ${res.results.length}곳` : ""}
        {res.truncated && " · 결과가 많아 일부만 봤습니다 — 이름을 더 구체적으로"}
      </div>
      <CListGroup>
        {res.results.map((c) => (
          <CListGroupItem key={c.crno} as="button" active={c.crno === selected} onClick={() => onPick(c.crno)} className="text-start">
            <div className="d-flex flex-wrap justify-content-between gap-2">
              <span className="fw-semibold">{c.name}</span>
              <span className="small tnum">법인 {fmtCrno(c.crno)}{c.bzno && <> · 사업자 {fmtBzno(c.bzno)}</>}</span>
            </div>
            <div className="small opacity-75">
              {[c.ceo && `대표 ${c.ceo}`, c.market, c.established && `설립 ${c.established.slice(0, 4)}`, c.address].filter(Boolean).join(" · ")}
            </div>
          </CListGroupItem>
        ))}
      </CListGroup>
    </>
  );
}

function LiveCompany({ proxy, crno }: { proxy: string; crno: string }) {
  const [state, setState] = useState<{ data: CompanyData | null; error: string | null }>({ data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    proxyGet<CompanyData>(proxy, { action: "company", crno })
      .then((data) => { if (!cancelled) setState({ data, error: null }); })
      .catch((err) => { if (!cancelled) setState({ data: null, error: err instanceof Error ? err.message : String(err) }); });
    return () => { cancelled = true; };
  }, [proxy, crno]);

  if (state.error) return <CCallout color="danger" className="mt-0">{fmtCrno(crno)} 재무자료를 불러오지 못했습니다 — {state.error}</CCallout>;
  if (!state.data) {
    return (
      <CCard className="mb-4"><CCardBody>
        <div className="small text-body-secondary mb-2"><CSpinner size="sm" /> 법인 {fmtCrno(crno)} 불러오는 중…</div>
        <CPlaceholder animation="glow"><CPlaceholder xs={12} style={{ height: 300 }} /></CPlaceholder>
      </CCardBody></CCard>
    );
  }
  return <CompanyView data={state.data} />;
}

function CompanyView({ data }: { data: CompanyData }) {
  const [basis, setBasis] = useState<string | null>(null);

  if (!data.summary.length) {
    return (
      <CCard className="mb-4">
        <CCardBody>
          <h4 className="card-title mb-1">{data.name}</h4>
          <div className="small text-body-secondary tnum mb-2">
            법인등록번호 {fmtCrno(data.crno)}{data.bzno && <> · 사업자등록번호 {fmtBzno(data.bzno)}</>}
          </div>
          {data.profile && <Profile p={data.profile} />}
          <CCallout color="warning" className="mb-0">
            금융위원회 재무정보에 이 법인의 재무제표가 없습니다 — 외부감사 대상·공시 법인 위주로 제공되는 자료입니다.
          </CCallout>
        </CCardBody>
      </CCard>
    );
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
            <CCol md={5} className="d-flex justify-content-md-end align-self-start">
              <CButtonGroup role="group" aria-label="연결·별도">
                {options.map((o) => (
                  <CButton key={o} color="outline-secondary" active={o === b} aria-pressed={o === b} onClick={() => setBasis(o)}>
                    {o}
                  </CButton>
                ))}
              </CButtonGroup>
            </CCol>
          </CRow>
          {data.profile && <Profile p={data.profile} />}
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
        출처: {data.source} · 조회 {new Date(data.fetched_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · 금액 단위 원(조·억으로 줄여 표시)
      </p>
    </>
  );
}

const ymd = (v: string | null) => (v && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}.${v.slice(4, 6)}.${v.slice(6)}` : v);

/** 기업기본정보 개요 — 값이 있는 항목만 */
function Profile({ p }: { p: CompanyProfile }) {
  const listed = p.krx_listed ? `유가증권 ${ymd(p.krx_listed)}` : p.kosdaq_listed ? `코스닥 ${ymd(p.kosdaq_listed)}` : null;
  const items: [string, string | null][] = [
    ["대표자", p.ceo],
    ["설립일", ymd(p.established)],
    ["업종", p.industry],
    ["주요사업", p.main_business],
    ["시장 · 상장", [p.market, listed].filter(Boolean).join(" · ") || null],
    ["종업원", p.employees ? `${p.employees.toLocaleString("ko-KR")}명` : null],
    ["결산월", p.fiscal_month ? `${Number(p.fiscal_month)}월` : null],
    ["중소기업", p.sme === "Y" ? "예" : p.sme === "N" ? "아니오" : null],
    ["감사인 · 의견", [p.auditor, p.audit_opinion].filter(Boolean).join(" · ") || null],
    ["주소", [p.address, p.address_detail].filter(Boolean).join(" ") || null],
  ];
  const shown = items.filter(([, v]) => v);
  if (!shown.length && !p.homepage) return null;
  const href = p.homepage ? (/^https?:\/\//.test(p.homepage) ? p.homepage : `http://${p.homepage}`) : null;
  return (
    <dl className="row small mb-0 mt-3 pt-3 border-top nt-profile">
      {shown.map(([k, v]) => (
        <div key={k} className="col-12 col-sm-6 col-xl-4 d-flex gap-2 mb-1">
          <dt className="text-body-secondary fw-normal text-nowrap">{k}</dt>
          <dd className="mb-0">{v}</dd>
        </div>
      ))}
      {href && (
        <div className="col-12 col-sm-6 col-xl-4 d-flex gap-2 mb-1">
          <dt className="text-body-secondary fw-normal">홈페이지</dt>
          <dd className="mb-0 text-truncate"><a href={href} target="_blank" rel="noopener noreferrer">{p.homepage}</a></dd>
        </div>
      )}
    </dl>
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
        // 요약표·차트와 같이 왼쪽이 오래된 연도. 값이 하나도 없는 연도(전전기가 비는 경우 등)는 열을 숨긴다
        const cols = ([
          { year: y - 2, get: (i: AccountRow) => i.before_previous },
          { year: y - 1, get: (i: AccountRow) => i.previous },
          { year: y, get: (i: AccountRow) => i.current },
        ] as const).filter((c) => items.some((i) => c.get(i) !== null));
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
                      {cols.map((c) => <CTableHeaderCell key={c.year} className="bg-body-tertiary text-end tnum">{c.year}</CTableHeaderCell>)}
                    </CTableRow>
                  </CTableHead>
                  <CTableBody>
                    {items.map((i: AccountRow, n) => (
                      <CTableRow key={`${i.account_id}-${n}`}>
                        <CTableDataCell className="text-nowrap">{i.account}</CTableDataCell>
                        {cols.map((c) => <CTableDataCell key={c.year} className="text-end text-nowrap tnum">{formatKrw(c.get(i))}</CTableDataCell>)}
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
