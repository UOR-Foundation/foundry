// Module results by κ: a module anyone has already built costs a check, not an elaboration.
//
// Why. Elaboration is search; checking is cheap. A module's result is a function of everything elaboration reads, so
// once those inputs are named by κ, the result can be reused from any store, provided it is checked on read.
//
// How. Two keys, both BLAKE3 (prism-code's, checked against the official vectors) over a framed recipe:
//   recipe key = κ(engine, Lean release, module name, κ of the source). It maps to the imports Lean parsed from that
//                source, so no header is parsed here.
//   result key = κ(recipe key, and for each import its κ: the toolchain release for Lean's own library, the runtime
//                folder's κ, or the κ of the artifacts this build resolved). It maps to the module's four artifacts.
// Artifacts are stored as blobs named by their κ. On read every blob is hashed again, and the driver's `--check`
// imports the module and replays every declaration through the kernel over its imports. Any failure is a miss, and a
// miss elaborates in full in a fresh process, whose artifacts are byte-identical to native Lean's; only those are
// stored. Imports resolve in the driver's search order: Lean's library, then the runtime, then this build's output.
//
// What it does not do yet: attest who built a stored result. The kernel check proves every declaration valid; it
// cannot prove that the stored result is the one for this recipe. Locally the store is written only by this script;
// a shared store needs the builder's signature (GitHub's attestation) before a result is trusted.
//
//   node kappa-store.mjs native|wasm STORE OUTDIR Module=path ...   (cwd: the spike's work folder; LEAN_SYSROOT,
//   LEAN_PATH set as for the driver). Prints one JSON line per module: hit or miss, timings, the driver's answer.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { kappa } from "../../../studio/shell/prism-code/src/blake3.mjs";

const [target, store, outDir, ...specs] = process.argv.slice(2);
const LEAN = "lean 4.32.2 f3b06c705e6c85f5314019d5d3baab0fec5b580c";
const EXTS = [".olean", ".olean.server", ".olean.private", ".ir"];
const sysroot = process.env.LEAN_SYSROOT, rt = process.env.LEAN_PATH;
const engine = target === "native" ? "driver/.lake/build/bin/elab" : "dist-node/lean-elab.wasm";
const run = (args) => target === "native"
  ? execFileSync(engine, args, { encoding: "utf8", maxBuffer: 1 << 28 })
  : execFileSync(process.execPath, ["--stack-size=8192", "dist-node/lean-elab.js", ...args], { encoding: "utf8", maxBuffer: 1 << 28 });

const k = (value) => kappa(new TextEncoder().encode(JSON.stringify(value)));
const filesUnder = (dir) => readdirSync(dir, { recursive: true }).map(String).filter((f) => statSync(join(dir, f)).isFile()).sort();
// The engine and the runtime are named by their bytes, once per run.
const engineK = kappa(readFileSync(engine));
const rtK = k(filesUnder(rt).map((f) => [f, kappa(readFileSync(join(rt, f)))]));
const path = (root, mod, ext) => join(root, ...mod.split(".")) + ext;
const artifactsK = (root, mod) => k(EXTS.map((e) => [e, kappa(readFileSync(path(root, mod, e)))]));
const importK = (mod) => existsSync(path(join(sysroot, "lib", "lean"), mod, ".olean")) ? ["toolchain", LEAN]
  : existsSync(path(rt, mod, ".olean")) ? ["runtime", rtK]
  : existsSync(path(outDir, mod, ".olean")) ? ["built", artifactsK(outDir, mod)] : null;

const read = (dir, key) => { const f = join(store, dir, key.slice(7)); return existsSync(f) ? readFileSync(f) : null; };
const write = (dir, key, bytes) => { mkdirSync(join(store, dir), { recursive: true }); writeFileSync(join(store, dir, key.slice(7)), bytes); };
const answer = (out) => out.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l)).at(-1);
const now = () => Number(process.hrtime.bigint() / 1000000n);

for (const spec of specs) {
  const [mod, src] = spec.split("=");
  const t0 = now();
  const recipe = k(["lexlean/elab-recipe/1", engineK, LEAN, mod, kappa(readFileSync(src))]);
  const resultKey = (imports) => {
    const ks = imports.map((m) => [m, importK(m)]);
    return ks.some(([, x]) => x === null) ? null : k(["lexlean/elab-result/1", recipe, ks]);
  };
  let hit = null, why = "no recipe";
  const rec = read("recipes", recipe);
  const rkey = rec && resultKey(JSON.parse(rec).imports);
  const res = rkey && read("results", rkey);
  if (rec && !res) why = "no result";
  if (res) {
    // Checked on read: each blob's κ again, then the kernel over the imports.
    const arts = JSON.parse(res).artifacts;
    const blobs = EXTS.map((e) => [e, read("blobs", arts[e])]);
    if (blobs.some(([e, b]) => !b || kappa(b) !== arts[e])) why = "blob κ mismatch";
    else {
      for (const [e, b] of blobs) { mkdirSync(dirname(path(outDir, mod, e)), { recursive: true }); writeFileSync(path(outDir, mod, e), b); }
      const j = answer(run(["--check", outDir, mod]));
      if (j?.elaborated && j.replayRefused === null) hit = j;
      else { why = `check refused: ${j?.replayRefused ?? j?.checkRefused}`; for (const e of EXTS) rmSync(path(outDir, mod, e), { force: true }); }
    }
  }
  const t1 = now();
  if (hit) { console.log(JSON.stringify({ ...hit, store: "hit", storeMs: t1 - t0 })); continue; }
  // A miss: elaborate in a fresh process, then store what it wrote.
  const j = answer(run([outDir, spec]));
  const t2 = now();
  if (j?.elaborated && j.replayRefused === null) {
    write("recipes", recipe, JSON.stringify({ imports: j.imports }));
    const artifacts = Object.fromEntries(EXTS.map((e) => { const b = readFileSync(path(outDir, mod, e)); const x = kappa(b); write("blobs", x, b); return [e, x]; }));
    write("results", resultKey(j.imports), JSON.stringify({ artifacts }));
  }
  console.log(JSON.stringify({ ...j, store: "miss", why, storeMs: t1 - t0, elabTotalMs: t2 - t1 }));
}
