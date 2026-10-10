import { RegimeCard } from "@/components/dashboard/kpi/RegimeCard";
import { MarketWidgets } from "@/components/dashboard/kpi/MarketWidgets";
import { DataStatus } from "@/components/dashboard/kpi/DataStatus";
import { NarrativeSections } from "@/components/dashboard/narrative/NarrativeSections";
import { MarketIndicatorsChart } from "@/components/dashboard/charts/MarketIndicatorsChart";
import { LiquidityCard } from "@/components/dashboard/liquidity/LiquidityCard";
import { FredSourcesTable } from "@/components/dashboard/sources/FredSourcesTable";
import { CompanyFinancials } from "@/components/dashboard/financials/CompanyFinancials";
import { Section } from "@/components/dashboard/Section";

// 섹션 구성·순서는 기존 docs/index.html을 따르고, 레짐 카드·데이터 상태 안내가 더해졌다.
// 화면 틀(사이드바·헤더·카드·위젯)은 CoreUI 무료 React 대시보드를 따른다.

export default function Home() {
  return (
    <>
      <section id="overview" className="pt-4">
        <h1 className="h3 mb-1">내러티브 레짐 트래커</h1>
        <p className="text-body-secondary mb-4" style={{ maxWidth: "52rem" }}>
          시장을 지배하는 내러티브는 경기순환 · 구조테마 · 정치제도 세 지층을 따라 순환합니다. 정치/제도 층의 충격은 아래 지층을 뚫고 올라오는
          균열처럼 다른 두 층의 흐름을 왜곡시킵니다.
        </p>
        <DataStatus />
        <MarketWidgets />
      </section>

      <Section id="regime" title="현재 레짐">
        <RegimeCard />
      </Section>

      <NarrativeSections />

      <Section id="indicators" title="정량 지표 추이">
        <MarketIndicatorsChart />
      </Section>

      <Section id="liquidity" title="연준 유동성 (H.4.1 · 역레포)">
        <LiquidityCard />
      </Section>

      <Section
        id="sources"
        title="데이터 소스 — FRED"
        note="FRED 시리즈는 FRED_API_KEY가 있으면 공식 API로, 없거나 실패하면 FinanceDataReader(fredgraph.csv)로 받습니다. 어느 경로든 값은 같은 FRED 원본입니다. 금(GC=F)·DXY(ICE)·원유 선물·원/달러·KOSPI는 FRED가 아닌 시장 데이터라 이 표에 없습니다."
      >
        <FredSourcesTable />
      </Section>

      <Section
        id="financials"
        title="기업 재무 — 금융위원회 기업 재무정보"
        note="금융위원회_기업 재무정보·기업기본정보(공공데이터포털)를 검색할 때마다 불러오며 저장하지 않습니다. 연간 자료라 분기 실적은 없고, 사업보고서가 반영된 뒤 갱신됩니다."
      >
        <CompanyFinancials />
      </Section>
    </>
  );
}
