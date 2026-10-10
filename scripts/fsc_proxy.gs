/**
 * 기업 재무 실시간 조회 프록시 — Google Apps Script 웹 앱 (V8 런타임)
 *
 * 대시보드(GitHub Pages, 정적 사이트)는 API 키를 브라우저에 둘 수 없어서, 이 웹 앱이 키를 보관하고
 * 공공데이터포털 금융위원회 API를 대신 호출해 JSON으로 돌려준다. 결과는 저장하지 않고(6시간 캐시만) 매번 조회한다.
 *
 *   ?action=search&q=삼성전자          회사명(일부)·사업자등록번호(10자리)·법인등록번호(13자리)로 법인 찾기
 *   ?action=company&crno=1301110006246  기업 개요 + 요약재무제표(연도별·연결/별도) + 최신 연도 재무상태표·손익계산서
 *   ?action=ping                         동작·키 설정 확인
 *
 * 설치 (README '기업 재무' 참고)
 *   1) script.google.com → 새 프로젝트 → 이 파일 내용 붙여넣기 → 저장
 *   2) 프로젝트 설정 → 스크립트 속성 → DATA_GO_KR_KEY = 공공데이터포털 일반 인증키 (Encoding/Decoding 어느 쪽이든)
 *   3) 배포 → 새 배포 → 웹 앱 (실행: 나 / 액세스: 모든 사용자) → 웹 앱 URL을 docs/data/app_config.json의 fsc_proxy_url에
 *   코드를 고친 뒤엔 배포 관리 → 수정 → 버전: 새 버전 (URL 유지)
 *
 * 응답 모양은 web/types/dashboard.ts의 CompanyFinancials·CompanySearchResult와 같다.
 * 필드 이름은 2026-10-10 실제 응답으로 확인 (scripts/fsc_check.py).
 */

var FSC_BASE = 'https://apis.data.go.kr/1160100/service';
var CORP = 'GetCorpBasicInfoService_V2';
var FINA = 'GetFinaStatInfoService_V2';
var CACHE_SECONDS = 6 * 60 * 60;
var PAGE_ROWS = 100;
var MAX_SEARCH_PAGES = 3;   // 회사명 검색은 최대 300행까지 보고 법인 단위로 묶는다
var MAX_RESULTS = 30;

var SUMMARY_FIELDS = {
  enpSaleAmt: 'revenue', enpBzopPft: 'operating_income', enpCrtmNpf: 'net_income',
  iclsPalClcAmt: 'comprehensive_income', enpTastAmt: 'assets', enpTdbtAmt: 'liabilities',
  enpTcptAmt: 'equity', enpCptlAmt: 'capital', fnclDebtRto: 'debt_ratio'
};

var PROFILE_FIELDS = {
  corpNm: 'name', enpRprFnm: 'ceo', enpEstbDt: 'established', corpDcdNm: 'corp_type', sicNm: 'industry',
  enpMainBizNm: 'main_business', enpBsadr: 'address', enpDtadr: 'address_detail', enpHmpgUrl: 'homepage',
  enpTlno: 'phone', enpEmpeCnt: 'employees', corpRegMrktDcdNm: 'market', enpKrxLstgDt: 'krx_listed',
  enpKosdaqLstgDt: 'kosdaq_listed', smenpYn: 'sme', enpStacMm: 'fiscal_month', actnAudpnNm: 'auditor',
  audtRptOpnnCtt: 'audit_opinion', fssCorpChgDtm: 'changed_at'
};

// ───────────────────────── 웹 앱 진입점 ─────────────────────────

