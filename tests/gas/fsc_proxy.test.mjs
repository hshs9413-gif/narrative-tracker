// node --test tests/gas — Apps Script 프록시(scripts/fsc_proxy.gs) 단위 테스트, 네트워크 없음
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadProxy } from "./load.mjs";

const SAMSUNG = { crno: "1301110006246", bzno: "1248100998", corpNm: "삼성전자(주)", enpRprFnm: "전영현, 노태문",
  corpRegMrktDcdNm: "유가", enpEstbDt: "19690113", enpBsadr: "경기도 수원시", enpEmpeCnt: "128881", fssCorpChgDtm: "2025/12/01" };
const SUMM = { basDt: "20251231", crno: "1301110006246", bizYear: "2025", fnclDcd: "120", fnclDcdNm: "별도요약재무제표",
  enpSaleAmt: "238043009000000", enpBzopPft: "23603619000000", iclsPalClcAmt: "33436082000000", enpCrtmNpf: "33686601000000",
  enpTastAmt: "358902051000000", enpTdbtAmt: "104571968000000", enpTcptAmt: "254330083000000", enpCptlAmt: "897514000000",
  fnclDebtRto: "41.1166334578", curCd: "KRW" };

const ok = (items, total = items.length) => ({ items, total });
// vm 샌드박스의 배열·객체는 다른 realm이라 strict 비교 전에 평범한 값으로 바꾼다
const plain = (x) => JSON.parse(JSON.stringify(x));

/** op·params로 응답을 고르는 가짜 http */
function fakeHttp(handler) {
  const calls = [];
  return { calls, fetchAll: (reqs) => reqs.map((r) => { calls.push(r); return handler(r); }) };
}

