import type { ReactNode } from "react";

// 카드 묶음 위에 붙는 섹션 제목 — id는 사이드바 메뉴·스크롤 스파이와 연결된다.
export function Section({ id, title, note, children }: { id: string; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section id={id}>
      <h2 className="nt-section-title">{title}</h2>
      {children}
      {note && <p className="small text-body-secondary mt-3 mb-0">{note}</p>}
    </section>
  );
}
