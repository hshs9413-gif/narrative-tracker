import { RegimeCard } from "@/components/dashboard/kpi/RegimeCard";
import { MarketTicker } from "@/components/dashboard/kpi/MarketTicker";
import { NarrativeSections } from "@/components/dashboard/narrative/NarrativeSections";
import { MarketIndicatorsChart } from "@/components/dashboard/charts/MarketIndicatorsChart";
import { Section } from "@/components/dashboard/Section";

// 섹션 구성·순서는 기존 docs/index.html을 그대로 따르고, 레짐 카드만 새로 추가했다.

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-12 px-4 pb-16 pt-10 sm:px-8">
      <header className="space-y-4 border-b border-grid pb-8">
        <div className="text-xs uppercase tracking-[0.18em] text-text-muted">Macro Narrative / Regime Tracker</div>
        <h1 className="text-2xl font-bold sm:text-3xl">내러티브 레짐 트래커</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-text-muted">
          시장을 지배하는 내러티브는 경기순환 · 구조테마 · 정치제도 세 지층을 따라 순환합니다. 정치/제도 층의 충격은
          아래 지층을 뚫고 올라오는 균열처럼 다른 두 층의 흐름을 왜곡시킵니다.
        </p>
        <MarketTicker />
      </header>

      <RegimeCard />

      <NarrativeSections />

      <Section title="정량 지표 추이">
        <MarketIndicatorsChart />
      </Section>

      <footer className="text-xs text-text-muted">
        정량 지표는 GitHub Actions가 매일 자동 수집합니다. 이벤트 기록(events.json)은 직접 갱신합니다.
      </footer>
    </main>
  );
}
