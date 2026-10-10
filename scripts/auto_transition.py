"""
이벤트 상태 자동 전환기 (매일 수집 워크플로우에서 실행)

명백한 케이스만 규칙으로 자동 전환한다. LLM을 쓰지 않는 순수 정량 판정이다.
전환 내역은 이벤트의 "last_auto" 필드와 git 이력에 남는다 (GitHub Issue 알림은 2026-10에 없앰 —
처리되지 않은 Issue만 쌓였기 때문).

[전환 규칙 — 보수적으로 설계]
  active → dormant (휴면 전환):
    - 관측일수 10일 이상
    - 역대 정점(7일 이동평균 최대) ≥ 10건/일  (표본이 너무 작으면 판정 보류)
    - 최근 7개 관측치가 모두 정점의 15% 미만
  dormant → active (재점화):
    - 최근 3개 관측치가 모두 정점의 50% 이상
    - 최근값 ≥ 10건/일

[사용자 통제]
  - events.json에서 "auto_lock": true 를 추가하면 해당 이벤트는 자동 전환에서 제외
  - 전환이 잘못됐다면 status를 되돌리고 auto_lock을 켜면 된다
  - 자동 전환 이력은 "last_auto" 필드에 기록

애매한 구간(정점 대비 15~50%)은 건드리지 않는다 — 대시보드 언급량 차트로 보고 사람이 판단한다.
"""

import csv
import datetime
import json
import os
import statistics
from collections import defaultdict

BASE = os.path.dirname(__file__)
EVENTS_PATH = os.path.join(BASE, "..", "docs", "data", "events.json")
ATTENTION_PATH = os.path.join(BASE, "..", "docs", "data", "attention.csv")

DORMANT_MIN_DAYS = 10       # 휴면 판정 최소 관측일
DORMANT_RATIO = 0.15        # 정점 대비 이 비율 미만이
DORMANT_STREAK = 7          # 이만큼 연속이면 휴면
PEAK_FLOOR = 10             # 정점이 이보다 작으면 판정 보류 (노이즈 방지)
REACTIVATE_RATIO = 0.50     # 재점화: 정점 대비 이 비율 이상이
REACTIVATE_STREAK = 3       # 이만큼 연속이고
REACTIVATE_FLOOR = 10       # 최근값이 이 이상이면 활성 복귀


def load_series():
    by_event = defaultdict(list)
    if not os.path.exists(ATTENTION_PATH):
        return by_event
    with open(ATTENTION_PATH, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                by_event[r["event_id"]].append((r["date"], float(r["count"])))
            except (ValueError, KeyError):
                continue
    for k in by_event:
        by_event[k].sort()
    return by_event


def rolling7_peak(counts):
    """7일 이동평균의 최대값과 그 날짜 인덱스."""
    peaks = [statistics.mean(counts[max(0, i - 6):i + 1]) for i in range(len(counts))]
    m = max(peaks)
    return m, peaks.index(m), peaks


def evaluate(event, series):
    """전환 필요 여부를 판정한다. 반환: (새 status 또는 None, 근거 dict)"""
    if event.get("auto_lock"):
        return None, {"사유": "auto_lock 설정으로 제외"}
    if event.get("status") == "ended":
        return None, {"사유": "종료 이벤트"}

    dates = [d for d, _ in series]
    counts = [c for _, c in series]
    n = len(counts)
    if n < 3:
        return None, {"사유": f"데이터 부족 ({n}일)"}

    peak, peak_i, peaks = rolling7_peak(counts)
    evidence = {
        "관측일수": n,
        "정점7일평균": round(peak, 1),
        "정점일": dates[peak_i],
        "최근값": counts[-1],
        "최근7일": counts[-7:],
    }

    if peak < PEAK_FLOOR:
        evidence["사유"] = f"정점 {peak:.1f} < {PEAK_FLOOR} — 표본 부족으로 판정 보류"
        return None, evidence

    status = event.get("status")

    if status == "active":
        if n >= DORMANT_MIN_DAYS:
            recent = counts[-DORMANT_STREAK:]
            if len(recent) == DORMANT_STREAK and all(c < peak * DORMANT_RATIO for c in recent):
                evidence["사유"] = (f"최근 {DORMANT_STREAK}일 모두 정점의 "
                                  f"{DORMANT_RATIO:.0%} 미만 → 휴면 전환")
                return "dormant", evidence
        evidence["사유"] = "휴면 조건 미충족 — active 유지"
        return None, evidence

    if status == "dormant":
        recent = counts[-REACTIVATE_STREAK:]
        if (len(recent) == REACTIVATE_STREAK
                and all(c >= peak * REACTIVATE_RATIO for c in recent)
                and counts[-1] >= REACTIVATE_FLOOR):
            evidence["사유"] = (f"최근 {REACTIVATE_STREAK}일 모두 정점의 "
                              f"{REACTIVATE_RATIO:.0%} 이상 → 재점화")
            return "active", evidence
        evidence["사유"] = "재점화 조건 미충족 — dormant 유지"
        return None, evidence

    return None, evidence


def first_half_life_date(dates, peaks, peak):
    """7일 평균이 정점의 50% 아래로 처음 내려간 날 (반감기)."""
    peak_i = peaks.index(peak)
    for i in range(peak_i + 1, len(peaks)):
        if peaks[i] < peak * 0.5:
            return dates[i]
    return datetime.date.today().isoformat()


def main():
    with open(EVENTS_PATH, encoding="utf-8") as f:
        events = json.load(f)

    series_map = load_series()
    changes = []

    for e in events:
        series = series_map.get(e["id"], [])
        new_status, evidence = evaluate(e, series)
        label = f"{e['id']:26} {e.get('status','?'):8}"
        if new_status is None:
            print(f"[SKIP] {label} — {evidence.get('사유','')}")
            continue

        old = e["status"]
        e["status"] = new_status
        e["last_auto"] = {"date": datetime.date.today().isoformat(),
                          "change": f"{old}->{new_status}"}
        if new_status == "dormant" and not e.get("half_life_date"):
            dates = [d for d, _ in series]
            counts = [c for _, c in series]
            peak, _, peaks = rolling7_peak(counts)
            e["half_life_date"] = first_half_life_date(dates, peaks, peak)
        if new_status == "active":
            e["half_life_date"] = None   # 재점화 시 반감기 초기화

        print(f"[CHANGE] {label} → {new_status} ({evidence.get('사유','')})")
        changes.append({"event": e, "old": old, "new": new_status, "evidence": evidence})

    if not changes:
        print("[INFO] 자동 전환 대상 없음.")
        return

    with open(EVENTS_PATH, "w", encoding="utf-8") as f:
        json.dump(events, f, ensure_ascii=False, indent=2)
    print(f"[INFO] events.json 갱신 ({len(changes)}건 전환).")


if __name__ == "__main__":
    main()
