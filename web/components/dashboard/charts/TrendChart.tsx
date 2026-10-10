"use client";

import { CChartLine } from "@coreui/react-chartjs";
import type { ChartData, ChartOptions } from "chart.js";
import { useChartTheme } from "@/lib/hooks/use-chart-theme";
import { withAlpha } from "@/lib/chart-utils";
import { compactSeries } from "@/lib/series";
import type { JumpRule } from "@/lib/indicators";
import { formatShortDate } from "@/lib/formatters";

export interface TrendPoint {
  date: string;
  value: number | null;
}

interface Reference {
  value: number;
  label: string;
}

interface Props {
  points: TrendPoint[];
  format: (v: number) => string;
  /** CoreUI 색 이름 (primary·info·warning·danger·success …) */
  color?: string;
  stepped?: boolean;
  /** 직전 관측 대비 이만큼 움직인 점을 빨간 점으로 표시하고 툴팁에 안내를 붙인다 */
  jump?: JumpRule;
  references?: Reference[];
  height?: number;
  ariaLabel: string;
}

/** 카드 안에 들어가는 라인 차트 — 짧은 휴장 공백만 잇고, 길게 빈 구간은 끊어서 보여준다(값을 지어내지 않음). */
export function TrendChart({ points, format, color = "primary", stepped = false, jump, references = [], height = 150, ariaLabel }: Props) {
  const t = useChartTheme();
  const main = t.color(color);
  const danger = t.color("danger");

  const { labels, values, jumps } = compactSeries(points, jump);
  let last = values.length - 1;
  while (last > 0 && values[last] === null) last--;

  // 점 스타일은 배열로 넘긴다 — CChart가 데이터를 JSON으로 비교해 갱신하므로 함수는 값이 바뀌어도 반영되지 않는다
  const radius = values.map((_, i) => (jumps.has(i) ? 3.5 : i === last ? 3 : 0));
  const pointColor = values.map((_, i) => (jumps.has(i) ? danger : main));

  const data: ChartData<"line"> = {
    labels,
    datasets: [
      {
        label: "값",
        data: values,
        borderColor: main,
        backgroundColor: withAlpha(main, 0.1),
        fill: true,
        pointBackgroundColor: pointColor,
        pointBorderColor: pointColor,
        pointRadius: radius,
        pointHoverRadius: 4,
        borderWidth: 2,
        tension: stepped ? 0 : 0.25,
        stepped: stepped ? "before" : false,
        spanGaps: false,
      },
      ...references.map((r) => ({
        label: r.label,
        data: values.map(() => r.value),
        borderColor: t.text,
        borderDash: [5, 4],
        borderWidth: 1,
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: false,
      })),
    ],
  };

  const options: ChartOptions<"line"> = {
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: references.length
        ? { position: "bottom", labels: { color: t.text, boxWidth: 22, boxHeight: 1, filter: (item) => item.datasetIndex !== 0, font: { size: 11 } } }
        : { display: false },
      tooltip: {
        filter: (item) => item.datasetIndex === 0 && item.parsed.y !== null, // 선이 끊긴 자리(빈 점)는 툴팁에서 뺀다
        callbacks: {
          title: (items) => formatShortDate(String(items[0]?.label ?? "")),
          label: (item) => (item.parsed.y === null ? "" : format(item.parsed.y)),
          afterLabel: (item) => (jumps.has(item.dataIndex) ? "급변 — 원본 확인 필요" : ""),
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: t.text, maxRotation: 0, autoSkip: true, maxTicksLimit: 5, font: { size: 11 },
          callback(value) {
            return formatShortDate(String(this.getLabelForValue(Number(value))));
          },
        },
      },
      y: {
        grace: "8%", // 눈금은 Chart.js가 보기 좋은 값으로 잡고, 위아래만 조금 띄운다
        grid: { color: t.grid },
        border: { display: false },
        ticks: { color: t.text, maxTicksLimit: 4, font: { size: 11 }, callback: (v) => format(Number(v)) },
      },
    },
  };

  return (
    // 테마·범위가 바뀌면 통째로 다시 그린다 (색·함수형 옵션은 JSON 비교로는 갱신이 안 됨)
    <div style={{ height }}>
      <CChartLine key={`${t.theme}-${points.length}`} style={{ height }} aria-label={ariaLabel} role="img" data={data as ChartData} options={options as ChartOptions} />
    </div>
  );
}
