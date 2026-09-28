// 구글 시트 → 확장 프로그램 → Apps Script에 붙여넣고 '웹 앱'으로 배포하는 코드 (배포 방법은 README 참고)
// GitHub Actions(scripts/push_to_sheets.py)가 보내는 행을 탭별로 누적한다 — 같은 키(날짜 등)는 다시 넣지 않음
const KEYS = { market_snapshot: 1, attention: 2, regime_log: 1 }; // 중복 판단에 쓰는 앞쪽 열 개수

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

function doGet(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(e.parameter.tab || 'market_snapshot');
  if (!sheet) return reply({ ok: false, error: 'no such tab' });
  return reply({ ok: true, rows: sheet.getDataRange().getDisplayValues() });
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
