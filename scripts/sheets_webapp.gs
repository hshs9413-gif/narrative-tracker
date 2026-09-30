// 구글 시트 → 확장 프로그램 → Apps Script에 붙여넣고 '웹 앱'으로 배포하는 코드 (배포 방법은 README 참고)
// GitHub Actions(scripts/push_to_sheets.py)가 보내는 행을 탭별로 누적한다 — 같은 키(날짜 등)는 다시 넣지 않음
const KEYS = { market_snapshot: 1, attention: 2, regime_log: 1, watchlist_attention: 2 }; // 중복 판단에 쓰는 앞쪽 열 개수
const UPSERT = { events: true }; // 같은 키의 줄을 덮어쓰는 탭 — 상태가 바뀌는 목록(이벤트)용, 나머지는 새 행만 추가

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token || body.token !== token) return reply({ ok: false, error: 'unauthorized' });

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const appended = {};
  for (const tab in body.tables) {
    const [header, ...rows] = body.tables[tab];
    const k = KEYS[tab] || 1;
    const sheet = ss.getSheetByName(tab) || ss.insertSheet(tab);
    if (sheet.getLastRow() === 0) sheet.appendRow(header);
    if (UPSERT[tab]) { appended[tab] = upsert(sheet, header, rows, k); continue; }

    const n = sheet.getLastRow() - 1;
    const seen = new Set(n > 0 ? sheet.getRange(2, 1, n, k).getDisplayValues().map(r => r.join('|')) : []);
    const fresh = rows.filter(r => !seen.has(r.slice(0, k).join('|')));
    if (fresh.length) {
      const start = sheet.getLastRow() + 1;
      const need = start + fresh.length - 1 - sheet.getMaxRows();
      if (need > 0) sheet.insertRowsAfter(sheet.getMaxRows(), need); // 기본 1000행을 넘는 범위에는 바로 못 씀
      sheet.getRange(start, 1, fresh.length, k).setNumberFormat('@'); // 날짜 키가 날짜형으로 바뀌면 중복 판별이 깨짐
      sheet.getRange(start, 1, fresh.length, header.length).setValues(fresh);
    }
    appended[tab] = fresh.length;
  }
  return reply({ ok: true, appended });
}

// 키가 같은 줄은 제자리에서 덮어쓰고 없는 키만 아래에 추가한다. 반환값은 새로 추가된 줄 수.
// 열 순서가 바뀌거나 열이 늘 수 있어 머리글도 매번 맞춘다. 텍스트 서식('@')으로 날짜·숫자처럼 보이는 값이 변환되지 않게 함.
function upsert(sheet, header, rows, k) {
  const width = header.length;
  sheet.getRange(1, 1, 1, width).setNumberFormat('@').setValues([header]);
  const n = sheet.getLastRow() - 1;
  const rowOf = {};
  if (n > 0) sheet.getRange(2, 1, n, k).getDisplayValues().forEach((r, i) => { rowOf[r.join('|')] = i + 2; });

  const fresh = [];
  rows.forEach(r => {
    const at = rowOf[r.slice(0, k).join('|')];
    if (at) sheet.getRange(at, 1, 1, width).setNumberFormat('@').setValues([r]);
    else fresh.push(r);
  });
  if (fresh.length) {
    const start = sheet.getLastRow() + 1;
    const need = start + fresh.length - 1 - sheet.getMaxRows();
    if (need > 0) sheet.insertRowsAfter(sheet.getMaxRows(), need);
    sheet.getRange(start, 1, fresh.length, width).setNumberFormat('@').setValues(fresh);
  }
  return fresh.length;
}

function doGet(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(e.parameter.tab || 'market_snapshot');
  if (!sheet) return reply({ ok: false, error: 'no such tab' });
  return reply({ ok: true, rows: sheet.getDataRange().getDisplayValues() });
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
