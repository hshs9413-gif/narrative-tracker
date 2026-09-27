"use client";

import { useRef, useState, type PointerEvent } from "react";
import { formatDate } from "@/lib/formatters";

interface SparklinePoint {
  date: string;
  value: number | null;
}

interface SparklineProps {
  title: string;
  points: SparklinePoint[];
  formatValue: (value: number) => string;
  /** 기본값은 기존 팔레트의 layer-cyclical 톤 — 이 차트들은 전부 단일 시계열이라
   * (dataviz 컨벤션상 "1-3 series는 색 하나로 충분") 카테고리컬 팔레트를 새로
   * 만들 필요 없이 브랜드 색 하나를 재사용한다. */
  color?: string;
}

const W = 300;
const H = 88;
const PAD_X = 6;
const PAD_Y = 10;

export function Sparkline({ title, points, formatValue, color = "var(--color-layer-cyclical)" }: SparklineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const values = points.map((p) => p.value).filter((v): v is number => v !== null);

  if (values.length === 0) {
    return (
      <div className="rounded-xl border border-grid bg-surface p-4">
        <span className="text-xs uppercase tracking-widest text-text-muted">{title}</span>
        <p className="mt-4 text-sm text-text-muted">데이터 없음</p>
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const domain = max - min || Math.abs(max || 1) * 0.1;

  const xAt = (i: number) => PAD_X + (i * (W - 2 * PAD_X)) / Math.max(points.length - 1, 1);
  const yAt = (v: number) => H - PAD_Y - ((v - min) / domain) * (H - 2 * PAD_Y);

  // null 지점에서 선을 끊어서 결측을 있는 그대로 보여준다 — 값 보간 안 함.
  const segments: string[] = [];
  let current = "";
  points.forEach((p, i) => {
    if (p.value === null) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    current += `${current ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)} `;
  });
  if (current) segments.push(current);

  const lastIndex = points.length - 1;
  const lastValue = points[lastIndex].value;
  const hovered = hoverIndex !== null ? points[hoverIndex] : null;

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const fraction = (e.clientX - rect.left) / rect.width;
    const index = Math.round(fraction * (points.length - 1));
    setHoverIndex(Math.min(Math.max(index, 0), points.length - 1));
  }

  return (
    <div className="rounded-xl border border-grid bg-surface p-4">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs uppercase tracking-widest text-text-muted">{title}</span>
        {lastValue !== null && <span className="font-mono text-sm font-semibold">{formatValue(lastValue)}</span>}
      </div>

      <div
        ref={containerRef}
        className="relative touch-none"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-20 w-full">
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1={0}
              x2={W}
              y1={PAD_Y + f * (H - 2 * PAD_Y)}
              y2={PAD_Y + f * (H - 2 * PAD_Y)}
              stroke="var(--color-grid)"
              strokeWidth={1}
            />
          ))}

          {segments.map((d, i) => (
            <path key={i} d={d.trim()} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          ))}

          {lastValue !== null && (
            <>
              <circle cx={xAt(lastIndex)} cy={yAt(lastValue)} r={6} fill="var(--color-surface)" />
              <circle cx={xAt(lastIndex)} cy={yAt(lastValue)} r={4} fill={color} />
            </>
          )}

          {hovered && hovered.value !== null && (
            <>
              <line x1={xAt(hoverIndex!)} x2={xAt(hoverIndex!)} y1={0} y2={H} stroke="var(--color-grid)" strokeWidth={1} />
              <circle cx={xAt(hoverIndex!)} cy={yAt(hovered.value)} r={6} fill="var(--color-surface)" />
              <circle cx={xAt(hoverIndex!)} cy={yAt(hovered.value)} r={4} fill={color} />
            </>
          )}
        </svg>

        {hovered && hovered.value !== null && (
          <div
            className="pointer-events-none absolute top-0 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-grid bg-surface-raised px-2 py-1 text-xs"
            style={{ left: `${(xAt(hoverIndex!) / W) * 100}%` }}
          >
            <span className="text-text-muted">{formatDate(hovered.date, { month: "2-digit", day: "2-digit" })}</span>{" "}
            <strong className="text-text-primary">{formatValue(hovered.value)}</strong>
          </div>
        )}
      </div>

      <p className="mt-2 text-xs text-text-muted">
        {points.length}일 범위 {formatValue(min)} ~ {formatValue(max)}
      </p>
    </div>
  );
}
