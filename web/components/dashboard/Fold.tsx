"use client";

import { useState, type ReactNode } from "react";

// 접어 둔 섹션 — 처음 펼칠 때 본문을 그린다(큰 차트·긴 표가 첫 화면을 무겁게 하지 않게, 접힌 채로 0px 폭에 그려지지 않게).
export function Fold({ id, title, lede, children }: { id: string; title: string; lede?: ReactNode; children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  return (
    <section id={id} className="nt-block nt-fold">
      <details onToggle={(e) => e.currentTarget.open && setOpened(true)}>
        <summary>
          <h2 className="nt-h2">{title}</h2>
          {lede && <span className="nt-fold-lede">{lede}</span>}
        </summary>
        {opened && <div className="nt-fold-body">{children}</div>}
      </details>
    </section>
  );
}