function doGet(e) {
  var p = (e && e.parameter) || {};
  var out;
  try {
    if (p.action === 'search') out = searchCompanies(p.q || '', gasHttp_());
    else if (p.action === 'company') out = getCompany(p.crno || '', gasHttp_());
    else if (p.action === 'ping') out = { ok: true, key_configured: !!serviceKey_() };
    else out = { error: 'action은 search · company · ping 중 하나여야 합니다' };
  } catch (err) {
    out = { error: scrub_(String((err && err.message) || err)) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ───────────────────────── 조회 로직 (http는 fetchAll(requests) → [{items,total}|{error}]) ─────────────────────────

function searchCompanies(q, http) {
  q = String(q || '').trim();
  if (!q) return { query: q, kind: 'name', total: 0, truncated: false, results: [] };
  var compact = q.replace(/[\s-]/g, '');
  var d = digits_(q);
  var kind = 'name', params;
  if (/^\d+$/.test(compact) && d.length === 10) { kind = 'bzno'; params = { bzno: d }; }
  else if (/^\d+$/.test(compact) && d.length === 13) { kind = 'crno'; params = { crno: d }; }
  else params = { corpNm: q };

  var first = one_(http, { service: CORP, op: 'getCorpOutline_V2', params: assign_({ pageNo: 1, numOfRows: PAGE_ROWS }, params) });
  var rows = first.items.slice();
  var pages = Math.min(MAX_SEARCH_PAGES, Math.ceil(first.total / PAGE_ROWS));
  if (pages > 1) {
    var reqs = [];
    for (var pg = 2; pg <= pages; pg++) {
      reqs.push({ service: CORP, op: 'getCorpOutline_V2', params: assign_({ pageNo: pg, numOfRows: PAGE_ROWS }, params) });
    }
    http.fetchAll(reqs).forEach(function (r) { if (r && r.items) rows = rows.concat(r.items); });
  }
  var fetched = rows.length;
  if (kind === 'bzno') rows = rows.filter(function (r) { return digits_(r.bzno) === d; });
  if (kind === 'crno') rows = rows.filter(function (r) { return digits_(r.crno) === d; });

  var byCrno = {};
  rows.forEach(function (r) {
    var c = digits_(r.crno);
    if (c.length !== 13) return;
    if (!byCrno[c] || changeKey_(r) > changeKey_(byCrno[c])) byCrno[c] = r;
  });
  var target = normName_(q);
  var list = Object.keys(byCrno).map(function (c) { return byCrno[c]; });
  list.sort(function (a, b) { return rank_(a, target) - rank_(b, target) || String(a.corpNm).localeCompare(String(b.corpNm), 'ko'); });

  return {
    query: q,
    kind: kind,
    total: list.length,
    truncated: kind === 'name' && first.total > fetched,
    results: list.slice(0, MAX_RESULTS).map(function (r) {
      return {
        crno: digits_(r.crno), bzno: digits_(r.bzno) || null, name: r.corpNm || null, ceo: r.enpRprFnm || null,
        market: r.corpRegMrktDcdNm || null, established: r.enpEstbDt || null, address: r.enpBsadr || null
      };
    })
  };
}

function getCompany(crno, http) {
  var d = digits_(crno);
  if (d.length !== 13) throw new Error('법인등록번호(13자리)가 필요합니다');
  var first = http.fetchAll([
    { service: CORP, op: 'getCorpOutline_V2', params: { crno: d, pageNo: 1, numOfRows: PAGE_ROWS } },
    { service: FINA, op: 'getSummFinaStat_V2', params: { crno: d, pageNo: 1, numOfRows: PAGE_ROWS } }
  ]);
  var outline = first[0], summ = first[1];
  if (summ.error) throw new Error(summ.error);

  var profile = null;
  if (outline && !outline.error) {
    var mine = outline.items.filter(function (r) { return digits_(r.crno) === d; });
    if (mine.length) profile = toProfile_(mine.reduce(function (a, b) { return changeKey_(b) > changeKey_(a) ? b : a; }));
  }

  var summary = summ.items.map(toSummaryRow_).sort(function (a, b) {
    return a.year < b.year ? -1 : a.year > b.year ? 1 : (a.basis < b.basis ? -1 : a.basis > b.basis ? 1 : 0);
  });
  var latest = summary.length ? summary[summary.length - 1].year : null;
  var statements = { balance_sheet: { year: latest, items: [] }, income_statement: { year: latest, items: [] } };
  if (latest) {
    var acc = http.fetchAll([
      { service: FINA, op: 'getBs_V2', params: { crno: d, bizYear: latest, pageNo: 1, numOfRows: PAGE_ROWS } },
      { service: FINA, op: 'getIncoStat_V2', params: { crno: d, bizYear: latest, pageNo: 1, numOfRows: PAGE_ROWS } }
    ]);
    ['balance_sheet', 'income_statement'].forEach(function (k, i) {
      if (acc[i].error) statements[k].error = acc[i].error;
      else statements[k].items = acc[i].items.map(toAccountRow_);
    });
  }

  return {
    crno: d,
    bzno: (profile && profile.bzno) || null,
    name: (profile && profile.name) || ('법인 ' + d.slice(0, 6) + '-' + d.slice(6)),
    profile: profile,
    fetched_at: new Date().toISOString(),
    source: '금융위원회_기업 재무정보·기업기본정보 (공공데이터포털, 실시간 조회)',
    summary: summary,
    balance_sheet: statements.balance_sheet,
    income_statement: statements.income_statement,
    profile_error: outline && outline.error ? outline.error : undefined
  };
}

// ───────────────────────── 정규화 ─────────────────────────

function toSummaryRow_(i) {
  var row = {
    year: String(i.bizYear), basis: basisOf_(i.fnclDcd, i.fnclDcdNm), basis_name: i.fnclDcdNm || null,
    as_of: i.basDt || null, currency: i.curCd || null
  };
  for (var src in SUMMARY_FIELDS) row[SUMMARY_FIELDS[src]] = toNumber_(i[src]);
  if (row.debt_ratio !== null) row.debt_ratio = Math.round(row.debt_ratio * 10000) / 10000;
  return row;
}

function toAccountRow_(i) {
  return {
    basis: basisOf_(i.fnclDcd, i.fnclDcdNm), account_id: i.acitId || null, account: i.acitNm || null,
    current: toNumber_(i.crtmAcitAmt), previous: toNumber_(i.pvtrAcitAmt), before_previous: toNumber_(i.bpvtrAcitAmt)
  };
}

function toProfile_(r) {
  var p = {};
  for (var src in PROFILE_FIELDS) p[PROFILE_FIELDS[src]] = (r[src] === undefined || r[src] === '') ? null : r[src];
  p.bzno = digits_(r.bzno) || null;
  p.employees = toNumber_(p.employees);
  return p;
}

function basisOf_(code, name) {
  var t = String(code || '') + ' ' + String(name || '');
  if (t.indexOf('연결') >= 0 || t.indexOf('Consolidated') >= 0) return '연결';
  if (t.indexOf('별도') >= 0 || t.indexOf('개별') >= 0 || t.indexOf('Separate') >= 0) return '별도';
  return name || String(code || '');
}

function toNumber_(v) {
  if (v === null || v === undefined || v === '' || v === '-') return null;
  var n = Number(String(v).replace(/,/g, ''));
  return isFinite(n) ? n : null;
}

function digits_(v) { return String(v === null || v === undefined ? '' : v).replace(/\D/g, ''); }

function changeKey_(r) { return String(r.fssCorpChgDtm || '') + '|' + String(r.lastOpegDt || ''); }

function normName_(s) {
  return String(s || '').replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\s/g, '').toLowerCase();
}

/** 낮을수록 위 — 이름 완전 일치 > 앞부분 일치 > 상장사 > 사업자번호 있음 > 짧은 이름 */
function rank_(r, target) {
  var n = normName_(r.corpNm);
  var score = 0;
  if (n !== target) score += n.indexOf(target) === 0 ? 1000 : 2000;
  var m = String(r.corpRegMrktDcdNm || '');
  if (!/유가|코스닥|코넥스|KOSPI|KOSDAQ/.test(m)) score += 100;
  if (!digits_(r.bzno)) score += 50;
  return score + Math.min(n.length, 40);
}

// ───────────────────────── 공공데이터포털 호출 ─────────────────────────

function serviceKey_() {
  var raw = String(PropertiesService.getScriptProperties().getProperty('DATA_GO_KR_KEY') || '').trim().replace(/^['"]|['"]$/g, '');
  if (!raw) return null;
  return raw.indexOf('%') >= 0 ? decodeURIComponent(raw) : raw;  // Encoding 키를 넣었으면 원문으로
}

function scrub_(text) {
  var key = null;
  try { key = serviceKey_(); } catch (e) { key = null; }
  if (!key) return text;
  return String(text).split(key).join('***').split(encodeURIComponent(key)).join('***');
}

function buildUrl_(key, service, op, params) {
  var q = ['serviceKey=' + encodeURIComponent(key), 'resultType=json'];
  Object.keys(params).forEach(function (k) {
    var v = params[k];
    if (v !== undefined && v !== null && v !== '') q.push(k + '=' + encodeURIComponent(v));
  });
  return FSC_BASE + '/' + service + '/' + op + '?' + q.join('&');
}

function xmlError_(text) {
  var pick = function (tag) { var m = new RegExp('<' + tag + '>(.*?)</' + tag + '>').exec(text); return m ? m[1] : null; };
  return [pick('errMsg'), pick('returnAuthMsg'), pick('returnReasonCode')].filter(Boolean).join(' / ') || text.slice(0, 200);
}

function itemsOf_(body) {
  var items = body && body.items;
  if (!items) return [];
  var item = items.item !== undefined ? items.item : items;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

/** 응답 본문 → {items, total}. 실패면 Error */
function parseResponse_(op, status, text) {
  text = String(text || '').trim();
  if (text.charAt(0) === '<') throw new Error(op + ': ' + xmlError_(text));
  var data;
  try { data = JSON.parse(text); } catch (e) { throw new Error(op + ': JSON이 아닌 응답 (HTTP ' + status + ')'); }
  if (data.OpenAPI_ServiceResponse) {
    var h = data.OpenAPI_ServiceResponse.cmmMsgHeader || {};
    throw new Error(op + ': ' + [h.errMsg, h.returnAuthMsg].filter(Boolean).join(' / '));
  }
  if (status !== 200) throw new Error(op + ': HTTP ' + status);
  var r = data.response || data;
  var header = r.header || {};
  if (header.resultCode !== undefined && ['00', '0'].indexOf(String(header.resultCode)) < 0) {
    throw new Error(op + ': ' + header.resultCode + ' ' + (header.resultMsg || ''));
  }
  var body = r.body || {};
  return { items: itemsOf_(body), total: Number(body.totalCount) || 0 };
}

function one_(http, req) {
  var r = http.fetchAll([req])[0];
  if (r.error) throw new Error(r.error);
  return r;
}

function assign_(a, b) { for (var k in b) a[k] = b[k]; return a; }

function cacheKey_(req) {
  var s = req.service + '/' + req.op + '?' + JSON.stringify(req.params);
  if (typeof Utilities === 'undefined') return s;
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/** Apps Script용 http — 캐시 확인 후 남은 요청을 UrlFetchApp.fetchAll로 병렬 호출 */
function gasHttp_() {
  var key = serviceKey_();
  if (!key) throw new Error('스크립트 속성 DATA_GO_KR_KEY가 설정되지 않았습니다');
  var cache = CacheService.getScriptCache();
  return {
    fetchAll: function (reqs) {
      var results = new Array(reqs.length), pending = [], idx = [];
      reqs.forEach(function (r, i) {
        var hit = cache.get(cacheKey_(r));
        if (hit) results[i] = JSON.parse(hit);
        else { pending.push({ url: buildUrl_(key, r.service, r.op, r.params), muteHttpExceptions: true }); idx.push(i); }
      });
      if (!pending.length) return results;
      var resps;
      try {
        resps = UrlFetchApp.fetchAll(pending);
      } catch (e) {
        var msg = scrub_(String((e && e.message) || e));
        idx.forEach(function (i) { results[i] = { error: '공공데이터포털 접속 실패: ' + msg }; });
        return results;
      }
      resps.forEach(function (resp, j) {
        var i = idx[j], r = reqs[i];
        try {
          var parsed = parseResponse_(r.op, resp.getResponseCode(), resp.getContentText('UTF-8'));
          results[i] = parsed;
          var s = JSON.stringify(parsed);
          if (s.length < 90000) cache.put(cacheKey_(r), s, CACHE_SECONDS);
        } catch (err) {
          results[i] = { error: scrub_(err.message) };
        }
      });
      return results;
    }
  };
}
