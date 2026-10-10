"use client";

import { useMemo } from "react";
import { cssVar, useResolvedTheme } from "./use-color-mode";

/** Chart.js용 색 — 테마가 바뀌면 다시 계산돼 차트가 새 색으로 그려진다. */
export function useChartTheme() {
  const theme = useResolvedTheme();
  return useMemo(
    () => ({
      theme,
      text: cssVar("--cui-secondary-color", "#6b7785"),
      grid: cssVar("--cui-border-color", "#dbdfe6"),
      surface: cssVar("--cui-body-bg", "#ffffff"),
      color: (name: string) => cssVar(`--cui-${name}`, "#5856d6"),
    }),
    // theme이 바뀔 때만 CSS 변수를 다시 읽는다
    [theme],
  );
}
