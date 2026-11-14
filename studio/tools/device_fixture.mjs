// The device model, for browser suites that run without a GPU. A suite's server answers the three
// engine modules of shell/q/core with the files in tools/fixtures/device-engine, and everything else
// with the actual shell. The shell's closure (manifest.json, sw.js, provenance.json) is projected
// again over those three files, so the worker verifies and serves them as it does every shell file.
// Prism R4 still decides every turn: a suite exercises the one route Foundry has, the model in Prism.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = fileURLToPath(new URL("./fixtures/device-engine/", import.meta.url));
const shell = fileURLToPath(new URL("../shell/", import.meta.url));
const ENGINE = { "q/core/loader.js": "loader.js", "q/core/engine.js": "engine.js", "q/core/q-brain-fast.mjs": "q-brain-fast.mjs" };
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
let projected = null;
function project() {
  if (projected) return projected;
  const out = new Map(Object.entries(ENGINE).map(([p, f]) => [p, fs.readFileSync(path.join(dir, f))]));
  const manifest = JSON.parse(fs.readFileSync(path.join(shell, "manifest.json"), "utf8"));
  const before = manifest.closure;
  manifest.files = manifest.files.map((row) => (out.has(row.path) ? { bytes: out.get(row.path).length, path: row.path, sha256: sha(out.get(row.path)) } : row));
  const closure = sha(Buffer.from(JSON.stringify(manifest.files.map((r) => ({ bytes: r.bytes, path: r.path, sha256: r.sha256 })))));
  manifest.closure = closure;
  out.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
  for (const p of ["sw.js", "provenance.json"]) out.set(p, Buffer.from(fs.readFileSync(path.join(shell, p), "utf8").replaceAll(before, closure)));
  return (projected = out);
}
/** The bytes a suite's server answers for a path under the shell, when the fixture stands in for it; else null. */
export function deviceFixtureBytes(relative) {
  return project().get(String(relative).replace(/^\/+/, "")) ?? null;
}
/** The selection a suite stores: the device model, the one model Foundry offers. */
export const DEVICE_MODEL = { provider: "local", name: "webgpu:Bonsai" };
/** Hold the device model's next answers until `deviceRelease`. */
export const deviceHold = (page) => page.evaluate(() => { const f = (globalThis.__deviceFixture ??= { asked: [] }); f.hold = new Promise((r) => (f.release = r)); });
export const deviceRelease = (page) => page.evaluate(() => { const f = globalThis.__deviceFixture; const r = f?.release; if (f) { f.hold = null; f.release = null; } r?.(); });
/** What the device model was asked, one prompt per chat turn, since the page loaded. */
export const deviceAsked = (page) => page.evaluate(() => (globalThis.__deviceFixture?.asked ?? []).slice());
/** The answer the device model gives from now on. */
export const deviceAnswer = (page, answer) => page.evaluate((answer) => { (globalThis.__deviceFixture ??= { asked: [] }).answer = answer; }, answer);
