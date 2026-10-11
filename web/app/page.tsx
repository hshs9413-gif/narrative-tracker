import { Notable } from "@/components/brief/Notable";
import { IndicatorTable } from "@/components/brief/IndicatorTable";
import { NarrativesNow } from "@/components/brief/NarrativesNow";
import { MarketIndicatorsChart } from "@/components/dashboard/charts/MarketIndicatorsChart";
import { LiquidityCard } from "@/components/dashboard/liquidity/LiquidityCard";
import { FredSourcesTable } from "@/components/dashboard/sources/FredSourcesTable";
import { CompanyFinancials } from "@/components/dashboard/financials/CompanyFinancials";
import { Section } from "@/components/dashboard/Section";
import { Fold } from "@/components/dashboard/Fold";

// 읽는 순서: 평소와 다른 지표 → 주요 지표 표 → 내러티브 → 기업 재무. 큰 차트·연준 유동성·데이터 출처는 접어 둔다.
// 규칙 판정(레짐 라벨·점수)은 예측력이 없어 2026-10-11에 화면에서 뺐다 — 계산은 regime_log에 계속 남는다.

export default function Home() {
  return (
    <>
      <Notable />
      <IndicatorTable />
      <NarrativesNow />

      <Section
        id="financials"
        title="기업 재무"
        lede="회사 이름이나 사업자등록번호·법인등록번호로 찾으면 금융위원회 기업 재무정보를 그때 불러옵니다. 저장하지 않습니다."
        note="연간 자료라 분기 실적은 없고, 사업보고서가 반영된 뒤 갱신됩니다."
      >
        <CompanyFinancials />
      </Section>

      <div className="nt-deep">
        <Fold id="charts" title="차트로 자세히 보기" lede="지표별 큰 차트(기간 선택)와 연준 유동성 — 펼치면 그립니다.">
          <div className="nt-panel">
            <MarketIndicatorsChart />
          </div>
          <h3 className="nt-nt-sub">연준 유동성</h3>
          <p className="nt-lede">연준 총자산, 지급준비금, 역레포, 재무부 계좌(TGA)로 시중 달러 유동성의 방향을 봅니다.</p>
          <LiquidityCard />
        </Fold>

        <Fold id="sources" title="데이터 출처" lede="FRED 시리즈 목록, 마지막 관측일, 수집 경로.">
          <p className="nt-lede">FRED 시리즈는 공식 API로 받고, 실패하면 같은 FRED 원본(fredgraph.csv)으로 받습니다.</p>
          <FredSourcesTable />
          <p className="nt-note">금(GC=F), 달러인덱스(ICE), 원유 선물, 원/달러, 코스피는 FRED가 아닌 시장 데이터라 이 표에 없습니다.</p>
        </Fold>
      </div>
    </>
  );
}
