"use client";

import { useMarketSnapshot, useRegimeLog, useRegimeState } from "@/lib/hooks/use-dashboard-data";
import { axisLevel, briefStamp, monthDay, verdictSentence } from "@/lib/brief";
import { dataAnchor, pipelineLagDays } from "@/lib/freshness";

function AxisChip({ name, value, level }: { name: string; value: string; level: number | null }) {
  return (
    <div className="nt-axis" data-level={level ?? "na"}>
      <dt>{name}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function VerdictHero() {
  const regime = useRegimeState();
  const log = useRegimeLog();
  const market = useMarketSnapshot();
  const s = regime.data;

  if (regime.loading) {
    return (
      <section id="verdict" className="nt-hero" aria-busy="true">
        <p className="nt-hero-stamp">판정을 불러오는 중입니다</p>
        <div className="nt-skeleton nt-skeleton-verdict" />
      </section>
    );
  }
  if (!s) {
    return (
      <section id="verdict" className="nt-hero">
        <h1 className="nt-verdict">판정 파일을 불러오지 못했습니다.</h1>
        <p className="nt-hero-lede">docs/data/regime_state.json이 있는지, 매일 07:30 수집이 성공했는지 Actions에서 확인하세요.</p>
      </section>
    );
  }

  const rows = log.data ?? [];
  const last = rows[rows.length - 1];
  const anchor = market.data ? dataAnchor(market.data) : last?.date ?? null;
  const lag = anchor ? pipelineLagDays(anchor) : 0;
  const kv = s.kospi_vol;
  const cs = s.credit_stress;
  const pending = cs.raw_label && cs.raw_label !== cs.label;

  return (
    <section id="verdict" className="nt-hero">
      <p className="nt-hero-stamp">{briefStamp(s.generated_at)} 판정</p>
      <h1 className="nt-verdict">{verdictSentence(s)}</h1>
      <p className="nt-hero-lede">
        아래 네 가지 판정은 지금 시장 상태를 요약한 것이지, 앞으로 오를지 내릴지 맞히는 예측이 아닙니다.
        {kv && kv.label === "미확인" && " 국내 변동성은 코스피 데이터가 오래돼 이번 판정에서 빠졌습니다."}
        {pending && ` 오늘 값만 보면 신용은 '${cs.raw_label}'이지만, 3거래일 연속이어야 판정을 바꿉니다.`}
      </p>

      <dl className="nt-axes">
        <AxisChip name="성장·물가" value={s.growth_inflation.label} level={axisLevel("gi", s)} />
        <AxisChip name="신용" value={cs.label} level={axisLevel("credit", s)} />
        <AxisChip name="정책" value={s.policy_stance.label} level={axisLevel("policy", s)} />
        <AxisChip name="국내 변동성" value={kv?.label ?? "미확인"} level={axisLevel("kospi", s)} />
      </dl>

      <p className="nt-hero-foot">
        {anchor && `${monthDay(anchor)} 미국 장 마감까지의 데이터로 판정했습니다.`}
        {lag > 4 && ` 수집이 ${lag}일째 멈춰 있어 최신 판정이 아닐 수 있습니다.`}
        {last?.thresholds_version && ` 임계값은 아직 초안(${last.thresholds_version})이라 바뀔 수 있습니다.`}
      </p>
    </section>
  );
}
