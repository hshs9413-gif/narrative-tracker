"use client";

import type { ReactNode } from "react";
import { useMarketSnapshot, useRegimeState } from "@/lib/hooks/use-dashboard-data";
import { axisLevel, monthDay } from "@/lib/brief";
import { pmiStatus } from "@/lib/freshness";
import { Sparkline } from "./Sparkline";
import { ReportCrossCheck } from "./ReportCrossCheck";
import type { MarketSnapshotRow, RegimeState } from "@/types/dashboard";

const SPAN = 130; // 스파크라인 관측 수 (약 6개월)
const signed = (v: number, digits = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;

function series(rows: MarketSnapshotRow[], key: keyof MarketSnapshotRow, n = SPAN) {
  return rows.slice(-n).map((r) => r[key] as number | null);
}

interface RowProps {
  id: string;
  axis: string;
  verdict: string;
  level: number | null;
  readings: ReactNode;
  chart: ReactNode;
  rule: ReactNode;
}

function EvidenceRow({ axis, verdict, level, readings, chart, rule }: RowProps) {
  return (
    <article className="nt-ev-row">
      <header className="nt-ev-axis">
        <h3>{axis}</h3>
        <p className="nt-ev-verdict" data-level={level ?? "na"}>{verdict}</p>
      </header>
      <div className="nt-ev-readings">{readings}</div>
      <div className="nt-ev-chart">{chart}</div>
      <p className="nt-ev-rule">{rule}</p>
    </article>
  );
}

function rows(s: RegimeState, m: MarketSnapshotRow[]): RowProps[] {
  const gi = s.growth_inflation;
  const pmi = pmiStatus(gi.pmi_as_of);
  const cs = s.credit_stress;
  const vix = cs.detail && "value" in cs.detail.vix_level ? cs.detail.vix_level : null;
  const hy = cs.detail && "value" in cs.detail.hy_oas_pct ? cs.detail.hy_oas_pct : null;
  const ps = s.policy_stance;
  const kv = s.kospi_vol;
  const cc = s.cross_check;

  const out: RowProps[] = [
    {
      id: "gi",
      axis: "성장·물가",
      verdict: gi.label,
      level: axisLevel("gi", s),
      readings: (
        <>
          {gi.pmi != null && (
            <p>
              <b className="tnum">ISM 제조업 PMI {gi.pmi}</b> <span>{gi.pmi_as_of?.slice(5, 7).replace(/^0/, "")}월 지표{pmi?.expired ? ", 기한 지남" : ""}</span>
            </p>
          )}
          {gi.breakeven != null && (
            <p>
              <b className="tnum">기대인플레 {gi.breakeven.toFixed(2)}%</b>{" "}
              <span>
                3개월 {gi.breakeven_change !== undefined ? `${signed(gi.breakeven_change)}%p` : "변화 없음"}, {monthDay(gi.breakeven_date)}
              </span>
            </p>
          )}
          {gi.reason && <p className="nt-ev-note">{gi.reason}</p>}
        </>
      ),
      chart: <Sparkline values={series(m, "breakeven10y")} label="10년 기대인플레이션 최근 6개월" />,
      rule: "PMI가 50 이상이면 성장, 기대인플레 28일 평균이 91일 전보다 0.05%p 넘게 오르면 물가 상승으로 봅니다.",
    },
    {
      id: "credit",
      axis: "신용",
      verdict: cs.label,
      level: axisLevel("credit", s),
      readings: (
        <>
          {vix && (
            <p>
              <b className="tnum">VIX {vix.value.toFixed(1)}</b> <span>{vix.band}, {monthDay(vix.as_of)}</span>
            </p>
          )}
          {hy && (
            <p>
              <b className="tnum">하이일드 스프레드 {hy.value.toFixed(2)}%</b> <span>{hy.band}, {monthDay(hy.as_of)}</span>
            </p>
          )}
          {cs.since && <p className="nt-ev-note">{monthDay(cs.since)}부터 {cs.label}</p>}
        </>
      ),
      chart: (
        <div className="nt-ev-pair">
          <figure>
            <Sparkline values={series(m, "vix")} guides={[20]} label="VIX 최근 6개월, 기준선 20" />
            <figcaption>VIX</figcaption>
          </figure>
          <figure>
            <Sparkline values={series(m, "hy_oas")} guides={[3.5]} label="하이일드 스프레드 최근 6개월, 기준선 3.5%" />
            <figcaption>하이일드</figcaption>
          </figure>
        </div>
      ),
      rule: "VIX 20·30·40, 하이일드 스프레드 3.5·5·8% 중 더 나쁜 쪽으로 정하고, 새 단계가 3거래일 이어질 때 바꿉니다(경색 이상은 바로).",
    },
    {
      id: "policy",
      axis: "정책",
      verdict: ps.label,
      level: axisLevel("policy", s),
      readings: (
        <>
          {ps.current !== undefined && (
            <p>
              <b className="tnum">기준금리 상단 {ps.current.toFixed(2)}%</b>{" "}
              <span>
                {ps.lookback_value !== undefined && `${monthDay(ps.lookback_date)} ${ps.lookback_value.toFixed(2)}%에서 ${signed(ps.current - ps.lookback_value)}%p`}
              </span>
            </p>
          )}
          {ps.reason && <p className="nt-ev-note">{ps.reason}</p>}
        </>
      ),
      chart: <Sparkline values={series(m, "fedrate", 400)} stepped label="연방기금 목표금리 상단 최근 1년 반" />,
      rule: "90일 전보다 기준금리 상단이 0.125%p 이상 오르면 긴축, 내리면 완화, 그 사이면 중립입니다.",
    },
    {
      id: "kospi",
      axis: "국내 변동성",
      verdict: kv?.label ?? "미확인",
      level: axisLevel("kospi", s),
      readings: kv?.rv20 !== undefined ? (
        <>
          <p>
            <b className="tnum">코스피 20일 변동성 {kv.rv20.toFixed(0)}%</b> <span>연율, {monthDay(kv.as_of)}</span>
          </p>
          {kv.value !== undefined && (
            <p>
              <b className="tnum">코스피 {kv.value.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}</b>
            </p>
          )}
        </>
      ) : (
        <p className="nt-ev-note">{kv?.reason ?? "아직 판정 전입니다."}</p>
      ),
      chart: <Sparkline values={series(m, "kospi")} label="코스피 최근 6개월" />,
      rule: "코스피 20거래일 변동성(연율) 25·40·60%로 나눕니다. 미국 지표가 놓친 국내 급락을 보완하려고 10월에 추가했습니다.",
    },
  ];

  if (cc.nfci || cc.stlfsi4) {
    out.push({
      id: "fci",
      axis: "금융여건",
      verdict: "참고",
      level: null,
      readings: (
        <>
          {cc.nfci && (
            <p>
              <b className="tnum">시카고 연은 NFCI {cc.nfci.value.toFixed(2)}</b> <span>{cc.nfci.interpretation}</span>
            </p>
          )}
          {cc.stlfsi4 && (
            <p>
              <b className="tnum">세인트루이스 STLFSI {cc.stlfsi4.value.toFixed(2)}</b> <span>{cc.stlfsi4.interpretation}</span>
            </p>
          )}
        </>
      ),
      chart: <Sparkline values={series(m, "nfci")} guides={[0]} label="NFCI 최근 6개월, 0 기준선" />,
      rule: "판정에는 넣지 않고 신용 판정과 같은 방향인지 맞춰 보는 용도입니다. 0보다 작으면 평균보다 느슨합니다.",
    });
  }
  return out;
}

export function Evidence() {
  const regime = useRegimeState();
  const market = useMarketSnapshot();
  if (!regime.data) return null;
  return (
    <section id="evidence" className="nt-block">
      <h2 className="nt-h2">왜 이렇게 판정했나</h2>
      <p className="nt-lede">축마다 판정에 쓴 값과 그 날짜, 최근 6개월 흐름, 규칙을 나란히 둡니다. 점선은 판정이 바뀌는 기준선입니다.</p>
      <div className="nt-ev">
        {rows(regime.data, market.data ?? []).map((r) => (
          <EvidenceRow key={r.id} {...r} />
        ))}
      </div>
      <ReportCrossCheck />
    </section>
  );
}
