"use client";

import { useMemo } from "react";
import { useStaticData } from "./use-static-data";
import { parseAttentionCsv, parseKoreaCsv, parseMarketSnapshotCsv, parseRegimeLogCsv } from "@/lib/csv";
import { computeMetrics } from "@/lib/narrative-metrics";
import type {
  AppConfig, AttentionRow, Correlations, ForecastLatest, FredCatalog, KoreaRow, KoreaSeriesMeta, MarketSnapshotRow, NarrativeCandidate, NarrativeEvent, NarrativeHeadlines, NarrativeLogEntry,
  Ranges, RegimeLogRow, RegimeState,
} from "@/types/dashboard";

// parse 함수는 모듈 레벨에 둬야 useEffect 의존성이 렌더마다 바뀌지 않는다.
const json = <T,>(res: Response) => res.json() as Promise<T>;
const parseRegime = (res: Response) => json<RegimeState>(res);
const parseEvents = (res: Response) => json<NarrativeEvent[]>(res);
const parseMarket = (res: Response) => res.text().then(parseMarketSnapshotCsv);
const parseAttention = (res: Response) => res.text().then(parseAttentionCsv);
const parseFredCatalog = (res: Response) => json<FredCatalog>(res);
const parseAppConfig = (res: Response) => json<AppConfig>(res);
const parseRegimeLog = (res: Response) => res.text().then(parseRegimeLogCsv);
const parseNarrativeLog = (res: Response) => json<NarrativeLogEntry[]>(res);
const parseCandidates = (res: Response) => json<NarrativeCandidate[]>(res);
const parseHeadlines = (res: Response) => json<NarrativeHeadlines>(res);
const parseKorea = (res: Response) => res.text().then(parseKoreaCsv);
const parseKoreaMeta = (res: Response) => json<KoreaSeriesMeta>(res);
const parseRanges = (res: Response) => json<Ranges>(res);
const parseForecast = (res: Response) => json<ForecastLatest>(res);
const parseCorrelations = (res: Response) => json<Correlations>(res);

export const useRegimeState = () => useStaticData<RegimeState>("data/regime_state.json", parseRegime);
export const useNarrativeEvents = () => useStaticData<NarrativeEvent[]>("data/events.json", parseEvents);
export const useMarketSnapshot = () => useStaticData<MarketSnapshotRow[]>("data/market_snapshot.csv", parseMarket);
export const useAttention = () => useStaticData<AttentionRow[]>("data/attention.csv", parseAttention);
// 일일 수집이 처음 돌기 전에는 파일이 없다(404) — 화면은 오류가 아니라 '설정 안내'로 처리한다.
export const useFredCatalog = () => useStaticData<FredCatalog>("data/fred_series.json", parseFredCatalog);
// 화면 설정 — 기업 재무 실시간 조회용 Apps Script 웹 앱 주소 등 (공개 값만)
export const useAppConfig = () => useStaticData<AppConfig>("data/app_config.json", parseAppConfig);
export const useRegimeLog = () => useStaticData<RegimeLogRow[]>("data/regime_log.csv", parseRegimeLog);
// Gemini·규칙·검증이 내러티브 목록을 바꾼 기록 — 파일이 아직 없으면(첫 실행 전) 빈 기록으로 본다
export const useNarrativeLog = () => useStaticData<NarrativeLogEntry[]>("data/narrative_log.json", parseNarrativeLog);
// Gemini가 지켜보는 새 이슈 후보 — 첫 정리 전에는 파일이 없다
export const useNarrativeCandidates = () => useStaticData<NarrativeCandidate[]>("data/narrative_candidates.json", parseCandidates);
// 한국 지표(한국은행 ECOS) — ECOS 키를 등록하고 수집이 한 번 돌기 전에는 파일이 없다(그 줄들만 빠짐)
export const useKoreaSnapshot = () => useStaticData<KoreaRow[]>("data/korea_snapshot.csv", parseKorea);
export const useKoreaSeries = () => useStaticData<KoreaSeriesMeta>("data/korea_series.json", parseKoreaMeta);
// 내러티브별 최근 기사 제목 — 수집이 처음 돌기 전에는 파일이 없다
export const useNarrativeHeadlines = () => useStaticData<NarrativeHeadlines>("data/narrative_headlines.json", parseHeadlines);
// 한 달 뒤 90% 범위 (compute_ranges.py)
export const useRanges = () => useStaticData<Ranges>("data/ranges.json", parseRanges);
// 다음 한국 장 예측 (compute_forecast.py) — 첫 아침 실행 전에는 파일이 없다
export const useForecast = () => useStaticData<ForecastLatest>("data/forecast_latest.json", parseForecast);
// 자산 사이 상관 (compute_correlation.py)
export const useCorrelations = () => useStaticData<Correlations>("data/correlations.json", parseCorrelations);

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
