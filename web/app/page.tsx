import { RegimeCard } from "@/components/dashboard/kpi/RegimeCard";
import { NarrativeTimeline } from "@/components/dashboard/timeline/NarrativeTimeline";
import { MarketIndicatorsChart } from "@/components/dashboard/charts/MarketIndicatorsChart";

// Phase 4 — 시장 지표 차트 연결. 화면 컴포넌트는 이걸로 일단 다 붙음.

export default function Home() {
  return (
    <main className="flex-1 max-w-3xl mx-auto w-full p-6 md:p-8 space-y-6">
      <header>
        <h1 className="text-xl font-bold">레짐 네러티브 트래커</h1>
      </header>

      <RegimeCard />
      <MarketIndicatorsChart />
      <NarrativeTimeline />
    </main>
  );
}
