import { VerdictHero } from "@/components/brief/VerdictHero";
import { Evidence } from "@/components/brief/Evidence";
import { NarrativesNow } from "@/components/brief/NarrativesNow";
import { DataStatus } from "@/components/dashboard/kpi/DataStatus";
import { MarketWidgets } from "@/components/dashboard/kpi/MarketWidgets";
import { MarketIndicatorsChart } from "@/components/dashboard/charts/MarketIndicatorsChart";
import { LiquidityCard } from "@/components/dashboard/liquidity/LiquidityCard";
import { FredSourcesTable } from "@/components/dashboard/sources/FredSourcesTable";
import { CompanyFinancials } from "@/components/dashboard/financials/CompanyFinancials";
import { Section } from "@/components/dashboard/Section";

// 아침 브리핑 순서: 오늘의 판정 → 근거 → 내러티브(표·1년 흐름·최근 변경 한 곳), 그 아래에 깊게 볼 자료.

export default function Home() {
  return (
    <>
      <VerdictHero />
      <DataStatus />
      <Evidence />
      <NarrativesNow />

      <div className="nt-deep">
        <Section id="indicators" title="시장 지표" lede="판정에 쓰는 지표와 달러·금·원유를 한곳에 모았습니다. 값 옆 날짜는 그 값이 나온 날입니다.">
          <MarketWidgets />
          <div className="nt-panel">
            <MarketIndicatorsChart />
          </div>
        </Section>

        <Section id="liquidity" title="연준 유동성" lede="연준 총자산, 지급준비금, 역레포, 재무부 계좌(TGA)로 시중 달러 유동성의 방향을 봅니다.">
          <LiquidityCard />
        </Section>

        <Section
          id="sources"
          title="데이터 출처"
          lede="FRED 시리즈는 공식 API로 받고, 실패하면 같은 FRED 원본(fredgraph.csv)으로 받습니다."
          note="금(GC=F), 달러인덱스(ICE), 원유 선물, 원/달러, 코스피는 FRED가 아닌 시장 데이터라 이 표에 없습니다."
        >
          <FredSourcesTable />
        </Section>

        <Section
          id="financials"
          title="기업 재무"
          lede="회사 이름이나 사업자등록번호·법인등록번호로 찾으면 금융위원회 기업 재무정보를 그때 불러옵니다. 저장하지 않습니다."
          note="연간 자료라 분기 실적은 없고, 사업보고서가 반영된 뒤 갱신됩니다."
        >
          <CompanyFinancials />
        </Section>
      </div>
    </>
  );
}
