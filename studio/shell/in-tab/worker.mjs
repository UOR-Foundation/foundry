// The kernel worker. It holds one instance of Lean's kernel with the pinned library resident, and judges suffixes.
// It reaches no network (served with `Content-Security-Policy: connect-src 'none'`): the page hands it bytes, and it
// re-derives every address itself before the kernel sees a byte (InTabKernel.kernelRunsOnlyOnAddressedBytes).
//
// Work is done once per address. A verdict is kept under the addresses of the kernel, the library and the suffix, so
// the same proof is not judged twice; the kernel's memory with the library resident is kept under the kernel's and
// the library's, so a later open restores it and does not read the library again. Both live in the origin's private
// file system. A read is believed only if what it holds names the addresses it was asked for and, for the image,
// re-derives to its own; anything else is a miss, and a miss does the work in full (InTabKernel.reuseAdmits).
//
//   { op: "open", manifest, glue, wasm, library? }  -> { op: "open", ok, via: "image" | "library", timings, heapMB }
//                                                      | { ok: false, need: "library" } | { ok: false, refusal }
//                                                      then { op: "kept" } once the image is stored, or not
//   { op: "check", id, suffix, sha256, fresh? }     -> { id, accepted, exit, ms, axioms, output, reused } | { id, refusal }
//   { op: "whole", id, bytes }                      -> every declaration judged, in a fresh instance; never reused
//   { op: "prove", id, app }                        -> { id, guarantees: [{ accepted, kernelMs, axioms }], ... } | { id, refusal }
//       An app's guarantees proved here, with no server and no elaborator (prove.mjs). The library must be the
//       proved checker's (live/build.sh). The worker writes each statement from `app`; the kernel judges it. The
//       facts it judges on the way stay resident, so an edited app costs what the edit changed.
//   { op: "forget" }                                -> { op: "forget", ok }: empties the store
import { prover } from "./prove.mjs";
import { statementAddress } from "./spec-app.mjs";

const now = () => performance.now();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (bytes) => hex(await crypto.subtle.digest("SHA-256", bytes));

let factory = null, wasmBinary = null, resident = null;
let addresses = null;                 // { kernel, library } once open
const memo = new Map();               // verdicts met in this worker, by key
const lines = [];
let libraryBytes = null;              // the library as read, for the tables an app's proof is written over
let proving = null;                   // prove.mjs's prover, once an app has been proved here
const handed = [];                    // the suffixes the kernel was handed during the proof in progress

// ---- the store: the origin's private file system, one file per name. It saves time and decides nothing: a failure
// to read is a miss and a failure to write is dropped.
// Where the engine has no private file system, the same names are kept in IndexedDB.
const DIR = "in-tab-kernel";
const files = typeof navigator.storage?.getDirectory === "function";
const directory = async (create) => (await navigator.storage.getDirectory()).getDirectoryHandle(DIR, { create });
const settled = (request) => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
let database = null;
const table = async (mode) => {
  if (!database) { const opening = indexedDB.open(DIR, 1); opening.onupgradeneeded = () => opening.result.createObjectStore("files"); database = await settled(opening); }
  return database.transaction("files", mode).objectStore("files");
};
async function storeGet(name) {
  try {
    if (!files) { const kept = await settled((await table("readonly")).get(name)); return kept instanceof Uint8Array ? kept : null; }
    const handle = await (await (await directory(false)).getFileHandle(name)).createSyncAccessHandle();
    try { const bytes = new Uint8Array(handle.getSize()); handle.read(bytes, { at: 0 }); return bytes; } finally { handle.close(); }
  } catch { return null; }
}
async function storePut(name, bytes) {
  try {
    if (!files) { await settled((await table("readwrite")).put(bytes, name)); return true; }
    const handle = await (await (await directory(true)).getFileHandle(name, { create: true })).createSyncAccessHandle();
    try { handle.truncate(0); handle.write(bytes, { at: 0 }); handle.flush(); } finally { handle.close(); }
    return true;
  } catch { return false; }
}
async function storeForget() {
  try {
    if (!files) { await settled((await table("readwrite")).clear()); return true; }
    await (await navigator.storage.getDirectory()).removeEntry(DIR, { recursive: true }); return true;
  } catch { return false; }
}
const text = new TextEncoder(), untext = new TextDecoder();
const json = (bytes) => { try { return bytes ? JSON.parse(untext.decode(bytes)) : null; } catch { return null; } };
// Each part after the first is a 64-character address, so their concatenation is read one way only.
const keyOf = async (...parts) => sha256(text.encode(parts.join(":")));
const heapMB = (m) => Math.round(m.HEAPU8.length / 1048576);

