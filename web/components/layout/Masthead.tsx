"use client";

import { NAV, SECTION_IDS } from "@/lib/nav";
import { useScrollSpy } from "@/lib/hooks/use-scroll-spy";
import { useColorMode, type ColorMode } from "@/lib/hooks/use-color-mode";

const MODES: { mode: ColorMode; label: string }[] = [
  { mode: "light", label: "밝게" },
  { mode: "dark", label: "어둡게" },
  { mode: "auto", label: "시스템" },
];

function ThemeSwitch() {
  const { mode, choose } = useColorMode();
  return (
    <div className="nt-theme" role="radiogroup" aria-label="화면 밝기">
      {MODES.map((m) => (
        <button key={m.mode} type="button" role="radio" aria-checked={mode === m.mode} onClick={() => choose(m.mode)}>
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** 상단 제호 + 목차. 목차는 화면 위에 붙어 있고, 지금 읽는 섹션이 표시된다. */
export function Masthead() {
  const active = useScrollSpy(SECTION_IDS);
  return (
    <header className="nt-mast">
      <div className="nt-mast-inner">
        <a className="nt-wordmark" href="#verdict">
          레짐 트래커
        </a>
        <nav className="nt-toc" aria-label="목차">
          {NAV.map((n) => (
            <a key={n.id} href={`#${n.id}`} aria-current={active === n.id ? "location" : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
        <ThemeSwitch />
      </div>
    </header>
  );
}
