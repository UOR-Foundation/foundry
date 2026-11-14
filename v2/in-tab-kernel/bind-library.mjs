// Has the WebAssembly kernel judge the whole pinned library, every declaration, and records the result as a binding
// of the two addresses: evidence/library-binding.json. Exits 1, writing nothing, if the kernel refuses.
//   node bind-library.mjs <built dist dir> <library.ndjson> [binding.json]
//
// The tab enters the library without checking it (`loadLibrary` in driver/Checker.lean). That is sound only for a
// library this same kernel has judged whole. The worker therefore opens only when the binding names the kernel and
// the library it was handed; a rebuilt kernel or another library needs this run again.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const [dist, libraryPath, bindingPath] = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const glue = fs.readFileSync(path.resolve(dist, "lean-kernel.mjs"));
const wasmBinary = fs.readFileSync(path.resolve(dist, "lean-kernel.wasm"));
const library = fs.readFileSync(libraryPath);
const factory = (await import(pathToFileURL(path.resolve(dist, "lean-kernel.mjs")).href)).default;
const lines = [];
const m = await factory({ instantiateWasm: (imports, done) => { WebAssembly.instantiate(wasmBinary, imports).then((r) => done(r.instance, r.module)); return {}; }, print: (s) => lines.push(s), printErr: (s) => lines.push(s) });
if (m.ccall("checker_ready", "number", [], []) !== 0) { console.error("the kernel did not initialize"); process.exit(1); }
m.FS.writeFile("/library.ndjson", library);
const t0 = performance.now();
const exit = m.ccall("check_whole", "number", ["string"], ["/library.ndjson"]);
const ms = Math.round(performance.now() - t0);
const said = lines[lines.length - 1] ?? "";
console.log(`exit ${exit} in ${ms} ms: ${said}`);
const judged = /^Accepted (\d+) declarations \((\d+) sent to the kernel\)\.$/.exec(said);
if (exit !== 0 || !judged) process.exit(1);
const binding = {
  schema: "prism/in-tab-library-binding/1",
  lean: "f054605aea4b840552cca2e725580bffd1e1b704",
  kernel: sha(wasmBinary), loader: sha(glue), library: sha(library),
  declarations: Number(judged[1]), sentToTheKernel: Number(judged[2]),
  judgedBy: "check_whole, every declaration, in this kernel",
};
fs.writeFileSync(bindingPath ?? path.join(here, "evidence", "library-binding.json"), JSON.stringify(binding, null, 1) + "\n");
console.log(JSON.stringify(binding));
