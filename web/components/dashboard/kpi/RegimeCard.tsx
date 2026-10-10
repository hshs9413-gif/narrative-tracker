"use client";

import { CAlert, CCard, CCardBody, CCardHeader, CCol, CPlaceholder, CRow } from "@coreui/react";
import { useRegimeState } from "@/lib/hooks/use-dashboard-data";
import { RegimeBadge } from "./RegimeBadge";
import { CREDIT_STRESS_COLOR, GROWTH_INFLATION_COLOR, POLICY_STANCE_COLOR, formatDate, formatShortDate, toBasisPoints } from "@/lib/formatters";
import { pmiStatus } from "@/lib/freshness";
import type { RegimeState, ReportCrossCheck } from "@/types/dashboard";

const signed = (v: number, digits = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;

interface EvidenceRow {
  axis: string;
  /** 판정 라벨 — 있으면 배지로 */
  verdict?: { label: string; map?: Record<string, string> };
  lines: string[];
  asOf?: string;
}

// 라벨만으로는 왜 그 판정인지 알 수 없어서, 판정에 쓰인 수치와 그 값의 기준일을 항목별로 보여준다.
function evidenceRows(state: RegimeState): EvidenceRow[] {
  const { growth_inflation: gi, credit_stress: cs, policy_stance: ps, cross_check: cc } = state;
  const rows: EvidenceRow[] = [];

  const giLines: string[] = [];
  const pmi = pmiStatus(gi.pmi_as_of);
  if (gi.pmi !== null && gi.pmi !== undefined) {
    giLines.push(`ISM PMI ${gi.pmi}${gi.pmi_as_of ? ` (${gi.pmi_as_of.slice(0, 7)}분${pmi ? ` · ${pmi.ageDays}일 경과` : ""})` : ""}`);
  }
  if (gi.breakeven !== null && gi.breakeven !== undefined) {
    const change = gi.breakeven_change !== undefined ? ` · ${Math.round((gi.breakeven_lookback_days ?? 91) / 30)}개월 ${signed(gi.breakeven_change)}%p` : "";
    giLines.push(`BEI ${gi.breakeven.toFixed(2)}%${change}`);
  }
  if (gi.reason) giLines.push(gi.reason);
  rows.push({ axis: "성장 · 물가", verdict: { label: gi.label, map: GROWTH_INFLATION_COLOR }, lines: giLines, asOf: gi.breakeven_date });

  const d = cs.detail;
  const csLines: string[] = [];
  if (d && "value" in d.vix_level) csLines.push(`VIX ${d.vix_level.value} → ${d.vix_level.band} (${formatShortDate(d.vix_level.as_of)})`);
  if (d && "value" in d.hy_oas_pct) csLines.push(`하이일드 ${toBasisPoints(d.hy_oas_pct.value)} → ${d.hy_oas_pct.band} (${formatShortDate(d.hy_oas_pct.as_of)})`);
  if (d && "value" in d.curve_2s10y) csLines.push(`2s10y ${signed(d.curve_2s10y.value * 100, 0)}bp${d.curve_2s10y.inverted ? " (역전)" : ""} · 참고용`);
  if (cs.reason) csLines.push(cs.reason);
  rows.push({ axis: "신용 스트레스", verdict: { label: cs.label, map: CREDIT_STRESS_COLOR }, lines: csLines, asOf: undefined });

  const psLines: string[] = [];
  if (ps.current !== undefined && ps.lookback_value !== undefined) psLines.push(`기준금리 ${ps.lookback_value}% → ${ps.current}% (${ps.lookback_days}일)`);
  if (ps.reason) psLines.push(ps.reason);
  rows.push({ axis: "정책 기조", verdict: { label: ps.label, map: POLICY_STANCE_COLOR }, lines: psLines, asOf: ps.current_date });

  const ccLines: string[] = [];
  if (cc.nfci) ccLines.push(`NFCI ${cc.nfci.value.toFixed(2)} — ${cc.nfci.interpretation}`);
  if (cc.stlfsi4) ccLines.push(`STLFSI4 ${cc.stlfsi4.value.toFixed(2)} — ${cc.stlfsi4.interpretation}`);
  if (ccLines.length) rows.push({ axis: "금융여건 (참고)", lines: ccLines, asOf: cc.nfci?.as_of ?? cc.stlfsi4?.as_of });

  return rows;
}

// 판정에는 안 쓰는 출력 전용 값 — 외부 리포트의 물가축 수치와 맞춰 볼 때 쓴다.
function CrossCheckPanel({ data }: { data: ReportCrossCheck }) {
  const wti = data.wti_front_4w;
  const bei = data.breakeven_3m;
  return (
    <CRow xs={{ cols: 1, gutter: 3 }} sm={{ cols: 2 }}>
      <CCol>
        <div className="small text-body-secondary">WTI 근월물 4주 변화 (CL=F)</div>
        {"value" in wti ? (
          <>
            <div className="fs-5 fw-semibold tnum">{signed(wti.change_pct, 1)}%</div>
            <div className="small text-body-secondary tnum">
              {wti.base_value.toFixed(2)} ({formatShortDate(wti.base_date)}) → {wti.value.toFixed(2)} ({formatShortDate(wti.as_of)})
            </div>
          </>
        ) : (
          <div className="text-body-secondary small mt-1">데이터 없음 — 근월물(CL=F) 28일치 이상 이력이 쌓이면 표시됩니다</div>
        )}
      </CCol>
      <CCol>
        <div className="small text-body-secondary">BEI 3개월 변화 (판정과 같은 식)</div>
        {"value" in bei ? (
          <>
            <div className="fs-5 fw-semibold tnum">{signed(bei.change, 3)}%p</div>
            <div className="small text-body-secondary tnum">
              현재 {bei.value.toFixed(2)}% ({formatShortDate(bei.as_of)}) · {bei.window_days}일 평균 vs {bei.lookback_days}일 전
            </div>
          </>
        ) : (
          <div className="text-body-secondary small mt-1">데이터 없음</div>
        )}
      </CCol>
    </CRow>
  );
}

function RegimeSkeleton() {
  return (
    <CCard>
      <CCardBody>
        <CPlaceholder animation="glow">
          <CPlaceholder xs={3} className="d-block mb-3" />
          <CPlaceholder xs={6} size="lg" className="d-block mb-4" />
          <CPlaceholder xs={12} style={{ height: 120 }} />
        </CPlaceholder>
      </CCardBody>
    </CCard>
  );
}

// 종합점수(composite_score)는 화면에서 뺐다 — 대시보드로만 쓰므로 판정 근거(항목별 라벨·수치·기준일)만 보여준다.
// regime_state.json·regime_log.csv에는 계속 기록된다.

export function RegimeCard() {
  const { data, loading, error } = useRegimeState();

  if (loading) return <RegimeSkeleton />;
  if (error || !data) {
    return (
      <CAlert color="danger" className="mb-0">
        레짐 데이터를 불러오지 못했습니다{error ? ` (${error})` : ""}.
      </CAlert>
    );
  }

  const { growth_inflation, credit_stress, policy_stance, thresholds_locked } = data;
  const unknown = growth_inflation.label === "미확인";

  return (
    <CCard className="mb-4">
      <CCardHeader className="d-flex justify-content-between align-items-center">
        <span className="fw-semibold">현재 레짐</span>
        <span className="small text-body-secondary" title="판정 스크립트가 실행된 시각">{formatDate(data.generated_at)} 판정</span>
      </CCardHeader>
      <CCardBody>
        <div className="d-flex flex-wrap align-items-center gap-2 mb-3" style={{ columnGap: "1.5rem" }}>
          <h3 className={`mb-0 ${unknown ? "text-body-secondary" : ""}`}>{growth_inflation.label}</h3>
          <div className="d-flex flex-wrap gap-2">
            <RegimeBadge caption="신용" label={credit_stress.label} colorMap={CREDIT_STRESS_COLOR} />
            <RegimeBadge caption="정책" label={policy_stance.label} colorMap={POLICY_STANCE_COLOR} />
          </div>
        </div>
        {unknown && growth_inflation.reason && <p className="small text-body-secondary">{growth_inflation.reason}</p>}

        {!thresholds_locked && (
          <CAlert color="warning" className="small mb-3 py-2">
            임계값 초안 상태(locked: false) — 최종 판정으로 쓰지 말 것
          </CAlert>
        )}

        {/* 표 대신 그리드 — 좁은 화면에서는 항목·판정·근거가 세로로 쌓인다 */}
        <div className="small fw-semibold text-body-secondary mt-4 mb-1">판정 근거 · 값의 기준일</div>
        <div className="nt-evidence" role="table" aria-label="레짐 판정 근거">
          <div className="nt-evidence-row nt-evidence-head small text-body-secondary" role="row">
            <span role="columnheader">항목</span>
            <span role="columnheader">판정</span>
            <span role="columnheader">근거 수치</span>
          </div>
          {evidenceRows(data).map((row) => (
            <div key={row.axis} className="nt-evidence-row" role="row">
              <div className="fw-semibold" role="cell">{row.axis}</div>
              <div role="cell">
                {row.verdict ? <RegimeBadge label={row.verdict.label} colorMap={row.verdict.map ?? {}} /> : <span className="text-body-secondary">—</span>}
              </div>
              <div className="small" role="cell">
                {row.lines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
                {row.asOf && <div className="text-body-secondary">기준 {formatShortDate(row.asOf)}</div>}
              </div>
            </div>
          ))}
        </div>

        {data.report_crosscheck && (
          <div className="border-top pt-3 mt-1">
            <div className="small fw-semibold mb-2">
              리포트 교차확인 <span className="fw-normal text-body-secondary">· 판정에는 쓰이지 않는 참고 수치</span>
            </div>
            <CrossCheckPanel data={data.report_crosscheck} />
          </div>
        )}
      </CCardBody>
    </CCard>
  );
}
