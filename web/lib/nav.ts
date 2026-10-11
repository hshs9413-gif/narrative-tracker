// 상단 목차와 스크롤 스파이가 같이 쓰는 섹션 목록 — id는 각 섹션 요소의 id와 같다. 읽는 순서 그대로.
export interface NavSection {
  id: string;
  label: string;
}

export const NAV: NavSection[] = [
  { id: "verdict", label: "판정" },
  { id: "evidence", label: "근거" },
  { id: "narratives", label: "내러티브" },
  { id: "indicators", label: "시장 지표" },
  { id: "liquidity", label: "유동성" },
  { id: "sources", label: "데이터 출처" },
  { id: "financials", label: "기업 재무" },
];

export const SECTION_IDS = NAV.map((n) => n.id);
