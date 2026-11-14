// Times the WebAssembly kernel on the proved checker's library and on app suffixes over it, under Node.
//   node live/time.mjs <built dist dir> <library.ndjson> <suffix.ndjson> [more suffixes...]
// For each suffix: the kernel's verdict, the median and worst of 7 checks, and the axioms it reports.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [dist, libraryPath, ...suffixes] = process.argv.slice(2);
const factory = (await import(pathToFileURL(path.resolve(dist, "lean-kernel.mjs")).href)).default;
const wasmBinary = fs.readFileSync(path.resolve(dist, "lean-kernel.wasm"));
const library = fs.readFileSync(libraryPath);
const fresh = async (lines) => {
  const m = await factory({ instantiateWasm: (imports, done) => { WebAssembly.instantiate(wasmBinary, imports).then((r) => done(r.instance, r.module)); return {}; }, print: (s) => lines.push(s), printErr: (s) => lines.push(s) });
  if (m.ccall("checker_ready", "number", [], []) !== 0) throw new Error("not ready");
  return m;
};
const call = (m, lines, entry, bytes) => { lines.length = 0; m.FS.writeFile("/in.ndjson", bytes); const t = performance.now(); let exit; try { exit = m.ccall(entry, "number", ["string"], ["/in.ndjson"]); } catch (e) { exit = 3; lines.push("trap: " + e.message); } const ms = performance.now() - t; m.FS.unlink("/in.ndjson"); return { exit, ms }; };

{ // The library judged whole, every declaration: what a binding records.
  const lines = [], m = await fresh(lines);
  const r = call(m, lines, "check_whole", library);
  console.log(`library whole: exit ${r.exit} in ${Math.round(r.ms)} ms, ${Math.round(m.HEAPU8.length / 1048576)} MB: ${lines[lines.length - 1]}`);
}
const lines = [], m = await fresh(lines);
const load = call(m, lines, "load_library", library);
console.log(`library resident: exit ${load.exit} in ${Math.round(load.ms)} ms, ${Math.round(m.HEAPU8.length / 1048576)} MB: ${lines[lines.length - 1]}`);
for (const file of suffixes) {
  const bytes = fs.readFileSync(file), times = [];
  let r, said = [];
  for (let i = 0; i < 7; i++) { r = call(m, lines, "check_suffix", bytes); times.push(r.ms); said = [...lines]; }
  times.sort((a, b) => a - b);
  const axioms = said.filter((l) => l.startsWith("axioms ")).map((l) => l.slice(7));
  console.log(`${path.basename(file)} (${bytes.length} bytes): exit ${r.exit}, median ${times[3].toFixed(1)} ms, worst ${times[6].toFixed(1)} ms, ${Math.round(m.HEAPU8.length / 1048576)} MB`);
  console.log(`  ${said[said.length - 1]}`);
  for (const a of axioms) console.log(`  axioms ${a}`);
}
