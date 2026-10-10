// 신용스트레스·정책기조 배지 공용 컴포넌트. "미확인"이거나 colorMap에 없는 라벨이면 회색으로 폴백 —
// 색 매핑이 없다고 에러가 나거나 안 보이면 안 된다. 글자는 본문색, 색은 점·테두리에만 써서 밝은 노랑도 읽힌다.

interface RegimeBadgeProps {
  label: string;
  colorMap: Record<string, string>;
  /** 무엇에 대한 값인지 — "평상"만 있으면 신용인지 정책인지 알 수 없다 */
  caption?: string;
}

export function RegimeBadge({ label, colorMap, caption }: RegimeBadgeProps) {
  const known = label in colorMap;
  const color = known ? colorMap[label] : "var(--cui-secondary-color)";

  return (
    <span
      className="d-inline-flex align-items-center gap-2 rounded-pill border px-3 py-1 small fw-semibold bg-body"
      style={{ borderColor: color }}
    >
      <span className="nt-dot m-0" style={{ background: color, opacity: known ? 1 : 0.5 }} />
      {caption && <span className="text-body-secondary fw-normal">{caption}</span>}
      {label}
    </span>
  );
}
