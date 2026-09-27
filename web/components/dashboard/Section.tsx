import type { ReactNode } from "react";

// 기존 대시보드의 section-title(대문자 라벨 + 오른쪽으로 이어지는 헤어라인)을 그대로 따른다.
export function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2.5 text-xs uppercase tracking-widest text-text-muted after:h-px after:flex-1 after:bg-grid after:content-['']">
        {title}
      </h2>
      {children}
      {note && <p className="text-xs leading-relaxed text-text-muted">{note}</p>}
    </section>
  );
}
