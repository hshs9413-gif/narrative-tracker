"use client";

// use-regime-state.ts / use-narrative-events.ts와 동일 패턴. CSV라 res.text() +
// parseMarketSnapshotCsv만 다르고 나머지 로딩/에러 처리는 그대로.

import { useEffect, useState } from "react";
import type { MarketSnapshotRow } from "@/types/dashboard";
import { parseMarketSnapshotCsv } from "@/lib/csv";

interface UseMarketSnapshotResult {
  data: MarketSnapshotRow[] | null;
  loading: boolean;
  error: string | null;
}

export function useMarketSnapshot(): UseMarketSnapshotResult {
  const [data, setData] = useState<MarketSnapshotRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("data/market_snapshot.csv")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setData(parseMarketSnapshotCsv(text));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading, error };
}
