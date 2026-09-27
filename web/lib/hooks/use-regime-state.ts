"use client";

// 단일 책임: regime_state.json 패칭 + 로딩/에러 상태만 담당. 화면 표시는
// components/dashboard/kpi/RegimeCard.tsx 쪽 몫 — page.tsx에 인라인으로 섞어뒀던 걸
// Phase 2에서 분리했다.

import { useEffect, useState } from "react";
import type { RegimeState } from "@/types/dashboard";

interface UseRegimeStateResult {
  data: RegimeState | null;
  loading: boolean;
  error: string | null;
}

export function useRegimeState(): UseRegimeStateResult {
  const [data, setData] = useState<RegimeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // 앞에 슬래시 없는 상대경로 — basePath(/narrative-tracker) 아래 어디서
    // 서빙되든 이 페이지 기준 상대 위치(data/regime_state.json)로 정확히 풀린다.
    fetch("data/regime_state.json")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: RegimeState) => {
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
