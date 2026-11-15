import {readUserSettings,replaceUserSettings,changeUserSettings} from "./settings-transactions.mjs";
// The page's adapters to the verified core, shared by the builder's host (host.js) and holo.html: core.wasm
// through its JSON ABI, the view, addresses from the holospaces wasm, and the device store. Foundry's
// language model is its reader in the kernel guest (host.js); no engine, weights or server are here.

const BASE = new URL("./", import.meta.url);
const enc = new TextEncoder();
export const short = (k) => (k ? String(k).replace(/^blake3:/, "").replace("did:holo:sha256:", "").slice(0, 12) + "…" : "");

// ---- the verified core, through its JSON ABI
let core = null, coreLoading = null;
export function coreReady() {
  if (core) return Promise.resolve(core);
  if (coreLoading) return coreLoading;
  coreLoading = (async () => {
    const { instance } = await WebAssembly.instantiateStreaming(fetch(new URL("core.wasm", BASE)), {});
    const { memory, holo_alloc, holo_free, holo_run } = instance.exports;
    core = {
      run(request) {
        const bytes = enc.encode(JSON.stringify(request));
        const ptr = holo_alloc(bytes.length);
        new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
        const packed = holo_run(ptr, bytes.length);
        const outPtr = Number(packed >> 32n), outLen = Number(packed & 0xffffffffn);
        const text = new TextDecoder().decode(new Uint8Array(memory.buffer, outPtr, outLen));
        holo_free(outPtr, outLen); holo_free(ptr, bytes.length);
        const out = JSON.parse(text);
        if (out.error) throw new Error(out.error);
        return out;
      },
    };
    return core;
  })();
  return coreLoading;
}
export let VIEW = null;
export async function viewReady() { if (VIEW) return VIEW; const inline = document.getElementById("view"); VIEW = inline ? JSON.parse(inline.textContent) : (await coreReady()).run({ op: "view" }); return VIEW; }

// ---- BLAKE3 addresses from the holospaces wasm (the same κ every daemon computes)
let kappaFn = null;
export async function kappaReady() {
  if (kappaFn) return kappaFn;
  const mod = await import(new URL("q/pkg/holospaces_web.js", BASE).href);
  if (typeof mod.default === "function") { try { await mod.default(); } catch (e) {} }
  kappaFn = (bytes) => String(mod.kappa(bytes));
  return kappaFn;
}
export async function kappa(bytes) { return (await kappaReady())(bytes); }

// ---- the device store: one database for the builder and the seals. Seals are rows keyed by κ,
// indexed by kind and by memo prompt κ; the builder's own stores sit beside them.
export const DB = "hologram-forge", DB_VERSION = 2;
export const STORES = ["settings", "apps", "chats", "files", "objects", "refs", "versions", "audit"];
let dbHandle = null;
export function db() {
  if (dbHandle) return Promise.resolve(dbHandle);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
      if (!d.objectStoreNames.contains("seals")) { const s = d.createObjectStore("seals", { keyPath: "id" }); s.createIndex("kind", "kind"); s.createIndex("promptKappa", "promptKappa"); }
    };
    req.onsuccess = () => resolve((dbHandle = req.result)); req.onerror = () => reject(req.error);
  });
}
// ---- settings: the renderer's own record
export function settingsGet() { return readUserSettings(db()); }
export function settingsPut(s) { return replaceUserSettings(db(),s); }
