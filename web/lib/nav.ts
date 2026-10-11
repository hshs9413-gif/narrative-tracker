// 상단 목차와 스크롤 스파이가 같이 쓰는 섹션 목록 — id는 각 섹션 요소의 id와 같다. 읽는 순서 그대로.
export interface NavSection {
  id: string;
  label: string;
}

export const NAV: NavSection[] = [
  { id: "today", label: "오늘" },
  { id: "indicators", label: "지표" },
  { id: "narratives", label: "내러티브" },
  { id: "financials", label: "기업 재무" },
  { id: "charts", label: "차트" },
  { id: "sources", label: "출처" },
];

export const SECTION_IDS = NAV.map((n) => n.id);
