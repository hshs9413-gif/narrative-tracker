"use client";

// use-regime-state.ts와 동일한 패턴: 패칭 + 로딩/에러 상태만 담당.

import { useEffect, useState } from "react";
import type { NarrativeEvent } from "@/types/dashboard";

interface UseNarrativeEventsResult {
  data: NarrativeEvent[] | null;
  loading: boolean;
  error: string | null;
}

export function useNarrativeEvents(): UseNarrativeEventsResult {
  const [data, setData] = useState<NarrativeEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("data/events.json")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: NarrativeEvent[]) => {
        if (!cancelled) setData(json);
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
