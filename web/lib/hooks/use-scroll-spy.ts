"use client";

import { useEffect, useState } from "react";

/** 화면 위쪽 1/3 지점에 걸친 섹션을 '현재 섹션'으로 본다 — 사이드바 강조용. */
export function useScrollSpy(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  const key = ids.join("|");

  useEffect(() => {
    const targets = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    if (!targets.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // 섹션 목록이 같으면 다시 만들 필요 없다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return active;
}
