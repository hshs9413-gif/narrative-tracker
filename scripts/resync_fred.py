"""
CSV의 FRED 컬럼을 FRED 공식 API 원본과 대조하고(--dry-run), 다르면 FRED 값으로 맞춘다.

    FRED_API_KEY=... python scripts/resync_fred.py --columns vix --dry-run   # 대조만
    FRED_API_KEY=... python scripts/resync_fred.py --columns vix             # 맞추기

- 기존 행(날짜)만 다룬다 — 행을 새로 만들거나 지우지 않는다.
- 일간 시리즈: FRED 값이 있는 날은 FRED 값으로, FRED에 관측이 없는 날(휴장 등)인데 CSV에 값이 있으면 비운다.
- 계단형·주간 시리즈(STEP_COLUMNS)는 앞 값으로 채워 둔 것이라 FRED 관측일 값만 대조·수정한다.
결과는 GitHub Actions 주석(::notice)으로도 남긴다.
"""

import argparse
import csv
import datetime
import os
import sys

import fred_api
from backfill_market_data import FDR_SYMBOLS, OUT_PATH, STEP_COLUMNS

TOLERANCE = 0.005  # CSV는 소수 둘째 자리 반올림


def notice(title, msg):
    msg = str(msg).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    print(f"::notice title={title}::{msg[:3500]}")


def compare(rows, column, fred):
    """rows의 column을 FRED 시리즈(dict date→value)와 비교 → (변경목록, 통계)."""
    step = column in STEP_COLUMNS
    changes, stats = [], {"same": 0, "differ": 0, "filled": 0, "cleared": 0}
    for r in rows:
        d = datetime.date.fromisoformat(r["date"])
        old = r.get(column, "")
        if d in fred:
            new = round(fred[d], 2)
            if old == "":
                stats["filled"] += 1
                changes.append((r["date"], old, new))
            elif abs(float(old) - new) > TOLERANCE:
                stats["differ"] += 1
                changes.append((r["date"], old, new))
            else:
                stats["same"] += 1
        elif old != "" and not step:
            stats["cleared"] += 1
            changes.append((r["date"], old, ""))
    return changes, stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--columns", type=lambda v: [c for c in v.split(",") if c], default=[])
    ap.add_argument("--all-fred", action="store_true", help="FDR_SYMBOLS의 FRED 컬럼 전부")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--csv", default=OUT_PATH)
    args = ap.parse_args()
    if args.all_fred:
        args.columns = [c for c, sym in FDR_SYMBOLS.items() if sym.startswith("FRED:")]
    if not args.columns:
        ap.error("--columns 또는 --all-fred가 필요합니다")

    if not fred_api.api_key():
        sys.exit("[ERROR] FRED_API_KEY가 없습니다.")
    with open(args.csv, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames
        rows = list(reader)
    if not rows:
        sys.exit("[ERROR] CSV가 비어 있습니다.")

    start = datetime.date.fromisoformat(rows[0]["date"])
    end = datetime.date.today()
    total_changes = 0
    summaries = []
    for column in args.columns:
        symbol = FDR_SYMBOLS.get(column, "")
        if not symbol.startswith("FRED:"):
            sys.exit(f"[ERROR] {column}은 FRED 컬럼이 아닙니다 ({symbol or '없음'}).")
        series_id = symbol.split(":", 1)[1]
        s = fred_api.observations(series_id, start, end)
        fred = {d: float(v) for d, v in s.items()}
        changes, stats = compare(rows, column, fred)
        total_changes += len(changes)
        sample = "; ".join(f"{d}: {o or '빈칸'}→{n if n != '' else '빈칸'}" for d, o, n in changes[:12])
        msg = (f"{column} vs FRED {series_id} ({rows[0]['date']}~{rows[-1]['date']}, FRED {len(fred)}건) — "
               f"일치 {stats['same']} · 값 다름 {stats['differ']} · 빈칸 채움 {stats['filled']} · "
               f"FRED에 없는 날 값 {stats['cleared']}" + (f"\n예: {sample}" if sample else ""))
        print(msg)
        summaries.append(msg if len(args.columns) == 1 else msg.split("\n")[0])
        if not args.dry_run:
            for d, _, new in changes:
                for r in rows:
                    if r["date"] == d:
                        r[column] = "" if new == "" else str(float(new))
                        break

    # 주석은 단계당 개수 제한이 있어 한 건으로 모은다
    notice("resync-fred", ("[dry-run] " if args.dry_run else "") + "\n".join(summaries))

    if args.dry_run or not total_changes:
        print("[INFO] 파일을 쓰지 않았습니다." if args.dry_run else "[INFO] 바꿀 값이 없습니다.")
        return
    with open(args.csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=header, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"[INFO] {args.csv} 저장 — {total_changes}칸 수정")


if __name__ == "__main__":
    main()
