"""
기업 재무정보 수집 (금융위원회 API) → docs/data/financials/

조회 대상은 config/companies.json 목록이다. 사업자등록번호(10자리)나 법인등록번호(13자리)로 추가할 수 있다.

    python scripts/collect_financials.py                         # 목록 전체 갱신
    python scripts/collect_financials.py --add 130111-0006246    # 법인등록번호로 추가 후 수집
    python scripts/collect_financials.py --add 124-81-00998 --name 삼성전자   # 사업자등록번호로 추가

번호 → 기업 식별
  - 재무정보 API는 법인등록번호(crno)로만 조회된다.
  - 사업자등록번호(bzno)는 기업기본정보 API(getCorpOutline_V2)로 법인등록번호를 찾는다. 이 API는 공식 문서상
    법인등록번호·회사명으로 검색하므로, bzno로 바로 안 찾아지면 회사명(--name)으로 검색한 결과에서 bzno가 같은 것을 고른다.
  - 기업기본정보 API는 공공데이터포털에서 '금융위원회_기업기본정보'를 따로 활용신청해야 한다 (같은 인증키 사용).
    신청 전에는 법인등록번호로만 추가할 수 있고, 회사명은 --name 또는 번호로 표시된다.

출력
  docs/data/financials/index.json        목록 (회사명·법인번호·사업자번호·연도 범위·갱신 시각)
  docs/data/financials/<법인번호>.json    요약재무제표(연도별·연결/별도) + 최신 연도 재무상태표·손익계산서 계정

키: 환경변수 DATA_GO_KR_KEY (저장소 Secret). 의존성: requests
"""

import argparse
import datetime
import json
import os
import sys

import fsc_api
from fsc_api import CORP_SERVICE, FINA_SERVICE, FscError, digits, kind_of

BASE = os.path.dirname(__file__)
CONFIG_PATH = os.path.join(BASE, "..", "config", "companies.json")
OUT_DIR = os.path.join(BASE, "..", "docs", "data", "financials")

# 요약재무제표 응답 필드 → 저장 이름 (2026-10-10 실제 응답으로 확인: scripts/fsc_check.py)
SUMMARY_FIELDS = {
    "enpSaleAmt": "revenue",           # 매출액
    "enpBzopPft": "operating_income",  # 영업이익
    "enpCrtmNpf": "net_income",        # 당기순이익
    "iclsPalClcAmt": "comprehensive_income",  # 포괄손익
    "enpTastAmt": "assets",            # 자산총계
    "enpTdbtAmt": "liabilities",       # 부채총계
    "enpTcptAmt": "equity",            # 자본총계
    "enpCptlAmt": "capital",           # 자본금
    "fnclDebtRto": "debt_ratio",       # 부채비율(%)
}


def notice(level, title, msg):
    msg = str(msg).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    print(f"::{level} title={title}::{msg}")


def to_number(v):
    if v in (None, "", "-"):
        return None
    try:
        f = float(str(v).replace(",", ""))
    except ValueError:
        return None
    return int(f) if f.is_integer() and abs(f) > 1000 else round(f, 4)


def basis_of(code, name):
    """연결/별도 구분 — 요약은 fnclDcdNm('연결요약재무제표'), 계정표는 fnclDcd('…ConsolidatedMember')."""
    text = f"{code} {name}"
    if "연결" in text or "Consolidated" in text:
        return "연결"
    if "별도" in text or "개별" in text or "Separate" in text:
        return "별도"
    return name or str(code)


# ── 기업 식별 ──

FILTER_IGNORED_TOTAL = 5000  # 검색 조건이 무시되면 전체 법인 수만큼 나온다 — 이보다 많으면 '조건 미지원'으로 본다


def outline_by(params):
    """기업기본정보 검색. 조건이 무시된 응답(전체 목록)이면 빈 목록."""
    items, total = fsc_api.call(CORP_SERVICE, "getCorpOutline_V2", params, num_rows=100)
    if total is not None and total > FILTER_IGNORED_TOTAL:
        fsc_api.log(f"[INFO] getCorpOutline_V2 {list(params)} 조건으로는 걸러지지 않음 (totalCount={total})")
        return []
    if total and total > len(items):
        items += fsc_api.call_all(CORP_SERVICE, "getCorpOutline_V2", params, num_rows=100, max_pages=3)[len(items):]
    return items


def resolve(number, name=None):
    """번호(사업자/법인) → {crno, bzno, name}. 못 찾으면 FscError."""
    kind = kind_of(number)
    d = digits(number)
    if kind == "crno":
        info = {"crno": d, "bzno": None, "name": name}
        try:
            items = outline_by({"crno": d})
        except FscError as e:
            fsc_api.log(f"[WARN] 기업기본정보 조회 실패({e}) — 법인등록번호만으로 진행")
            items = []
        match = next((i for i in items if digits(i.get("crno")) == d), None)
        if match:
            info["bzno"] = digits(match.get("bzno")) or None
            info["name"] = name or match.get("corpNm")
        return info

    if kind == "bzno":
        # 1) bzno로 바로 검색 (문서에 없는 검색 조건이라 무시되면 엉뚱한 결과가 오므로 bzno 일치로 거른다)
        items = []
        try:
            items = outline_by({"bzno": d})
        except FscError as e:
            raise FscError(f"사업자등록번호로 찾으려면 '금융위원회_기업기본정보' 활용신청이 필요합니다 ({e})") from None
        match = next((i for i in items if digits(i.get("bzno")) == d), None)
        # 2) 회사명으로 검색해 bzno가 같은 것
        if not match and name:
            items = outline_by({"corpNm": name})
            match = next((i for i in items if digits(i.get("bzno")) == d), None)
        if not match:
            hint = "" if name else " — 회사명(name)도 함께 입력해 다시 실행하세요"
            raise FscError(f"사업자등록번호 {fsc_api.fmt_bzno(d)}에 해당하는 법인을 찾지 못했습니다{hint}")
        return {"crno": digits(match.get("crno")), "bzno": d, "name": name or match.get("corpNm")}

    raise FscError(f"'{number}' — 사업자등록번호(10자리) 또는 법인등록번호(13자리)가 아닙니다")


