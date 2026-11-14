// Probe: can the kernel's memory, taken after the library is resident, be restored into a fresh instance instead of
// reading the library again? Reports the image's size, whether two builds of it are the same bytes, the time to
// restore it, and whether a restored kernel gives the verdict a kernel that read the library gives, on every input.
//   node snapshot-probe.mjs <built dist dir> <inputs dir> <library.ndjson> [out image]
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";
import { pathToFileURL } from "node:url";

const [dist, inputs, libraryPath, outImage] = process.argv.slice(2);
const factory = (await import(pathToFileURL(path.resolve(dist, "lean-kernel.mjs")).href)).default;
const wasmBinary = fs.readFileSync(path.resolve(dist, "lean-kernel.wasm"));
const library = fs.readFileSync(libraryPath);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const fresh = async (lines) => {
  const m = await factory({ instantiateWasm: (imports, done) => { WebAssembly.instantiate(wasmBinary, imports).then((r) => done(r.instance, r.module)); return {}; }, print: (s) => lines.push(s), printErr: (s) => lines.push(s) });
  if (m.ccall("checker_ready", "number", [], []) !== 0) throw new Error("not ready");
  return m;
};
const call = (m, entry, file, bytes) => { m.FS.writeFile(file, bytes); const t = performance.now(); let exit; try { exit = m.ccall(entry, "number", ["string"], [file]); } catch (e) { exit = 3; } m.FS.unlink(file); return { exit, ms: performance.now() - t }; };

async function image() {
  const lines = [];
  const m = await fresh(lines);
  if (call(m, "load_library", "/library.ndjson", library).exit !== 0) throw new Error("library refused: " + lines.join(" "));
  return { m, bytes: Buffer.from(m.HEAPU8) };   // a copy, taken with no call in progress
}
const a = await image(), b = await image();
const same = a.bytes.equals(b.bytes);
const gz = gzipSync(a.bytes, { level: 9 }).length;
const br = brotliCompressSync(a.bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length;
// Where two builds of the image differ, if they do.
if (!same) { let n = 0, first = -1, last = -1; for (let i = 0; i < a.bytes.length; i++) if (a.bytes[i] !== b.bytes[i]) { n++; if (first < 0) first = i; last = i; } console.log(JSON.stringify({ differingBytes: n, first, last })); }
console.log(JSON.stringify({ imageBytes: a.bytes.length, sha256: sha(a.bytes).slice(0, 16), twoBuildsSameBytes: same, gzipBytes: gz, brotli5Bytes: br }));
if (outImage) fs.writeFileSync(outImage, a.bytes);

// Restore: a fresh instance, initialized as usual, then its memory replaced by the image.
async function restored() {
  const lines = [];
  const t0 = performance.now();
  const m = await fresh(lines);
  const tReady = performance.now();
  const need = a.bytes.length - m.HEAPU8.length;
  // Grown from inside, so the loader's own views of the memory follow: an allocation the size of the image, which cannot fit in what is free, freed at once.
  if (need > 0) m._free(m._malloc(a.bytes.length));
  if (m.HEAPU8.length < a.bytes.length) throw new Error("memory could not be grown from JavaScript: " + m.HEAPU8.length);
  m.HEAPU8.set(a.bytes);
  return { m, lines, readyMs: tReady - t0, restoreMs: performance.now() - tReady };
}
let r;
try { r = await restored(); } catch (e) { console.log(JSON.stringify({ restore: "failed", why: String(e.message) })); process.exit(1); }
console.log(JSON.stringify({ readyMs: Math.round(r.readyMs), restoreMs: Math.round(r.restoreMs) }));
let agree = 0, n = 0;
for (const f of fs.readdirSync(inputs).filter((f) => f.endsWith(".ndjson")).sort()) {
  const bytes = fs.readFileSync(path.join(inputs, f)).subarray(library.length);
  a.m.FS; const viaLibrary = call(a.m, "check_suffix", "/s.ndjson", bytes);
  const viaImage = call(r.m, "check_suffix", "/s.ndjson", bytes);
  n++; if (viaLibrary.exit === viaImage.exit) agree++;
  console.log(`${f.slice(0, 12)} library ${viaLibrary.exit} (${Math.round(viaLibrary.ms)} ms)  image ${viaImage.exit} (${Math.round(viaImage.ms)} ms): ${r.lines[r.lines.length - 1]?.slice(0, 70)}`);
}
console.log(JSON.stringify({ inputs: n, sameVerdict: agree }));
