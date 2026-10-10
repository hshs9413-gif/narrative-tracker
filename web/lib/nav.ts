import { cilBalanceScale, cilBank, cilBolt, cilChartLine, cilHistory, cilLayers, cilNewspaper, cilSpeedometer, cilStorage } from "@coreui/icons";

// 사이드바 메뉴와 스크롤 스파이가 같이 쓰는 섹션 목록 — id는 각 섹션 요소의 id와 같다.
export interface NavSection {
  id: string;
  label: string;
  icon: string[];
}

export interface NavGroup {
  title: string;
  items: NavSection[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "요약",
    items: [
      { id: "overview", label: "개요", icon: cilSpeedometer },
      { id: "regime", label: "현재 레짐", icon: cilLayers },
    ],
  },
  {
    title: "내러티브",
    items: [
      { id: "timeline", label: "지층 타임라인", icon: cilHistory },
      { id: "matrix", label: "지속기간 · 시장영향", icon: cilBalanceScale },
      { id: "events", label: "활성 · 휴면 이벤트", icon: cilBolt },
      { id: "attention", label: "뉴스 언급량", icon: cilNewspaper },
    ],
  },
  {
    title: "시장 데이터",
    items: [
      { id: "indicators", label: "정량 지표 추이", icon: cilChartLine },
      { id: "liquidity", label: "연준 유동성", icon: cilBank },
      { id: "sources", label: "데이터 소스 (FRED)", icon: cilStorage },
    ],
  },
];

export const SECTION_IDS = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));
