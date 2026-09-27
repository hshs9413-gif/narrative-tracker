import type { NarrativeEvent } from "@/types/dashboard";
import { LAYER_COLOR, formatDate } from "@/lib/formatters";

// 종료된 내러티브는 카드 대신 한 줄짜리 압축 목록으로 — 활성 카드와 시각적
// 무게가 같으면 스크롤이 길어질수록 "지금 뭐가 살아있나"가 묻힌다.

export function EndedNarrativeRow({ event }: { event: NarrativeEvent }) {
  const color = LAYER_COLOR[event.layer];

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-sm">
      <span
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: color }}
      />
      <span className="flex-1 truncate text-text-muted">{event.name}</span>
      <span className="shrink-0 whitespace-nowrap text-xs text-text-muted">
        {formatDate(event.trigger_date)}
      </span>
    </div>
  );
}
