"use client";

import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { formatShortDate } from "@/lib/formatters";

export interface SparklinePoint {
  date: string;
  value: number | null;
}

interface ReferenceLine {
  value: number;
  label: string;
}

interface SparklineProps {
  title: ReactNode;
  /** aria-label·툴팁용 평문 이름 (title이 문자열이면 생략 가능) */
  name?: string;
  points: SparklinePoint[];
  formatValue: (value: number) => string;
  /** 단일 시계열이라 브랜드 색 하나로 충분 — 카테고리컬 팔레트 불필요. */
  color?: string;
  /** 기준금리처럼 결정일에만 바뀌는 값은 계단형으로 */
  stepped?: boolean;
  referenceLines?: ReferenceLine[];
  /** 헤더 값 옆 보조 문구 (예: "정점 대비 42%") */
  subtitle?: string;
  description?: string;
}

const W = 300;
const H = 88;
const PAD_X = 6;
const PAD_Y = 10;

export function Sparkline({
  title, name, points, formatValue, color = "var(--color-layer-cyclical)",
  stepped = false, referenceLines = [], subtitle, description,
}: SparklineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const label = name ?? (typeof title === "string" ? title : "");

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
  const lo = Math.min(min, ...referenceLines.map((r) => r.value));
  const hi = Math.max(max, ...referenceLines.map((r) => r.value));
  const domain = hi - lo || Math.abs(hi || 1) * 0.1;

  const xAt = (i: number) => PAD_X + (i * (W - 2 * PAD_X)) / Math.max(points.length - 1, 1);
  const yAt = (v: number) => H - PAD_Y - ((v - lo) / domain) * (H - 2 * PAD_Y);

  // null 지점에서 선을 끊어 결측을 그대로 보여준다 — 값 보간 안 함.
  const segments: string[] = [];
  let current = "";
  let prevY = 0;
  points.forEach((p, i) => {
    if (p.value === null) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    const x = xAt(i).toFixed(1);
    const y = yAt(p.value).toFixed(1);
    if (!current) current = `M${x},${y}`;
    else current += stepped ? ` L${x},${prevY.toFixed(1)} L${x},${y}` : ` L${x},${y}`;
    prevY = yAt(p.value);
  });
  if (current) segments.push(current);

  // 마지막 행이 비어 있을 수 있어(지표별 발표 지연) 값이 있는 마지막 점을 끝점으로 쓴다.
  let lastIndex = points.length - 1;
  while (lastIndex > 0 && points[lastIndex].value === null) lastIndex--;
  const last = points[lastIndex];
  const hovered = hoverIndex !== null ? points[hoverIndex] : null;

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const index = Math.round(((e.clientX - rect.left) / rect.width) * (points.length - 1));
    setHoverIndex(Math.min(Math.max(index, 0), points.length - 1));
  }

  const tooltipLeft = hoverIndex !== null ? Math.min(Math.max((xAt(hoverIndex) / W) * 100, 16), 84) : 0;

  return (
    <div className="rounded-xl border border-grid bg-surface p-4" title={description}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="truncate text-xs uppercase tracking-widest text-text-muted">{title}</span>
        {last.value !== null && (
          <span className="shrink-0 text-right">
            <span className="font-mono text-sm font-semibold">{formatValue(last.value)}</span>
            {subtitle && <span className="ml-1.5 text-xs text-text-muted">{subtitle}</span>}
          </span>
        )}
      </div>

      <div
        ref={containerRef}
        className="relative touch-pan-y"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-20 w-full"
          role="img"
          aria-label={`${label}: 최근 ${last.value !== null ? formatValue(last.value) : "없음"} (${formatShortDate(last.date)}), 구간 최저 ${formatValue(min)} 최고 ${formatValue(max)}`}
        >
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} x2={W} y1={PAD_Y + f * (H - 2 * PAD_Y)} y2={PAD_Y + f * (H - 2 * PAD_Y)}
              stroke="var(--color-grid)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}

          {referenceLines.map((r) => (
            <line key={r.label} x1={0} x2={W} y1={yAt(r.value)} y2={yAt(r.value)}
              stroke="var(--color-text-muted)" strokeOpacity={0.5} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}

          {segments.map((d, i) => (
            <path key={i} d={d} fill="none" stroke={color} strokeWidth={2}
              strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          ))}

          {last.value !== null && (
            <>
              <circle cx={xAt(lastIndex)} cy={yAt(last.value)} r={6} fill="var(--color-surface)" />
              <circle cx={xAt(lastIndex)} cy={yAt(last.value)} r={4} fill={color} />
            </>
          )}

          {hovered && hovered.value !== null && (
            <>
              <line x1={xAt(hoverIndex!)} x2={xAt(hoverIndex!)} y1={0} y2={H}
                stroke="var(--color-text-muted)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <circle cx={xAt(hoverIndex!)} cy={yAt(hovered.value)} r={6} fill="var(--color-surface)" />
              <circle cx={xAt(hoverIndex!)} cy={yAt(hovered.value)} r={4} fill={color} />
            </>
          )}
        </svg>

        {referenceLines.map((r) => (
          <span key={r.label} className="pointer-events-none absolute right-0 -translate-y-full text-[10px] text-text-muted"
            style={{ top: `${(yAt(r.value) / H) * 100}%` }}>
            {r.label}
          </span>
        ))}

        {hovered && hovered.value !== null && (
          <div
            className="pointer-events-none absolute top-0 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-grid bg-surface-raised px-2 py-1 text-xs"
            style={{ left: `${tooltipLeft}%` }}
          >
            <strong className="text-text-primary">{formatValue(hovered.value)}</strong>{" "}
            <span className="text-text-muted">{formatShortDate(hovered.date)}</span>
          </div>
        )}
      </div>

      <p className="mt-2 flex justify-between gap-2 text-xs text-text-muted">
        <span>{formatShortDate(points[0].date)} ~ {formatShortDate(last.date)}</span>
        <span>저 {formatValue(min)} · 고 {formatValue(max)}</span>
      </p>
    </div>
  );
}
