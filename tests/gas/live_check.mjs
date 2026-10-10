// 실제 공공데이터포털로 Apps Script 프록시 로직을 한 번 돌려 본다 (CI의 fsc-api-check 잡, DATA_GO_KR_KEY 필요).
// UrlFetchApp.fetchAll을 curl로 흉내 낸다 — 결과는 GitHub Actions 주석(::notice)으로 남긴다.
import { execFileSync } from "node:child_process";
import { loadProxy } from "./load.mjs";

const key = process.env.DATA_GO_KR_KEY;
if (!key) {
  console.log("::warning title=fsc-proxy-live::DATA_GO_KR_KEY 없음 — 건너뜀");
  process.exit(0);
}

const fetchAll = (reqs) =>
  reqs.map((r) => {
    try {
      const out = execFileSync("curl", ["-sS", "-m", "40", "-w", "\n%{http_code}", r.url], { encoding: "utf8" });
      const cut = out.lastIndexOf("\n");
      const body = out.slice(0, cut);
      const code = Number(out.slice(cut + 1));
      return { getResponseCode: () => code, getContentText: () => body };
    } catch (e) {
      throw new Error(String(e.message).split(key).join("***"));
    }
  });

const g = loadProxy({ key, fetchAll });
const call = (parameter) => JSON.parse(g.doGet({ parameter }).text);
const note = (title, msg) => console.log(`::notice title=${title}::${String(msg).replace(/%/g, "%25").replace(/\n/g, "%0A").slice(0, 3000)}`);

let failed = 0;
for (const q of ["삼성전자", "124-81-00998", "현대자동차"]) {
  const r = call({ action: "search", q });
  if (r.error) { failed++; note(`search ${q}`, `오류 ${r.error}`); continue; }
  note(`search ${q}`, `kind=${r.kind} 법인 ${r.total}곳 truncated=${r.truncated}\n` +
    r.results.slice(0, 6).map((x) => `${x.name} | 법인 ${x.crno} | 사업자 ${x.bzno} | ${x.market ?? ""} | ${x.ceo ?? ""}`).join("\n"));
}
const c = call({ action: "company", crno: "1301110006246" });
if (c.error) { failed++; note("company", `오류 ${c.error}`); }
else {
  const years = [...new Set(c.summary.map((r) => r.year))];
  note("company", `${c.name} 사업자 ${c.bzno} | 요약 ${c.summary.length}행 ${years[0]}~${years.at(-1)} | 재무상태표 ${c.balance_sheet.items.length}·손익 ${c.income_statement.items.length}계정 (${c.balance_sheet.year}) | 대표 ${c.profile?.ceo}`);
}
process.exit(failed ? 1 : 0);
