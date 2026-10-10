import type { ReactNode } from "react";
import { CBadge, CProgress } from "@coreui/react";
import { LAYER_COLOR, LAYER_COLOR_NAME, LAYER_LABEL, PHASE_LABEL } from "@/lib/formatters";
import type { Impact, NarrativeMetrics, Quadrant } from "@/lib/narrative-metrics";

// 기존 대시보드의 '지속기간 · 시장영향 매트릭스' — 넓은 화면은 표처럼, 좁은 화면은 항목마다 라벨이 붙은 카드처럼 쌓인다.
// 표(table) 대신 그리드를 쓰는 이유: 이름 열이 좁은 화면에서 글자 단위로 찌그러지는 것을 막기 위해서다.

const QUADRANT_TAG: Partial<Record<Quadrant, string>> = {
  "지배 내러티브": "bg-danger-subtle text-danger-emphasis",
  "소음 (이미 반영)": "bg-secondary-subtle text-secondary-emphasis",
  "저평가 리스크": "bg-warning-subtle text-warning-emphasis",
};

const byImpact = (a: NarrativeMetrics, b: NarrativeMetrics) => (b.impact?.peak ?? 0) - (a.impact?.peak ?? 0);
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

/** 좁은 화면에서만 보이는 항목 라벨 */
function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="cell">
      <span className="nt-cell-label">{label}</span>
      {children}
    </div>
  );
}

function NameCell({ m, withPhase }: { m: NarrativeMetrics; withPhase?: boolean }) {
  const e = m.event;
  return (
    <div role="cell">
      <div className="fw-semibold">
        <span className="nt-dot" style={{ background: LAYER_COLOR[e.layer] }} />
        {e.name}
      </div>
      <div className="small text-body-secondary">
        {LAYER_LABEL[e.layer]}
        {withPhase && e.phase ? ` · ${PHASE_LABEL[e.phase] ?? e.phase}` : ""}
      </div>
    </div>
  );
}

function ImpactValue({ impact }: { impact: Impact }) {
  return <span className="text-nowrap tnum fw-semibold">{signed(impact.top.pct)}</span>;
}

export function NarrativeMatrix({ metrics }: { metrics: NarrativeMetrics[] }) {
  const live = metrics.filter((m) => m.event.status !== "ended").sort(byImpact);
  const archived = metrics.filter((m) => m.event.status === "ended").sort(byImpact);

  return (
    <div className="nt-matrix">
      {live.length === 0 ? (
        <p className="text-body-secondary mb-0">활성·휴면 내러티브가 없습니다.</p>
      ) : (
        <div role="table" aria-label="활성·휴면 내러티브의 지속기간과 시장영향">
          <div className="nt-matrix-row nt-matrix-head small text-body-secondary" role="row">
            <span role="columnheader">내러티브</span>
            <span role="columnheader">지속기간</span>
            <span role="columnheader">시장영향 (트리거 전후 5일)</span>
            <span role="columnheader">언급량</span>
            <span role="columnheader">사분면</span>
          </div>
          {live.map((m) => {
            const ratio = m.judgeSpan / m.typical;
            const longRun = ratio >= 1;
            const att = m.attention;
            return (
              <div key={m.event.id} className="nt-matrix-row" role="row">
                <NameCell m={m} withPhase />
                <Cell label="지속기간">
                  <span className="text-nowrap tnum">{m.durationLabel}</span>
                  <CProgress className="mt-1" height={4} color={longRun ? "warning" : "secondary"} value={Math.min(ratio * 100, 100)} />
                  <span className={`small ${longRun ? "text-warning-emphasis" : "text-body-secondary"}`}>
                    {m.persistence} · 층 통상 {m.typical}일
                  </span>
                </Cell>
                <Cell label="시장영향">
                  {m.impact ? (
                    <>
                      <ImpactValue impact={m.impact} /> <span className="small text-body-secondary">{m.impact.top.label}</span>
                      <CProgress className="mt-1" height={4} color={LAYER_COLOR_NAME[m.event.layer]} value={Math.min(m.impact.peak * 8, 100)} />
                      <span className="small text-body-secondary">{m.impact.strong}개 자산 3%+ 반응</span>
                    </>
                  ) : (
                    <span className="small text-body-secondary">트리거일 시장데이터 없음</span>
                  )}
                </Cell>
                <Cell label="언급량">
                  {att.days === 0 ? (
                    <span className="small text-body-secondary">수집 전</span>
                  ) : att.recentAvg === null ? (
                    <span className="small text-body-secondary">{att.days}일차 측정중</span>
                  ) : (
                    <>
                      <div className="text-nowrap tnum fw-semibold">{Math.round(att.recentAvg)}건/일</div>
                      <div className="small text-body-secondary">7일 평균 · 정점 대비 {Math.round((att.ratio ?? 0) * 100)}%</div>
                    </>
                  )}
                </Cell>
                <Cell label="사분면">
                  <CBadge className={`text-nowrap ${QUADRANT_TAG[m.quadrant] ?? "bg-body-secondary text-body-secondary"}`} shape="rounded-pill">
                    {m.quadrant}
                  </CBadge>
                </Cell>
              </div>
            );
          })}
        </div>
      )}

      {archived.length > 0 && (
        <details className="mt-3 border-top pt-2">
          <summary className="small text-body-secondary py-2" style={{ cursor: "pointer" }}>
            종료된 내러티브 {archived.length}건 — 과거 영향 기록 보기
          </summary>
          <div role="table" aria-label="종료된 내러티브의 활성기간과 시장영향">
            <div className="nt-matrix-row nt-matrix-archived nt-matrix-head small text-body-secondary" role="row">
              <span role="columnheader">내러티브</span>
              <span role="columnheader">활성기간</span>
              <span role="columnheader">시장영향</span>
            </div>
            {archived.map((m) => (
              <div key={m.event.id} className="nt-matrix-row nt-matrix-archived" role="row">
                <NameCell m={m} />
                <Cell label="활성기간">
                  <span className="tnum">{m.activeSpan}일</span>
                  <div className="small text-body-secondary">{m.event.trigger_date} ~ {m.event.half_life_date ?? ""}</div>
                </Cell>
                <Cell label="시장영향">
                  {m.impact ? (
                    <>
                      <ImpactValue impact={m.impact} />
                      <div className="small text-body-secondary">{m.impact.top.label} · {m.impact.strong}개 자산 3%+</div>
                    </>
                  ) : (
                    <span className="small text-body-secondary">—</span>
                  )}
                </Cell>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
