// The elaborator worker: Lean 4.32.2's elaborator and kernel, one instance for the life of the tab.
//
// Why a worker: elaboration blocks for seconds, and Lean keeps its resident state (driver/Elab.lean) between
// requests. How bytes are trusted: the page gives the manifest's base URL; every file, the engine included, is fetched
// as `blobs/<hex>` and its BLAKE3 κ re-derived (prism-code's BLAKE3) before Lean or the browser runs a byte of it.
//
//   { op: "open", base }                          -> { op: "open", ok, timings, files, mb } | { ok: false, refusal }
//   { op: "source", path, text }                  -> { op: "source", ok }
//   { op: "elaborate", id, module, path }         -> { id, answer, ms }, answer is the driver's JSON
import { kappa } from "./blake3.mjs";

const now = () => performance.now();
let lean = null;
const heapMB = () => (lean?.HEAPU8 ? Math.round(lean.HEAPU8.length / 1048576) : null);

// The tab's own store: blobs named by κ in the origin's private file system (OPFS), so a second visit reads them
// from disk instead of the network. A stored blob is trusted no more than a fetched one: its κ is re-derived on
// every read, and a mismatch is a miss.
const spent = { fetchMs: 0, hashMs: 0, storeHits: 0, storeMisses: 0 };
let store = null;
async function openStore() {
  try { store = await (await navigator.storage.getDirectory()).getDirectoryHandle("lean-blobs", { create: true }); } catch { store = null; }
}
async function fromStore(hex) {
  if (!store) return null;
  try { return new Uint8Array(await (await (await store.getFileHandle(hex)).getFile()).arrayBuffer()); } catch { return null; }
}
async function toStore(hex, bytes) {
  if (!store) return;
  try { const w = await (await store.getFileHandle(hex, { create: true })).createWritable(); await w.write(bytes); await w.close(); } catch {}
}

// A pool of hashing workers (hash-worker.mjs), one per core up to 8; without workers, hashing runs here.
const pool = [];
let nextId = 0, turn = 0;
const waiting = new Map();
function startPool() {
  const n = Math.min(8, Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1));
  try {
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL("./hash-worker.mjs", import.meta.url), { type: "module" });
      w.onmessage = ({ data }) => { waiting.get(data.id)(data); waiting.delete(data.id); };
      pool.push(w);
    }
  } catch { pool.length = 0; }
}
function hashed(bytes) {
  if (!pool.length) return Promise.resolve({ kappa: kappa(bytes), bytes });
  const id = nextId++;
  return new Promise((resolve) => { waiting.set(id, resolve); pool[turn++ % pool.length].postMessage({ id, bytes }, [bytes.buffer]); });
}

async function fetchChecked(base, entry) {
  const hex = entry.kappa.slice(7);
  let t = now();
  let bytes = await fromStore(hex);
  const stored = bytes !== null;
  if (!stored) {
    const res = await fetch(`${base}/blobs/${hex}`);
    if (!res.ok) throw new Error(`missing ${entry.path ?? entry.kappa}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  spent.fetchMs += now() - t;
  t = now();
  let k;
  ({ kappa: k, bytes } = await hashed(bytes));
  const ok = k === entry.kappa;
  spent.hashMs += now() - t;
  if (!ok) {
    if (stored) { spent.storeMisses++; try { await store.removeEntry(hex); } catch {} return fetchChecked(base, entry); }
    throw new Error(`κ mismatch for ${entry.path ?? entry.kappa}`);
  }
  if (stored) spent.storeHits++; else { spent.storeMisses++; await toStore(hex, bytes); }
  return bytes;
}

async function open(base) {
  const timings = {};
  await openStore();
  startPool();
  let t = now();
  const manifest = await (await fetch(`${base}/manifest.json`)).json();
  const [glue, wasm] = await Promise.all([fetchChecked(base, manifest.engine["lean-elab.mjs"]), fetchChecked(base, manifest.engine["lean-elab.wasm"])]);
  timings.engineMs = Math.round(now() - t);
  t = now();
  // Every library file, fetched in parallel and checked by κ, then written where Lean's search path looks.
  const files = [];
  const queue = [...manifest.files];
  let mb = 0;
  await Promise.all(Array.from({ length: 16 }, async () => {
    for (let e; (e = queue.shift()); ) { files.push([e.path, await fetchChecked(base, e)]); mb += e.bytes / 1048576; }
  }));
  timings.libraryMs = Math.round(now() - t);
  for (const w of pool) w.terminate();
  timings.hashWorkers = pool.length;
  pool.length = 0;
  // Summed over the parallel fetches, so they can exceed the wall time; they show which part dominates.
  Object.assign(timings, { fetchMs: Math.round(spent.fetchMs), hashMs: Math.round(spent.hashMs), storeHits: spent.storeHits, storeMisses: spent.storeMisses });
  t = now();
  const url = URL.createObjectURL(new Blob([glue], { type: "text/javascript" }));
  let factory;
  try { factory = (await import(url)).default; } finally { URL.revokeObjectURL(url); }
  const log = [];
  lean = await factory({
    instantiateWasm: (imports, done) => { WebAssembly.instantiate(wasm, imports).then((r) => done(r.instance, r.module)); return {}; },
    print: (s) => log.push(s), printErr: (s) => log.push(s),
  });
  for (const [path, bytes] of files) {
    lean.FS.mkdirTree(path.slice(0, path.lastIndexOf("/")));
    lean.FS.writeFile(path, bytes);
  }
  lean.ENV.LEAN_SYSROOT = "/lean";
  lean.ENV.LEAN_PATH = "/rt";
  lean.FS.mkdirTree("/src"); lean.FS.mkdirTree("/out");
  timings.instantiateMs = Math.round(now() - t);
  t = now();
  if (lean.ccall("elab_ready", "number", [], []) !== 0) return { ok: false, refusal: "Lean did not initialize: " + log.join(" ") };
  timings.initializeMs = Math.round(now() - t);
  return { ok: true, timings, files: files.length, mb: Math.round(mb), heapMB: heapMB() };
}

self.onmessage = async ({ data }) => {
  try {
    if (data.op === "open") return self.postMessage({ op: "open", ...(await open(data.base)) });
    if (!lean) return self.postMessage({ id: data.id, op: data.op, error: "the worker is not open" });
    if (data.op === "source") { lean.FS.writeFile(data.path, data.text); return self.postMessage({ op: "source", ok: true }); }
    if (data.op === "elaborate") {
      const t = now();
      const req = JSON.stringify({ op: "elaborate", outDir: "/out", module: data.module, path: data.path });
      const answer = JSON.parse(lean.ccall("elab_request", "string", ["string"], [req]));
      return self.postMessage({ id: data.id, answer, ms: Math.round(now() - t), heapMB: heapMB() });
    }
  } catch (e) {
    self.postMessage({ id: data.id, op: data.op, error: "the worker failed: " + (e && e.message ? e.message : String(e)) });
  }
};
