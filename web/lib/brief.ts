import type { NarrativeLogEntry } from "@/types/dashboard";

// 화면 문구 도우미 — 날짜 표기, 내러티브 단계·강도 낱말, 변경 기록 문장.

/** '2026-10-09' → '10월 9일' */
export function monthDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${Number(m)}월 ${Number(d)}일`;
}

export const PHASE_WORD: Record<string, string> = {
  shock: "충격",
  policy: "정책 대응",
  overshoot: "과열",
  side_effect: "부작용",
  correction: "진정",
};
export const INTENSITY_WORD: Record<string, string> = { high: "강", mid: "중", low: "약" };
export const STATUS_WORD: Record<string, string> = { active: "진행", dormant: "잠잠", ended: "끝남", candidate: "후보" };

export const ACTOR: Record<string, string> = { gemini: "Gemini", rule: "규칙", claude: "검증", human: "직접 수정" };

/** 받침에 맞춘 '로/으로' — '끝남으로', '진행으로', '강로'가 아니라 '강으로' */
export function ro(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return `${word}로`;
  const jong = (last - 0xac00) % 28;
  return jong === 0 || jong === 8 ? `${word}로` : `${word}으로`;
}

type Names = Record<string, string>;
const FIELD_WORD: Record<string, (a: unknown, b: unknown, names: Names) => string> = {
  status: (a, b) => (b === "ended" ? "끝남으로 정리" : `상태 ${STATUS_WORD[String(a)] ?? a}에서 ${ro(STATUS_WORD[String(b)] ?? String(b))}`),
  phase: (a, b) => `단계 ${PHASE_WORD[String(a)] ?? a}에서 ${ro(PHASE_WORD[String(b)] ?? String(b))}`,
  intensity: (a, b) => `강도 ${INTENSITY_WORD[String(a)] ?? a}에서 ${ro(INTENSITY_WORD[String(b)] ?? String(b))}`,
  peak_date: (a, b) => `고점일 ${a ? monthDay(String(a)) : "없음"}에서 ${ro(monthDay(String(b)))}`,
  keywords: (_a, b) => `검색어를 ${ro((b as string[]).join(", "))} 교체`,
  notes: (_a, b) => (typeof b === "string" && b !== "…" ? `메모: ${b}` : "메모 추가"),
  merged_into: (_a, b, names) => `'${names[String(b)] ?? b}'에 합침`,
  name: (_a, b) => `이름을 '${b}'로`,
  ism_pmi: (a, b) => `${a}에서 ${ro(String(b))}`,
};

/** 기록 한 줄에서 '무엇이 바뀌었나'를 문장 조각 목록으로 */
export function describeChanges(entry: NarrativeLogEntry, names: Names = {}): string[] {
  if (entry.kind === "new") return [`새 내러티브 추가`];
  return Object.entries(entry.changes ?? {}).map(([k, [a, b]]) => (FIELD_WORD[k] ? FIELD_WORD[k](a, b, names) : `${k} 변경`));
}

/** 그날 판정 집계 — '유지 7 · 잠잠 1' */
export function verdictTally(reviews: Record<string, string> | undefined): string {
  const order = ["추가", "강화", "약화", "재점화", "잠잠", "종료", "병합", "유지", "갱신"];
  const count: Record<string, number> = {};
  for (const v of Object.values(reviews ?? {})) count[v] = (count[v] ?? 0) + 1;
  return Object.entries(count)
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([v, n]) => `${v} ${n}`)
    .join(" · ");
}

/** 근거 링크에 보여줄 이름 — 매체명이 없으면 주소의 도메인 */
export function sourceName(ev: { source: string; url: string }): string {
  if (ev.source) return ev.source;
  try {
    return new URL(ev.url).hostname.replace(/^www\./, "");
  } catch {
    return "출처";
  }
}
