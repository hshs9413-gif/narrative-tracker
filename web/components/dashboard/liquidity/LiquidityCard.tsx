"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  CBadge, CButton, CButtonGroup, CCard, CCardBody, CCardFooter, CCol, CPlaceholder, CProgress, CRow, CTooltip,
} from "@coreui/react";
import { CChartLine } from "@coreui/react-chartjs";
import type { ChartData, ChartOptions } from "chart.js";
import { useFredCatalog, useMarketSnapshot } from "@/lib/hooks/use-dashboard-data";
import { useChartTheme } from "@/lib/hooks/use-chart-theme";
import { withAlpha } from "@/lib/chart-utils";
import { formatShortDate } from "@/lib/formatters";
import { toDate } from "@/lib/narrative-metrics";
import {
  LIQUIDITY_KEYS, LIQUIDITY_SERIES, formatTrillionAxis, formatUsdBn, formatUsdBnDelta, latestWithChange, liquidityRows,
  resolveUnits, type LiquidityField, type LiquidityKey, type UnitResolution,
} from "@/lib/liquidity";

// CoreUI 대시보드의 메인 차트 카드(큰 라인 차트 + 기간 버튼 + 하단 진행바 통계)를 그대로 따른다.

const RANGES = [
  { days: 90, label: "3개월" },
  { days: 365, label: "1년" },
  { days: 1095, label: "3년" },
  { days: 0, label: "전체" },
] as const;

interface Line {
  field: LiquidityField;
  label: string;
  color: string;
  /** 처음엔 숨겨 두고 범례를 눌러 켠다 — 규모가 작아 축을 같이 쓰면 바닥에 붙는 시리즈 */
  hidden?: boolean;
  fill?: boolean;
  dash?: number[];
}

const LINES: Line[] = [
  { field: "fed_assets", label: "총자산", color: "primary" },
  { field: "net", label: "순유동성", color: "success", fill: true },
  { field: "reserves", label: "지급준비금", color: "info" },
  { field: "tga", label: "TGA", color: "warning", hidden: true, dash: [6, 4] },
  { field: "rrp", label: "역레포", color: "danger", hidden: true, dash: [2, 3] },
];

const FOOTER: { field: LiquidityField; label: string; color: string; hint: string }[] = [
  { field: "fed_assets", label: "연준 총자산", color: "primary", hint: LIQUIDITY_SERIES.fed_assets.description },
  { field: "reserves", label: "지급준비금", color: "info", hint: LIQUIDITY_SERIES.reserves.description },
  { field: "tga", label: "재무부 TGA", color: "warning", hint: LIQUIDITY_SERIES.tga.description },
  { field: "rrp", label: "역레포", color: "danger", hint: LIQUIDITY_SERIES.rrp.description },
  { field: "net", label: "순유동성", color: "success", hint: "총자산 − TGA − 역레포. 세 값이 모두 있는 날만 계산" },
];

function Shell({ children }: { children: ReactNode }) {
  return <CCard className="mb-4"><CCardBody>{children}</CCardBody></CCard>;
}

