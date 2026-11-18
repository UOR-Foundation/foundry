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

async function fetchChecked(base, entry) {
  const res = await fetch(`${base}/blobs/${entry.kappa.slice(7)}`);
  if (!res.ok) throw new Error(`missing ${entry.path ?? entry.kappa}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (kappa(bytes) !== entry.kappa) throw new Error(`κ mismatch for ${entry.path ?? entry.kappa}`);
  return bytes;
}

async function open(base) {
  const timings = {};
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