async function instance() {
  // The loader would fetch the module from beside itself. It is given the bytes whose address was checked instead.
  const m = await factory({ instantiateWasm: (imports, done) => { WebAssembly.instantiate(wasmBinary, imports).then((r) => done(r.instance, r.module)); return {}; }, locateFile: (p) => p, print: (s) => lines.push(s), printErr: (s) => lines.push(s) });
  if (m.ccall("checker_ready", "number", [], []) !== 0) throw new Error("the kernel did not initialize: " + lines.join(" "));
  return m;
}
function run(m, entry, bytes) {
  lines.length = 0;
  m.FS.writeFile("/in.ndjson", bytes);
  const t0 = now();
  let exit;
  try { exit = m.ccall(entry, "number", ["string"], ["/in.ndjson"]); }
  catch (e) { exit = 3; lines.push("trap: " + (e && e.message ? e.message : String(e))); }
  const ms = now() - t0;
  m.FS.unlink("/in.ndjson");
  // The kernel's own report of what each accepted theorem rests on; the verdict's axiom audit reads it.
  const axioms = {}, rest = [];
  for (const line of lines) {
    const m = /^axioms ([^:]+): ?(.*)$/.exec(line);
    if (m) axioms[m[1]] = m[2] ? m[2].split(", ") : []; else rest.push(line);
  }
  return { accepted: exit === 0, exit, ms, axioms: exit === 0 ? axioms : {}, output: rest.join("\n").slice(-400) };
}

// The kernel's memory with the library resident, restored into a fresh instance. The image was made by this origin
// from a library whose address was checked. It is used only if it names this kernel and this library and re-derives
// to the address recorded beside it.
async function openFromImage(kernel, library) {
  const name = "i-" + (await keyOf("image", kernel, library));
  const meta = json(await storeGet(name + ".json")), image = await storeGet(name + ".bin");
  if (!meta || !image || meta.kernel !== kernel || meta.library !== library || meta.bytes !== image.length) return null;
  if ((await sha256(image)) !== meta.image) return null;
  const m = await instance();
  // Grown from inside, so the loader's own views of the memory follow: an allocation the size of the image, which
  // cannot fit in what is free, freed at once.
  if (m.HEAPU8.length < image.length) m._free(m._malloc(image.length));
  if (m.HEAPU8.length < image.length) return null;
  m.HEAPU8.set(image);
  return m;
}
async function keepImage(m, kernel, library) {
  const image = m.HEAPU8.slice();     // taken with no call in progress
  const name = "i-" + (await keyOf("image", kernel, library));
  if (!(await storePut(name + ".bin", image))) return false;
  return storePut(name + ".json", text.encode(JSON.stringify({ schema: "prism/in-tab-image/1", kernel, library, image: await sha256(image), bytes: image.length })));
}

async function open({ manifest, glue, wasm, library }) {
  const timings = {};
  let t = now();
  // Address binding: everything handed over is checked before any of it is used.
  const [glueSha, wasmSha] = await Promise.all([sha256(glue), sha256(wasm)]);
  if (glueSha !== manifest.glue.sha256) return { ok: false, refusal: "the kernel's loader is not the pinned one" };
  if (wasmSha !== manifest.wasm.sha256) return { ok: false, refusal: "the kernel is not the pinned one" };
  const librarySha = library ? await sha256(library) : manifest.library.sha256;
  timings.hashMs = now() - t;
  if (librarySha !== manifest.library.sha256) return { ok: false, refusal: "the library is not the pinned one" };
  // The library is entered without checking, which is sound only if this kernel has judged it whole before.
  const b = manifest.binding;
  if (!b || b.kernel !== wasmSha || b.loader !== glueSha || b.library !== librarySha) return { ok: false, refusal: "no record that this kernel has checked this library" };
  t = now();
  const url = URL.createObjectURL(new Blob([glue], { type: "text/javascript" }));
  try { factory = (await import(url)).default; } finally { URL.revokeObjectURL(url); }
  wasmBinary = wasm;
  let m, via;
  libraryBytes = library ? new Uint8Array(library) : null; proving = null;
  if (library) {
    m = await instance();
    timings.readyMs = now() - t;
    const load = run(m, "load_library", libraryBytes);
    timings.libraryMs = load.ms;
    if (!load.accepted) return { ok: false, refusal: "the kernel refused the pinned library: " + load.output };
    via = "library";
  } else {
    m = await openFromImage(wasmSha, librarySha);
    timings.imageMs = now() - t;
    if (!m) return { ok: false, need: "library" };
    via = "image";
  }
  resident = m; addresses = { kernel: wasmSha, library: librarySha }; memo.clear();
  return { ok: true, via, timings, heapMB: heapMB(m), kernel: wasmSha, library: librarySha };
}

