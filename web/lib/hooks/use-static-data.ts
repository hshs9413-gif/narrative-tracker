"use client";

import { useEffect, useState } from "react";

// 여러 섹션이 같은 파일(market_snapshot.csv 등)을 쓰므로 경로별로 한 번만 받아 공유한다.
const cache = new Map<string, Promise<unknown>>();

function load<T>(path: string, parse: (res: Response) => Promise<T>): Promise<T> {
  let pending = cache.get(path) as Promise<T> | undefined;
  if (!pending) {
    // 상대경로(앞 슬래시 없음) — basePath 아래 어디서 서빙되든 페이지 기준으로 풀린다.
    pending = fetch(path).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parse(res);
    });
    cache.set(path, pending);
  }
  return pending;
}

export interface StaticData<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useStaticData<T>(path: string, parse: (res: Response) => Promise<T>): StaticData<T> {
  const [state, setState] = useState<StaticData<T>>({ data: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    load(path, parse)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((e) => {
        if (!cancelled) setState({ data: null, loading: false, error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [path, parse]);

  return state;
}
