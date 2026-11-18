// The browser's WASI host (wasi.mjs) against Node's own (node:wasi) on the same LexLean module and project:
// the same exit code, standard output and standard error, byte for byte, for each command given.
//   node --no-turbo-fast-api-calls wasi-agree.mjs LEXLEAN.wasm PROJECT_DIR "check --json" ["snapshot" ...]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { run } from "./wasi.mjs";

const [wasmPath, project, ...commands] = process.argv.slice(2);
const module = await WebAssembly.compile(readFileSync(wasmPath));
const files = new Map();
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) { if (n !== ".lexlean" && n !== ".lake") walk(p); } else files.set(relative(project, p).replaceAll("\\", "/"), readFileSync(p)); } };
walk(project);
let bad = 0;
for (const command of commands) {
  const args = ["lexlean", ...command.split(" ")];
  const t0 = performance.now();
  const ours = run(module, { args, files });
  const ms = Math.round(performance.now() - t0);
  // Node's host, in a child so its process-level exit does not end this one.
  const child = spawnSync(process.execPath, ["--no-turbo-fast-api-calls", "--no-warnings", "--input-type=module", "-e", `
    import { readFileSync } from "node:fs"; import { WASI } from "node:wasi";
    const wasi = new WASI({ version: "preview1", args: ${JSON.stringify(args)}, env: {}, preopens: { "/": ${JSON.stringify(project)} }, returnOnExit: true });
    const inst = await WebAssembly.instantiate(await WebAssembly.compile(readFileSync(${JSON.stringify(wasmPath)})), wasi.getImportObject());
    process.exitCode = wasi.start(inst);`], { encoding: "utf8", cwd: project, maxBuffer: 1 << 26 });
  const same = ours.exit === child.status && ours.stdout === child.stdout && ours.stderr === child.stderr;
  bad += !same;
  console.log(`${command}: ${same ? "same" : "DIFFERENT"}; exit ${ours.exit} vs ${child.status}; stdout ${ours.stdout.length} vs ${child.stdout.length} bytes; ${ms} ms`);
  if (!same) { console.log("  ours:", ours.stdout.slice(0, 300), ours.stderr.slice(0, 300)); console.log("  node:", child.stdout.slice(0, 300), child.stderr.slice(0, 300)); }
}
process.exit(bad ? 1 : 0);
