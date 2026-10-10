/** 축 없는 작은 선 그래프 — SVG라 테마 변수(currentColor·CSS 변수)를 그대로 따라간다. */
interface Props {
  values: (number | null)[];
  /** 계단형(기준금리처럼 결정 때만 바뀌는 값) */
  stepped?: boolean;
  width?: number;
  height?: number;
  /** 보조 수평선(임계값 등) — 값 기준 */
  guides?: number[];
  label: string;
  className?: string;
}

export function Sparkline({ values, stepped = false, width = 160, height = 36, guides = [], label, className }: Props) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null && Number.isFinite(p.v));
  if (pts.length < 2) return <span className="nt-spark-empty">데이터 부족</span>;

  const all = [...pts.map((p) => p.v), ...guides];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || Math.abs(hi) * 0.05 || 1;
  const pad = 3;
  const x = (i: number) => pad + (i / Math.max(1, values.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (height - pad * 2);

  let d = "";
  pts.forEach((p, k) => {
    if (k === 0) d += `M${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`;
    else if (stepped) d += `H${x(p.i).toFixed(1)}V${y(p.v).toFixed(1)}`;
    else d += `L${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`;
  });
  const last = pts[pts.length - 1];

  return (
    <svg className={`nt-spark ${className ?? ""}`} viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label}>
      {guides.map((g) => (
        <line key={g} x1={pad} x2={width - pad} y1={y(g)} y2={y(g)} className="nt-spark-guide" />
      ))}
      <path d={d} className="nt-spark-line" />
      <circle cx={x(last.i)} cy={y(last.v)} r={2.6} className="nt-spark-dot" />
    </svg>
  );
}
