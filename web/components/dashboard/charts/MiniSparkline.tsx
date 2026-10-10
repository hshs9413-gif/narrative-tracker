"use client";

import { CChartLine } from "@coreui/react-chartjs";
import type { ChartData, ChartOptions } from "chart.js";
import { formatShortDate } from "@/lib/formatters";

interface Props {
  labels: string[];
  values: (number | null)[];
  /** 선·끝점 색 — 위젯 배경에 맞춰 호출하는 쪽이 정한다 */
  stroke: string;
  format: (v: number) => string;
  stepped?: boolean;
  /** 급변 위치 — 점으로 표시 */
  jumps?: Set<number>;
  jumpColor?: string;
  ariaLabel: string;
}

/** CoreUI 위젯 카드 하단에 들어가는 축 없는 미니 라인 차트. */
export function MiniSparkline({ labels, values, stroke, format, stepped = false, jumps, jumpColor = "#ffffff", ariaLabel }: Props) {
  let last = values.length - 1;
  while (last > 0 && values[last] === null) last--;

  // 점 스타일은 함수가 아니라 배열로 넘긴다 — CChart는 데이터를 JSON으로 비교해 갱신하기 때문
  const radius = values.map((_, i) => (jumps?.has(i) ? 4 : i === last ? 3.5 : 0));
  const pointColor = values.map((_, i) => (jumps?.has(i) ? jumpColor : stroke));

  const present = values.filter((v): v is number => v !== null);
  const lo = Math.min(...present);
  const hi = Math.max(...present);
  const pad = (hi - lo || Math.abs(hi) * 0.05 || 1) * 0.15;

  const data: ChartData<"line"> = {
    labels,
    datasets: [
      {
        label: "값",
        data: values,
        borderColor: stroke,
        backgroundColor: "transparent",
        pointBackgroundColor: pointColor,
        pointBorderColor: pointColor,
        pointRadius: radius,
        pointHoverRadius: 4,
        borderWidth: 1.5,
        tension: stepped ? 0 : 0.3,
        stepped: stepped ? "before" : false,
        spanGaps: false,
      },
    ],
  };

  const options: ChartOptions<"line"> = {
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => formatShortDate(String(items[0]?.label ?? "")),
          label: (item) => (item.parsed.y === null ? "" : format(item.parsed.y)),
        },
      },
    },
    scales: {
      x: { display: false },
      y: { display: false, min: lo - pad, max: hi + pad },
    },
    layout: { padding: { left: 2, right: 6, top: 4, bottom: 4 } },
  };

  return (
    <CChartLine
      className="mx-3 mb-2"
      style={{ height: "64px" }}
      aria-label={ariaLabel}
      role="img"
      data={data as ChartData}
      options={options as ChartOptions}
    />
  );
}
