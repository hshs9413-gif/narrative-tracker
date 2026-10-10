"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY } from "@/lib/theme";

export type ColorMode = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

// CoreUI 차트처럼 캔버스에 직접 색을 칠하는 곳이 테마 변경을 알아채도록 쓰는 이벤트 (CoreUI 템플릿과 같은 이름).
const CHANGE_EVENT = "ColorSchemeChange";

const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

function applyMode(mode: ColorMode) {
  const dark = mode === "dark" || (mode === "auto" && prefersDark());
  document.documentElement.setAttribute("data-coreui-theme", dark ? "dark" : "light");
  document.documentElement.dispatchEvent(new Event(CHANGE_EVENT));
}

const MODE_EVENT = "nt-color-mode-change";

// localStorage가 막혀 있어도 이번 방문 동안은 선택이 유지되도록 메모리에도 들고 있는다.
let chosen: ColorMode | null = null;

function readStored(): ColorMode {
  if (chosen) return chosen;
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "auto") return stored;
  } catch {
    // 저장소가 막힌 환경(시크릿 창 등) — 기본값(auto)으로
  }
  return "auto";
}

function subscribeMode(onChange: () => void) {
  window.addEventListener(MODE_EVENT, onChange);
  window.addEventListener("storage", onChange); // 다른 탭에서 바꾼 경우
  return () => {
    window.removeEventListener(MODE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** 라이트/다크/자동 선택 상태와 변경 함수. 선택은 localStorage에 저장하되 실패해도 동작한다. */
export function useColorMode() {
  // 서버·첫 렌더는 auto로 맞추고(하이드레이션 일치), 마운트 뒤 저장값으로 바뀐다.
  const mode = useSyncExternalStore(subscribeMode, readStored, () => "auto" as ColorMode);

  useEffect(() => {
    if (mode !== "auto") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyMode("auto");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [mode]);

  const choose = useCallback((next: ColorMode) => {
    chosen = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // 저장 실패는 무시 — 이번 방문에서만 적용된다
    }
    applyMode(next);
    window.dispatchEvent(new Event(MODE_EVENT));
  }, []);

  return { mode, choose };
}

function subscribe(onChange: () => void) {
  const root = document.documentElement;
  root.addEventListener(CHANGE_EVENT, onChange);
  return () => root.removeEventListener(CHANGE_EVENT, onChange);
}

/** 지금 실제로 적용된 테마(light|dark). 차트 색을 다시 계산할 때 의존성으로 쓴다. */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.getAttribute("data-coreui-theme") === "dark" ? "dark" : "light"),
    () => "light",
  );
}

/** :root에 걸린 CSS 변수 값 — Chart.js는 var()를 못 읽어서 계산된 색을 직접 넘겨야 한다. */
export function cssVar(name: string, fallback = ""): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
