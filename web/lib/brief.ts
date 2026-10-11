import type { NarrativeLogEntry, RegimeState } from "@/types/dashboard";

// 아침 브리핑 화면(판정 문장·근거·내러티브·갱신 기록)이 쓰는 문구와 단계 계산.

const GI_PHRASE: Record<string, string> = {
  "골디락스": "성장은 오르고 물가는 식는 골디락스",
  "인플레이션 레짐": "성장과 물가가 함께 오르는 인플레이션 레짐",
  "스태그플레이션": "성장은 식고 물가는 오르는 스태그플레이션",
  "청산·디플레충격": "성장과 물가가 함께 꺾이는 청산 국면",
};
const POLICY_PHRASE: Record<string, string> = { "긴축": "연준은 긴축 중", "완화": "연준은 완화 중", "중립": "연준은 관망 중" };
const CREDIT_PHRASE: Record<string, string> = {
  "평상": "신용시장은 아직 평온합니다.",
  "경계": "신용시장에 경계 신호가 켜졌습니다.",
  "경색": "신용시장이 경색되고 있습니다.",
  "시스템위기": "신용시장이 위기 수준입니다.",
};

/** 오늘의 판정 한 문장 — 세 축 라벨을 사람이 읽는 말로 */
export function verdictSentence(s: RegimeState): string {
  const gi = GI_PHRASE[s.growth_inflation.label] ?? "성장·물가 판정은 보류";
  const ps = POLICY_PHRASE[s.policy_stance.label] ?? "정책 판정은 보류";
  const cs = CREDIT_PHRASE[s.credit_stress.label] ?? "신용 판정은 보류했습니다.";
  return `${gi}, ${ps}. ${cs}`;
}

/** 축별 상태를 0(평온)~3(위험) 단계로 — 색 하나로 같은 의미를 쓰기 위해. 판정 보류는 null */
export function axisLevel(axis: "gi" | "credit" | "policy" | "kospi", s: RegimeState): number | null {
  switch (axis) {
    case "gi":
      return ({ "골디락스": 0, "인플레이션 레짐": 1, "청산·디플레충격": 2, "스태그플레이션": 3 } as Record<string, number>)[s.growth_inflation.label] ?? null;
    case "credit":
      return s.credit_stress.level_index ?? null;
    case "policy":
      return ({ "완화": 0, "중립": 0, "긴축": 1 } as Record<string, number>)[s.policy_stance.label] ?? null;
    case "kospi":
      return s.kospi_vol?.level_index ?? null;
  }
}

/** 판정 시각(KST) — '10월 11일 일요일 아침' */
export function briefStamp(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "long", hour: "numeric", hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour"));
  const when = hour < 12 ? "아침" : hour < 18 ? "오후" : "밤";
  return `${get("month")} ${get("day")}일 ${get("weekday")} ${when}`;
}

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

/** 근거 링크에 보여줄 이름 — 매체명이 없으면 주소의 도메인 */
export function sourceName(ev: { source: string; url: string }): string {
  if (ev.source) return ev.source;
  try {
    return new URL(ev.url).hostname.replace(/^www\./, "");
  } catch {
    return "출처";
  }
}
