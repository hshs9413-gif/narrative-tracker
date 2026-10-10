// 배포된 Apps Script 웹 앱(docs/data/app_config.json의 fsc_proxy_url)을 실제로 불러 본다 — 브라우저처럼 리다이렉트를
// 따라가고, 대시보드가 다른 출처에서 읽을 수 있는지(CORS 헤더)도 확인한다. 결과는 GitHub Actions 주석으로.
import { readFileSync } from "node:fs";

const cfg = JSON.parse(readFileSync(new URL("../../docs/data/app_config.json", import.meta.url), "utf8"));
const base = (cfg.fsc_proxy_url || "").trim();
const note = (level, title, msg) =>
  console.log(`::${level} title=${title}::${String(msg).replace(/%/g, "%25").replace(/\n/g, "%0A").slice(0, 3000)}`);
if (!base) { note("warning", "proxy", "fsc_proxy_url 비어 있음 — 건너뜀"); process.exit(0); }

let failed = 0;
async function call(title, params, summarize) {
  const url = new URL(base);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const t0 = Date.now();
  try {
    const res = await fetch(url, { redirect: "follow", headers: { Origin: "https://hshs9413-gif.github.io" } });
    const text = await res.text();
    const cors = res.headers.get("access-control-allow-origin");
    let body;
    try { body = JSON.parse(text); } catch { throw new Error(`JSON 아님 (HTTP ${res.status}): ${text.slice(0, 200)}`); }
    if (body.error) throw new Error(body.error);
    note("notice", title, `HTTP ${res.status} · ${Date.now() - t0}ms · CORS=${cors}\n${summarize(body)}`);
    if (!cors) { failed++; note("error", title, "Access-Control-Allow-Origin 헤더 없음 — 브라우저에서 못 읽음"); }
  } catch (e) {
    failed++;
    note("error", title, String(e.message || e));
  }
}

await call("proxy ping", { action: "ping" }, (b) => JSON.stringify(b));
await call("proxy search 삼성전자", { action: "search", q: "삼성전자" },
  (b) => `${b.total}곳 · 1순위 ${b.results[0]?.name} ${b.results[0]?.crno}`);
await call("proxy search 124-81-00998", { action: "search", q: "124-81-00998" },
  (b) => `${b.kind} ${b.total}곳 · ${b.results.map((r) => r.name).join(", ")}`);
await call("proxy company", { action: "company", crno: "1301110006246" },
  (b) => `${b.name} · 요약 ${b.summary.length}행 · 재무상태표 ${b.balance_sheet.items.length} · 손익 ${b.income_statement.items.length} · 대표 ${b.profile?.ceo}`);
process.exit(failed ? 1 : 0);