// One suffix, judged once per address. A kept verdict is believed only if it names the kernel, the library and the
// suffix it was asked for; `fresh` asks the kernel whatever is kept.
async function check({ id, suffix, sha256: named, fresh }) {
  if (!resident) return { id, refusal: "no library is resident" };
  // A suffix continues the resident file. Once facts are kept the file has moved on, and a suffix of the library
  // alone no longer continues it.
  if (proving && proving.resident.size) return { id, refusal: "this kernel holds kept facts; a library suffix needs a kernel that holds the library alone" };
  const bytes = new Uint8Array(suffix), t0 = now();
  const derived = await sha256(bytes);
  if (derived !== named) return { id, refusal: "the bundle is not the one named" };
  const key = await keyOf("verdict", addresses.kernel, addresses.library, derived), name = "v-" + key + ".json";
  if (!fresh) {
    const kept = memo.get(key) ?? json(await storeGet(name));
    if (kept && kept.kernel === addresses.kernel && kept.library === addresses.library && kept.suffix === derived && (kept.exit === 0 || kept.exit === 1) && kept.accepted === (kept.exit === 0)) {
      memo.set(key, kept);
      return { id, accepted: kept.accepted, exit: kept.exit, axioms: kept.axioms, output: kept.output, reused: true, ms: now() - t0, heapMB: heapMB(resident) };
    }
  }
  const r = run(resident, "check_suffix", bytes);
  // Only the kernel's own two answers are kept; a trap or a failure is not a verdict.
  if (r.exit === 0 || r.exit === 1) {
    const record = { schema: "prism/in-tab-verdict/1", ...addresses, suffix: derived, accepted: r.accepted, exit: r.exit, axioms: r.axioms, output: r.output };
    memo.set(key, record);
    await storePut(name, text.encode(JSON.stringify(record)));
  }
  return { id, ...r, reused: false, heapMB: heapMB(resident) };
}

// An app's guarantees, proved in this kernel. The proof is written over the library's tables, so the library's bytes
// are needed once: those handed over at open, or the copy kept under the library's address, re-derived before use.
async function prove({ id, app }) {
  if (!resident) return { id, refusal: "no library is resident" };
  const timings = {};
  if (!proving) {
    let t = now();
    if (!libraryBytes) {
      const kept = await storeGet("l-" + addresses.library + ".ndjson");
      if (!kept || (await sha256(kept)) !== addresses.library) return { id, need: "library" };
      libraryBytes = kept;
    }
    timings.libraryBytesMs = now() - t; t = now();
    const call = (entry, suffix) => { handed.push(suffix); const r = run(resident, entry, suffix); return { exit: r.exit, ms: r.ms, axioms: r.axioms, output: r.output }; };
    proving = prover(call, untext.decode(libraryBytes));
    libraryBytes = null;
    timings.tablesMs = now() - t;
  }
  handed.length = 0;
  const t = now(), r = proving.prove(app), ms = now() - t;
  // What the kernel guest is told of this proof, each derived here: the kernel and the library this worker checked
  // at open, the statement as read from the data the proofs were written from, and every byte the kernel was handed.
  const evidence = { kernel: addresses.kernel, library: addresses.library, statement: statementAddress(app), bundle: await sha256(text.encode(handed.join("\n"))) };
  handed.length = 0;
  return { id, ...r, evidence, timings, ms, residentFacts: proving.resident.size, heapMB: heapMB(resident) };
}

self.onmessage = async ({ data }) => {
  try {
    if (data.op === "open") {
      const answer = await open(data);
      self.postMessage({ op: "open", ...answer });
      // After answering, so keeping the image never delays the open that made it.
      // The library's bytes are kept beside the image: a later visit that proves an app needs them for its tables.
      if (answer.ok) self.postMessage({ op: "kept", ok: answer.via === "library" ? (await keepImage(resident, addresses.kernel, addresses.library)) && (await storePut("l-" + addresses.library + ".ndjson", new Uint8Array(data.library))) : true });
      return;
    }
    if (data.op === "check") return self.postMessage(await check(data));
    if (data.op === "prove") return self.postMessage(await prove(data));
    if (data.op === "forget") { memo.clear(); return self.postMessage({ op: "forget", ok: await storeForget() }); }
    if (data.op === "whole") {
      const m = await instance();
      return self.postMessage({ id: data.id, ...run(m, "check_whole", new Uint8Array(data.bytes)), heapMB: heapMB(m) });
    }
  } catch (e) {
    self.postMessage({ id: data.id, op: data.op, ok: false, refusal: "the worker failed: " + (e && e.message ? e.message : String(e)) });
  }
};
