"use client";

import { useMemo } from "react";
import { useStaticData } from "./use-static-data";
import { parseAttentionCsv, parseMarketSnapshotCsv } from "@/lib/csv";
import { computeMetrics } from "@/lib/narrative-metrics";
import type { AttentionRow, FredCatalog, MarketSnapshotRow, NarrativeEvent, RegimeState } from "@/types/dashboard";

// parse 함수는 모듈 레벨에 둬야 useEffect 의존성이 렌더마다 바뀌지 않는다.
const json = <T,>(res: Response) => res.json() as Promise<T>;
const parseRegime = (res: Response) => json<RegimeState>(res);
const parseEvents = (res: Response) => json<NarrativeEvent[]>(res);
const parseMarket = (res: Response) => res.text().then(parseMarketSnapshotCsv);
const parseAttention = (res: Response) => res.text().then(parseAttentionCsv);
const parseFredCatalog = (res: Response) => json<FredCatalog>(res);

export const useRegimeState = () => useStaticData<RegimeState>("data/regime_state.json", parseRegime);
export const useNarrativeEvents = () => useStaticData<NarrativeEvent[]>("data/events.json", parseEvents);
export const useMarketSnapshot = () => useStaticData<MarketSnapshotRow[]>("data/market_snapshot.csv", parseMarket);
export const useAttention = () => useStaticData<AttentionRow[]>("data/attention.csv", parseAttention);
// 일일 수집이 처음 돌기 전에는 파일이 없다(404) — 화면은 오류가 아니라 '설정 안내'로 처리한다.
export const useFredCatalog = () => useStaticData<FredCatalog>("data/fred_series.json", parseFredCatalog);

// 시장·언급량 파일이 없어도 이벤트만 있으면 계산한다 (해당 칸만 '측정중') — 기존 대시보드와 동일.
export function useNarrativeMetrics() {
  const events = useNarrativeEvents();
  const market = useMarketSnapshot();
  const attention = useAttention();
  const loading = events.loading || market.loading || attention.loading;

  const metrics = useMemo(
    () => (events.data && !loading ? computeMetrics(events.data, market.data ?? [], attention.data ?? []) : null),
    [events.data, market.data, attention.data, loading],
  );

  return { metrics, loading, error: events.error };
}
