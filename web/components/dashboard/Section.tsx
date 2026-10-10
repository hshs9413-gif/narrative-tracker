import type { ReactNode } from "react";

// 브리핑 아래 깊은 섹션 — 제목, 한두 문장 안내(lede), 본문, 덧붙임(note). id는 목차·스크롤 스파이와 연결된다.
export function Section({ id, title, lede, note, children }: { id: string; title: string; lede?: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="nt-block">
      <h2 className="nt-h2">{title}</h2>
      {lede && <p className="nt-lede">{lede}</p>}
      {children}
      {note && <p className="nt-note">{note}</p>}
    </section>
  );
}
