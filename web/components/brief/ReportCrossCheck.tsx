"use client";

import { useRegimeState } from "@/lib/hooks/use-dashboard-data";
import { monthDay } from "@/lib/brief";

const signed = (v: number, digits = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;

/** 외부 리포트의 물가축과 맞춰 볼 값 — 판정에는 쓰지 않는다. */
export function ReportCrossCheck() {
  const { data } = useRegimeState();
  const rc = data?.report_crosscheck;
  if (!rc) return null;
  const wti = rc.wti_front_4w;
  const bei = rc.breakeven_3m;
  return (
    <div className="nt-cross">
      <h3 className="nt-h3">리포트와 맞춰 볼 값</h3>
      <dl>
        <div>
          <dt>WTI 근월물 4주 변화</dt>
          <dd className="tnum">
            {"value" in wti
              ? `${signed(wti.change_pct, 1)}% (${monthDay(wti.base_date)} ${wti.base_value.toFixed(2)}달러에서 ${monthDay(wti.as_of)} ${wti.value.toFixed(2)}달러)`
              : "근월물 이력이 28일 이상 쌓이면 표시합니다"}
          </dd>
        </div>
        <div>
          <dt>기대인플레 3개월 변화</dt>
          <dd className="tnum">
            {"value" in bei ? `${signed(bei.change, 3)}%p (현재 ${bei.value.toFixed(2)}%, ${bei.window_days}일 평균을 ${bei.lookback_days}일 전과 비교)` : "데이터 없음"}
          </dd>
        </div>
      </dl>
    </div>
  );
}
