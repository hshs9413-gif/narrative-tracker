// scripts/fsc_proxy.gs를 Apps Script 전역 객체를 흉내 낸 샌드박스에 올린다.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SRC = fileURLToPath(new URL("../../scripts/fsc_proxy.gs", import.meta.url));

export function loadProxy({ key = null, fetchAll = null } = {}) {
  const store = new Map();
  const outputs = [];
  const ctx = {
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === "DATA_GO_KR_KEY" ? key : null) }) },
    CacheService: {
      getScriptCache: () => ({ get: (k) => store.get(k) ?? null, put: (k, v) => store.set(k, v) }),
    },
    UrlFetchApp: { fetchAll: fetchAll ?? (() => { throw new Error("network disabled in tests"); }) },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (text) => {
        const out = { text, setMimeType: () => out };
        outputs.push(text);
        return out;
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(SRC, "utf8"), ctx, { filename: "fsc_proxy.gs" });
  ctx.__outputs = outputs;
  ctx.__cache = store;
  return ctx;
}
