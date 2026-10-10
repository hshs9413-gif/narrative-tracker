"""
금융위원회 기업기본정보·기업 재무정보 API 점검 — 데이터 파일은 쓰지 않는다.

GitHub Actions에서 저장소 Secret으로 실제 API를 불러, 키 인식·응답 필드 이름·사업자등록번호 검색 가능 여부를
작업 주석(annotation)으로 남긴다. 표본 기업: 삼성전자 (법인 130111-0006246 / 사업자 124-81-00998).

    DATA_GO_KR_KEY=... python scripts/fsc_check.py
"""

import os
import sys

import fsc_api

SAMPLE_CRNO = "1301110006246"
SAMPLE_BZNO = "1248100998"
SAMPLE_NAME = "삼성전자"
# 워크플로우가 후보 이름들을 C_<이름> 환경변수로 넘긴다 — 키를 어떤 이름으로 저장했는지 찾기 위함
CANDIDATE_PREFIX = "C_"


def notice(title, msg, level="notice"):
    msg = str(msg).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    print(f"::{level} title={title}::{msg[:3500]}")


def pick_key():
    if fsc_api.service_key():
        return "DATA_GO_KR_KEY"
    for name, value in sorted(os.environ.items()):
        if name.startswith(CANDIDATE_PREFIX) and value.strip():
            os.environ["DATA_GO_KR_KEY"] = value
            return name[len(CANDIDATE_PREFIX):]
    return None


def brief(item, keys):
    return ", ".join(f"{k}={item.get(k)}" for k in keys if k in item)


def main():
    name = pick_key()
    if not name:
        notice("fsc-key", "DATA_GO_KR_KEY(및 후보 이름) 어느 것도 워크플로우에 전달되지 않음", "error")
        return 1
    raw = fsc_api._raw_key()
    notice("fsc-key", f"키 이름 {name} · 길이 {len(raw)} · % 포함={'%' in raw}")

    C, F = fsc_api.CORP_SERVICE, fsc_api.FINA_SERVICE
    failures = 0
    probes = [
        ("outline-crno", C, "getCorpOutline_V2", {"crno": SAMPLE_CRNO}),
        ("outline-bzno", C, "getCorpOutline_V2", {"bzno": SAMPLE_BZNO}),
        ("outline-name", C, "getCorpOutline_V2", {"corpNm": SAMPLE_NAME}),
        ("summ", F, "getSummFinaStat_V2", {"crno": SAMPLE_CRNO}),
        ("bs", F, "getBs_V2", {"crno": SAMPLE_CRNO, "bizYear": "2024"}),
        ("inco", F, "getIncoStat_V2", {"crno": SAMPLE_CRNO, "bizYear": "2024"}),
    ]
    for title, service, op, params in probes:
        try:
            items, total = fsc_api.call(service, op, params, num_rows=30)
        except fsc_api.FscError as e:
            notice(title, f"{op} {params} 실패 — {e}", "warning")
            failures += 1
            continue
        if not items:
            notice(title, f"{op} {params} → 0건 (totalCount={total})")
            continue
        first = items[0]
        fields = ", ".join(sorted(first.keys()))
        if title.startswith("outline"):
            sample = " | ".join(brief(i, ["corpNm", "crno", "bzno"]) for i in items[:4])
        elif title == "summ":
            years = sorted({str(i.get("bizYear")) for i in items})
            latest = max(items, key=lambda i: (str(i.get("bizYear")), str(i.get("fnclDcd"))))
            sample = f"연도 {years} | 최신 행: " + ", ".join(f"{k}={v}" for k, v in latest.items())
        else:
            sample = " | ".join(brief(i, ["fnclDcd", "acitId", "acitNm", "crtmAcitAmt", "pvtrAcitAmt"]) for i in items[:5])
        notice(title, f"{op} {params} → totalCount={total}\n필드: {fields}\n표본: {sample}")
    return 1 if failures == len(probes) else 0


if __name__ == "__main__":
    sys.exit(main())