# ── 재무 수집 ──

def fetch_summary(crno):
    items = fsc_api.call_all(FINA_SERVICE, "getSummFinaStat_V2", {"crno": crno}, num_rows=100)
    rows = []
    for i in items:
        row = {
            "year": str(i.get("bizYear")),
            "basis": basis_of(i.get("fnclDcd"), i.get("fnclDcdNm")),
            "basis_name": i.get("fnclDcdNm"),
            "as_of": i.get("basDt"),
            "currency": i.get("curCd"),
        }
        for src, dst in SUMMARY_FIELDS.items():
            row[dst] = to_number(i.get(src))
        rows.append(row)
    rows.sort(key=lambda r: (r["year"], r["basis"]))
    return rows


def fetch_accounts(operation, crno, year):
    items = fsc_api.call_all(FINA_SERVICE, operation, {"crno": crno, "bizYear": year}, num_rows=100)
    return [
        {
            "basis": basis_of(i.get("fnclDcd"), i.get("fnclDcdNm")),
            "account_id": i.get("acitId"),
            "account": i.get("acitNm"),
            "current": to_number(i.get("crtmAcitAmt")),      # 당기
            "previous": to_number(i.get("pvtrAcitAmt")),     # 전기
            "before_previous": to_number(i.get("bpvtrAcitAmt")),  # 전전기
        }
        for i in items
    ]


def collect(company):
    crno = company["crno"]
    summary = fetch_summary(crno)
    if not summary:
        raise FscError(f"법인등록번호 {fsc_api.fmt_crno(crno)}의 요약재무제표가 없습니다 (금융위 재무정보 대상이 아닐 수 있음)")
    latest = max(r["year"] for r in summary)
    statements = {}
    for key, op in (("balance_sheet", "getBs_V2"), ("income_statement", "getIncoStat_V2")):
        try:
            statements[key] = {"year": latest, "items": fetch_accounts(op, crno, latest)}
        except FscError as e:
            fsc_api.log(f"[WARN] {company.get('name') or crno} {op} 실패: {e}")
            statements[key] = {"year": latest, "items": [], "error": str(e)}
    return {
        "crno": crno,
        "bzno": company.get("bzno"),
        "name": company.get("name") or f"법인 {fsc_api.fmt_crno(crno)}",
        "fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "source": "금융위원회_기업 재무정보 (공공데이터포털 GetFinaStatInfoService_V2)",
        "summary": summary,
        **statements,
    }


def load_config():
    if not os.path.exists(CONFIG_PATH):
        return []
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--add", default="", help="추가할 번호 (쉼표로 여러 개). 사업자등록번호 10자리 / 법인등록번호 13자리")
    ap.add_argument("--name", default="", help="회사명 — 사업자등록번호로 찾을 때 검색에 쓰고, 표시 이름으로도 쓴다")
    args = ap.parse_args()

    if not fsc_api.service_key():
        notice("error", "financials", "DATA_GO_KR_KEY가 없습니다 — 저장소 Secret을 확인하세요")
        return 1

    companies = load_config()
    by_crno = {c["crno"]: c for c in companies}
    failed = []
    index_path = os.path.join(OUT_DIR, "index.json")
    previous = {}
    if os.path.exists(index_path):
        with open(index_path, encoding="utf-8") as f:
            previous = {c["crno"]: c for c in json.load(f).get("companies", [])}

    for number in [n.strip() for n in args.add.split(",") if n.strip()]:
        try:
            info = resolve(number, args.name.strip() or None)
        except FscError as e:
            notice("error", "financials-add", str(e))
            failed.append(number)
            continue
        existing = by_crno.get(info["crno"])
        if existing:
            existing.update({k: v for k, v in info.items() if v})
        else:
            companies.append(info)
            by_crno[info["crno"]] = info
        notice("notice", "financials-add", f"{info.get('name') or ''} 법인 {fsc_api.fmt_crno(info['crno'])}"
               + (f" · 사업자 {fsc_api.fmt_bzno(info['bzno'])}" if info.get("bzno") else ""))

    index = []
    for company in companies:
        try:
            data = collect(company)
        except FscError as e:
            notice("warning", "financials", f"{company.get('name') or company['crno']}: {e}")
            failed.append(company["crno"])
            if company["crno"] in previous:  # 이번에 실패해도 이전에 받은 자료는 화면에 남긴다
                index.append(previous[company["crno"]])
            continue
        company["name"] = data["name"]
        save_json(os.path.join(OUT_DIR, f"{company['crno']}.json"), data)
        years = sorted({r["year"] for r in data["summary"]})
        index.append({
            "crno": data["crno"], "bzno": data["bzno"], "name": data["name"],
            "years": [years[0], years[-1]], "fetched_at": data["fetched_at"],
        })
        print(f"[INFO] {data['name']} — 요약 {len(data['summary'])}행 ({years[0]}~{years[-1]}), "
              f"재무상태표 {len(data['balance_sheet']['items'])}·손익 {len(data['income_statement']['items'])}계정")

    save_json(CONFIG_PATH, companies)
    save_json(index_path, {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "companies": sorted(index, key=lambda c: c["name"]),
    })
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
