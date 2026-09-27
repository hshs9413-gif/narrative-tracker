// 신용스트레스·정책기조 배지 공용 컴포넌트. "미확인"이거나 colorMap에 없는
// 라벨이면 회색(text-muted)으로 폴백 — 색 매핑 없다고 에러나거나 안 보이면 안 됨.

interface RegimeBadgeProps {
  label: string;
  colorMap: Record<string, string>;
  size?: "sm" | "md";
}

export function RegimeBadge({ label, colorMap, size = "md" }: RegimeBadgeProps) {
  const color = colorMap[label] ?? "var(--color-text-muted)";
  const isUnknown = !(label in colorMap);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-grid
        ${size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"}`}
      style={{ color, borderColor: isUnknown ? undefined : color }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: color, opacity: isUnknown ? 0.5 : 1 }}
      />
      {label}
    </span>
  );
}