test("parseResponse_: 목록·단일·빈 결과·오류", () => {
  const g = loadProxy();
  const wrap = (items, total) => JSON.stringify({ response: { header: { resultCode: "00" }, body: { totalCount: total, items } } });
  assert.equal(g.parseResponse_("op", 200, wrap({ item: [SUMM, SUMM] }, 2)).items.length, 2);
  assert.deepEqual(plain(g.parseResponse_("op", 200, wrap({ item: SUMM }, 1)).items), [SUMM]);
  assert.deepEqual(plain(g.parseResponse_("op", 200, wrap("", 0))), { items: [], total: 0 });
  assert.throws(() => g.parseResponse_("op", 200, "<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>"), /SERVICE_KEY_IS_NOT_REGISTERED_ERROR/);
  assert.throws(() => g.parseResponse_("op", 403, JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" } } })), /NOT_REGISTERED/);
  assert.throws(() => g.parseResponse_("op", 200, JSON.stringify({ response: { header: { resultCode: "10", resultMsg: "INVALID" } } })), /10 INVALID/);
});

test("buildUrl_: 키는 한 번만 인코딩, 빈 조건은 뺌", () => {
  const g = loadProxy();
  const url = g.buildUrl_("ab+c/d==", "S", "op", { crno: "1", bizYear: "", pageNo: 1 });
  assert.match(url, /serviceKey=ab%2Bc%2Fd%3D%3D/);
  assert.match(url, /resultType=json/);
  assert.doesNotMatch(url, /bizYear/);
  assert.match(url, /^https:\/\/apis\.data\.go\.kr\/1160100\/service\/S\/op\?/);
});

test("serviceKey_: Encoding 키·따옴표도 원문으로", () => {
  assert.equal(loadProxy({ key: "ab%2Bc%2Fd%3D%3D" }).serviceKey_(), "ab+c/d==");
  assert.equal(loadProxy({ key: ' "abc" ' }).serviceKey_(), "abc");
  assert.equal(loadProxy({ key: "" }).serviceKey_(), null);
});

test("searchCompanies: 회사명 — 법인 단위로 묶고 정확히 같은 이름·상장사를 위로", () => {
  const g = loadProxy();
  const rows = [
    { crno: "1101110877477", bzno: "", corpNm: "삼성전자잠실판매", fssCorpChgDtm: "2020/01/01" },
    { ...SAMSUNG, fssCorpChgDtm: "2024/01/01", enpRprFnm: "옛대표" },
    { crno: "1201110505464", bzno: "1228606517", corpNm: "삼성전자우호기업(주)" },
    SAMSUNG,
  ];
  const http = fakeHttp((r) => (r.params.pageNo === 1 ? ok(rows, 150) : ok([{ crno: "1111111111111", bzno: "1", corpNm: "삼성전자서비스(주)" }], 150)));
  const res = g.searchCompanies("삼성전자", http);
  assert.equal(res.kind, "name");
  assert.equal(http.calls.length, 2); // 150건 → 2쪽
  assert.equal(http.calls[0].params.corpNm, "삼성전자");
  assert.equal(res.results[0].crno, "1301110006246");
  assert.equal(res.results[0].ceo, "전영현, 노태문"); // 최신 변경분
  assert.equal(new Set(res.results.map((r) => r.crno)).size, res.results.length);
  assert.equal(res.truncated, true); // 가짜 응답은 150건이라면서 5행만 줬다
});

test("searchCompanies: 사업자등록번호(하이픈)·법인등록번호", () => {
  const g = loadProxy();
  const http = fakeHttp(() => ok([SAMSUNG, { ...SAMSUNG, bzno: "9999999999", crno: "2222222222222" }], 2));
  const byBz = g.searchCompanies("124-81-00998", http);
  assert.equal(byBz.kind, "bzno");
  assert.equal(http.calls[0].params.bzno, "1248100998");
  assert.deepEqual(plain(byBz.results.map((r) => r.crno)), ["1301110006246"]);
  const byCr = g.searchCompanies("130111-0006246", fakeHttp(() => ok([SAMSUNG], 1)));
  assert.equal(byCr.kind, "crno");
  assert.equal(byCr.results[0].bzno, "1248100998");
  assert.equal(g.searchCompanies("  ", fakeHttp(() => ok([]))).results.length, 0);
});

test("searchCompanies: 오류는 그대로 올린다", () => {
  const g = loadProxy();
  assert.throws(() => g.searchCompanies("삼성", fakeHttp(() => ({ error: "getCorpOutline_V2: SERVICE_KEY_IS_NOT_REGISTERED_ERROR" }))), /NOT_REGISTERED/);
});

test("getCompany: 개요·요약·최신 연도 계정", () => {
  const g = loadProxy();
  const http = fakeHttp((r) => {
    if (r.op === "getCorpOutline_V2") return ok([{ ...SAMSUNG, fssCorpChgDtm: "2024/01/01", enpRprFnm: "옛대표" }, SAMSUNG]);
    if (r.op === "getSummFinaStat_V2") return ok([SUMM, { ...SUMM, bizYear: "2024" }, { ...SUMM, fnclDcd: "110", fnclDcdNm: "연결요약재무제표" }]);
    if (r.op === "getBs_V2") return ok([{ fnclDcd: "FS_ifrs-full_ConsolidatedMember", acitId: "ifrs-full_Assets", acitNm: "자산총계", crtmAcitAmt: "514531948000000", pvtrAcitAmt: "455905980000000", bpvtrAcitAmt: "" }]);
    if (r.op === "getIncoStat_V2") return { error: "getIncoStat_V2: HTTP 500" };
    throw new Error(r.op);
  });
  const c = g.getCompany("130111-0006246", http);
  assert.equal(c.name, "삼성전자(주)");
  assert.equal(c.bzno, "1248100998");
  assert.equal(c.profile.ceo, "전영현, 노태문");
  assert.equal(c.profile.employees, 128881);
  assert.deepEqual(plain(c.summary.map((r) => `${r.year}${r.basis}`)), ["2024별도", "2025별도", "2025연결"]);
  assert.equal(c.summary[1].revenue, 238043009000000);
  assert.equal(c.summary[1].debt_ratio, 41.1166);
  assert.equal(c.balance_sheet.year, "2025");
  assert.equal(c.balance_sheet.items[0].basis, "연결");
  assert.equal(c.balance_sheet.items[0].before_previous, null);
  assert.equal(c.income_statement.error, "getIncoStat_V2: HTTP 500");
  const bsCall = http.calls.find((r) => r.op === "getBs_V2");
  assert.equal(bsCall.params.bizYear, "2025");
});

test("getCompany: 기업기본정보 실패해도 재무는 보여주고, 재무 실패는 오류", () => {
  const g = loadProxy();
  const c = g.getCompany("1301110006246", fakeHttp((r) => (r.op === "getCorpOutline_V2" ? { error: "outline down" } : ok(r.op === "getSummFinaStat_V2" ? [SUMM] : []))));
  assert.equal(c.profile, null);
  assert.equal(c.profile_error, "outline down");
  assert.equal(c.name, "법인 130111-0006246");
  assert.throws(() => g.getCompany("1301110006246", fakeHttp((r) => (r.op === "getSummFinaStat_V2" ? { error: "summ down" } : ok([])))), /summ down/);
  assert.throws(() => g.getCompany("123", fakeHttp(() => ok([]))), /13자리/);
  const empty = g.getCompany("1301110006246", fakeHttp(() => ok([])));
  assert.deepEqual(plain(empty.summary), []);
  assert.equal(empty.balance_sheet.year, null);
});

test("doGet: ping·잘못된 action·키 가림·캐시", () => {
  const KEY = "secretKEY+123";
  let fetches = 0;
  const g = loadProxy({
    key: KEY,
    fetchAll: (reqs) => {
      fetches += 1;
      if (reqs[0].url.includes("corpNm=boom")) throw new Error(`Address unavailable: ${reqs[0].url}`);
      return reqs.map(() => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ response: { header: { resultCode: "00" }, body: { totalCount: 1, items: { item: SAMSUNG } } } }) }));
    },
  });
  assert.deepEqual(JSON.parse(g.doGet({ parameter: { action: "ping" } }).text), { ok: true, key_configured: true });
  assert.match(JSON.parse(g.doGet({ parameter: {} }).text).error, /action/);
  const boom = JSON.parse(g.doGet({ parameter: { action: "search", q: "boom" } }).text);
  assert.match(boom.error, /접속 실패/);
  assert.doesNotMatch(boom.error, /secretKEY/);
  assert.doesNotMatch(boom.error, /secretKEY%2B123/);
  const r1 = JSON.parse(g.doGet({ parameter: { action: "search", q: "124-81-00998" } }).text);
  const before = fetches;
  const r2 = JSON.parse(g.doGet({ parameter: { action: "search", q: "124-81-00998" } }).text);
  assert.equal(fetches, before); // 두 번째는 캐시
  assert.deepEqual(r1, r2);
  assert.equal(r1.results[0].name, "삼성전자(주)");
});

test("doGet: 키가 없으면 안내", () => {
  const g = loadProxy({ key: null });
  assert.match(JSON.parse(g.doGet({ parameter: { action: "search", q: "x" } }).text).error, /DATA_GO_KR_KEY/);
});