export function LiquidityCard() {
  const market = useMarketSnapshot();
  const catalog = useFredCatalog();
  const t = useChartTheme();
  const [days, setDays] = useState<number>(365);

  const units = useMemo(
    () => Object.fromEntries(LIQUIDITY_KEYS.map((k) => [k, resolveUnits(catalog.data, k)])) as Record<LiquidityKey, UnitResolution>,
    [catalog.data],
  );
  const all = useMemo(() => (market.data ? liquidityRows(market.data, units) : []), [market.data, units]);

  const view = useMemo(() => {
    if (!all.length || days === 0) return all;
    const cutoff = toDate(all[all.length - 1].date).getTime() - days * 86_400_000;
    const filtered = all.filter((r) => toDate(r.date).getTime() >= cutoff);
    return filtered.length >= 2 ? filtered : all;
  }, [all, days]);

  if (market.loading || catalog.loading) {
    return (
      <Shell>
        <CPlaceholder animation="glow">
          <CPlaceholder xs={3} size="lg" className="d-block mb-4" />
          <CPlaceholder xs={12} style={{ height: 260 }} />
        </CPlaceholder>
      </Shell>
    );
  }
  if (market.error || !market.data) {
    return <Shell><span className="text-danger">시장 데이터를 불러오지 못했습니다{market.error ? ` (${market.error})` : ""}.</span></Shell>;
  }
  if (!all.length) {
    return (
      <Shell>
        <h4 className="card-title mb-2">연준 유동성</h4>
        <p className="text-body-secondary mb-2">
          총자산(WALCL)·지급준비금(WRESBAL)·TGA(WTREGEN)·역레포(RRPONTSYD)는 수집 목록에 추가됐지만 아직 값이 없습니다.
          다음 일일 수집부터 쌓이고, 과거치는 Actions → <strong>Backfill Market History</strong>를 <code>merge</code> 켜고 실행하면
          빈칸만 채웁니다 (먼저 <code>dry_run</code>으로 확인).
        </p>
        <p className="small text-body-secondary mb-0">순유동성 = 총자산 − TGA − 역레포 (세 값이 모두 있는 날만 계산).</p>
      </Shell>
    );
  }

  // 차트는 값이 하나라도 있는 날만 — 시리즈마다 결측은 끊지 않고 이어 그린다(주간 시리즈는 수집 때 이미 앞 값으로 채워짐)
  const data: ChartData<"line"> = {
    labels: view.map((r) => r.date),
    datasets: LINES.map((l) => {
      const c = t.color(l.color);
      return {
        label: l.label,
        data: view.map((r) => r[l.field]),
        borderColor: c,
        backgroundColor: l.fill ? withAlpha(c, 0.1) : c,
        fill: l.fill ?? false,
        borderWidth: 2,
        borderDash: l.dash,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 8,
        tension: 0.2,
        spanGaps: true,
        hidden: l.hidden,
      };
    }),
  };

  const options: ChartOptions<"line"> = {
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "bottom", labels: { color: t.text, boxWidth: 14, boxHeight: 2, font: { size: 12 } } },
      tooltip: {
        callbacks: {
          title: (items) => formatShortDate(String(items[0]?.label ?? "")),
          label: (item) => (item.parsed.y === null ? "" : `${item.dataset.label} ${formatUsdBn(item.parsed.y)}`),
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: t.text, maxRotation: 0, autoSkip: true, maxTicksLimit: 6, font: { size: 11 },
          callback(value) {
            return formatShortDate(String(this.getLabelForValue(Number(value))));
          },
        },
      },
      y: {
        beginAtZero: true,
        grid: { color: t.grid },
        border: { display: false },
        ticks: { color: t.text, maxTicksLimit: 6, font: { size: 11 }, callback: (v) => formatTrillionAxis(Number(v)) },
      },
    },
  };

  const assets = latestWithChange(all, "fed_assets");
  const assumed = LIQUIDITY_KEYS.filter((k) => units[k].source === "fallback");

  return (
    <CCard className="mb-4">
      <CCardBody>
        <CRow className="align-items-center mb-3">
          <CCol sm={7}>
            <h4 className="card-title mb-0">연준 유동성</h4>
            <div className="small text-body-secondary">
              {formatShortDate(view[0].date)} ~ {formatShortDate(view[view.length - 1].date)} · 순유동성 = 총자산 − TGA − 역레포 · 범례를 눌러 TGA·역레포를 켜고 끕니다
            </div>
          </CCol>
          <CCol sm={5} className="mt-2 mt-sm-0 d-flex justify-content-sm-end">
            <CButtonGroup role="group" aria-label="기간">
              {RANGES.map((r) => (
                <CButton key={r.days} color="outline-secondary" active={days === r.days} aria-pressed={days === r.days} onClick={() => setDays(r.days)}>
                  {r.label}
                </CButton>
              ))}
            </CButtonGroup>
          </CCol>
        </CRow>
        <div style={{ height: 300 }}>
          <CChartLine
            key={`${t.theme}-${days}-${view.length}`}
            style={{ height: 300 }}
            role="img"
            aria-label="연준 총자산·순유동성·지급준비금·TGA·역레포 추이 (조 달러)"
            data={data as ChartData}
            options={options as ChartOptions}
          />
        </div>
      </CCardBody>

      <CCardFooter>
        <CRow xs={{ cols: 1, gutter: 4 }} sm={{ cols: 2 }} lg={{ cols: 3 }} xl={{ cols: 5 }} className="mb-2 text-center">
          {FOOTER.map(({ field, label, color, hint }) => {
            const r = latestWithChange(all, field);
            const share = r && assets && assets.value > 0 ? (r.value / assets.value) * 100 : null;
            return (
              <CCol key={field}>
                <CTooltip content={hint} placement="top">
                  <div className="text-body-secondary" tabIndex={0} style={{ cursor: "help" }}>{label}</div>
                </CTooltip>
                {r ? (
                  <>
                    <div className="fw-semibold text-nowrap tnum">{formatUsdBn(r.value)}</div>
                    <div className="small text-body-secondary text-nowrap tnum">
                      {r.change !== null ? `4주 ${formatUsdBnDelta(r.change)}` : "4주 비교값 없음"}
                    </div>
                    <CProgress thin className="mt-2" color={color} value={Math.min(Math.max(share ?? 0, 0), 100)} aria-label={`${label} 총자산 대비 비중`} />
                    <div className="small text-body-secondary mt-1">
                      기준 {formatShortDate(r.date)}
                      {field !== "fed_assets" && share !== null && ` · 총자산의 ${share.toFixed(0)}%`}
                    </div>
                  </>
                ) : (
                  <div className="small text-body-secondary">값 없음</div>
                )}
              </CCol>
            );
          })}
        </CRow>
        <div className="small text-body-secondary text-center">
          진행바 = 총자산 대비 비중 ·{" "}
          {assumed.length ? (
            <>
              <CBadge color="warning" textColor="dark">단위 가정</CBadge> {assumed.map((k) => LIQUIDITY_SERIES[k].id).join("·")}는 기본 단위로 환산했습니다 —
              FRED_API_KEY를 설정하면 FRED 메타데이터 단위로 확인합니다
            </>
          ) : (
            <>단위는 FRED API 메타데이터 기준으로 환산</>
          )}
        </div>
      </CCardFooter>
    </CCard>
  );
}
