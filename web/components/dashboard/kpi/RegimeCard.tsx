"use client";

import { useRegimeState } from "@/lib/hooks/use-regime-state";
import { RegimeBadge } from "./RegimeBadge";
import { RegimeCardSkeleton } from "./RegimeCardSkeleton";
import {
  CREDIT_STRESS_COLOR,
  POLICY_STANCE_COLOR,
  formatDate,
} from "@/lib/formatters";

// 종합점수는 일부러 게이지/도넛 차트로 안 그린다 — 원형 진행률 시각화는
// "퍼센트/확률"로 즉시 읽히는데, regime_state.json 쪽 원칙이 "확률 아님,
// 규정기반 감점 점수"라서 그 오독을 만들 수 있는 시각적 은유는 피했다.
// 숫자 + 감점사유 텍스트로만 보여준다.

export function RegimeCard() {
  const { data, loading, error } = useRegimeState();

  if (loading) return <RegimeCardSkeleton />;

  if (error || !data) {
    return (
      <div className="rounded-xl border border-credit-crisis/50 bg-surface p-6">
        <p className="text-credit-crisis text-sm">
          레짐 데이터를 불러오지 못했습니다{error ? ` (${error})` : ""}.
        </p>
      </div>
    );
  }

  const { growth_inflation, credit_stress, policy_stance, composite_score, cross_check, thresholds_locked } = data;

  return (
    <div className="rounded-xl border border-grid bg-surface p-6">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs uppercase tracking-widest text-text-muted">현재 레짐</span>
        <span className="text-xs text-text-muted">{formatDate(data.generated_at)} 기준</span>
      </div>

      <h2 className="text-3xl font-bold mb-4">
        {growth_inflation.label}
        {growth_inflation.label === "미확인" && (
          <span className="block text-sm font-normal text-text-muted mt-1">
            {growth_inflation.reason}
          </span>
        )}
      </h2>

      <div className="flex flex-wrap gap-2 mb-6">
        <RegimeBadge label={credit_stress.label} colorMap={CREDIT_STRESS_COLOR} />
        <RegimeBadge label={policy_stance.label} colorMap={POLICY_STANCE_COLOR} />
      </div>

      <div className="border-t border-grid pt-4">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-2xl font-mono font-semibold">{composite_score.score}</span>
          <span className="text-xs text-text-muted">/ 100 · 확률 아님, 규정기반 감점 점수</span>
        </div>
        {composite_score.deductions[0] !== "없음" && (
          <p className="text-sm text-text-muted">
            감점: {composite_score.deductions.join(", ")}
          </p>
        )}
      </div>

      {!thresholds_locked && (
        <p className="mt-4 text-xs text-layer-structural">
          ⚠ 임계값 초안 상태(locked: false) — 최종 판정으로 쓰지 말 것
        </p>
      )}

      {(cross_check.nfci || cross_check.stlfsi4) && (
        <div className="mt-4 flex gap-4 text-xs text-text-muted">
          {cross_check.nfci && <span>NFCI {cross_check.nfci.value.toFixed(2)} ({cross_check.nfci.interpretation})</span>}
          {cross_check.stlfsi4 && <span>STLFSI4 {cross_check.stlfsi4.value.toFixed(2)} ({cross_check.stlfsi4.interpretation})</span>}
        </div>
      )}
    </div>
  );
}
