// The in-tab proof as a browser runs it: shell/in-tab/worker.mjs in a real worker, with its storage and its address
// checks, and the pinned Forge kernel guest deciding the verdict. Prints one row per engine; exits 1 if any fails.
//   node tools/in_tab_prove_browser.mjs <path to a playwright install>
// It serves shell/ as a static host does: no COOP or COEP header.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const shell = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "shell");
const require = createRequire(pathToFileURL(path.resolve(process.argv[2], "package.json")));
const { chromium, firefox, webkit } = require("playwright");

const page = `<!doctype html><meta charset="utf-8"><title>in-tab proof</title><script type="module">
import { proveInTab, closeInTabProof } from "./in-tab/client.mjs";
const module = await WebAssembly.compileStreaming(fetch("./kernel/guest.wasm"));
const guest = { dispatch: async (request) => {
  const { memory, holo_alloc, holo_run } = (await WebAssembly.instantiate(module, {})).exports, at = holo_alloc(request.length);
  new Uint8Array(memory.buffer, at, request.length).set(request);
  const packed = BigInt.asUintN(64, BigInt(holo_run(at, request.length)));
  return new Uint8Array(memory.buffer, Number(packed >> 32n), Number(packed & 0xffffffffn)).slice();
} };
const parking = {
  fields: [{ name: "hours", kind: "number", min: 0, max: 24 }, { name: "vehicle", kind: "choice", values: ["car", "van", "truck"] }],
  outcomes: ["free", "standard", "premium"], otherwise: "standard",
  rules: [{ id: "REQ-001", when: [{ field: "hours", op: "=", value: 0 }], then: "free" }, { id: "REQ-002", when: [{ field: "vehicle", op: "is", value: "truck" }], then: "premium" }, { id: "REQ-003", when: [{ field: "hours", op: ">", value: 12 }], then: "premium" }],
  properties: [{ id: "INV-001", kind: "never", when: [{ field: "hours", op: "=", value: 0 }], then: "premium" }, { id: "INV-002", kind: "always", when: [{ field: "hours", op: ">", value: 12 }, { field: "vehicle", op: "is not", value: "truck" }], then: "premium" }],
};
const timed = async (spec) => { const t = performance.now(), r = await proveInTab(spec, { guest }); return { ms: Math.round(performance.now() - t), ok: r.ok, why: r.why, verdict: r.record?.verdict, opened: r.record?.opened, facts: r.record?.facts, judged: r.record?.factsJudged, axioms: r.record?.axioms }; };
try {
  const out = { crossOriginIsolated: self.crossOriginIsolated };
  out.first = await timed(parking);
  out.again = await timed(parking);
  out.edited = await timed({ ...parking, rules: parking.rules.map((r, k) => (k === 2 ? { ...r, when: [{ field: "hours", op: ">", value: 11 }] } : r)) });
  out.broken = await timed({ ...parking, properties: [parking.properties[0], { ...parking.properties[1], kind: "never" }] });
  // A new worker, as on a later visit: the kernel from its kept image, the library's bytes from beside it.
  await closeInTabProof();
  out.later = await timed(parking);
  window.__proof = out;
} catch (e) { window.__proof = { error: String(e && e.message || e) }; }
</script>`;
const types = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".json": "application/json", ".wasm": "application/wasm" };
const server = createServer(async (req, res) => {
  const name = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (name === "/proof.html") return res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }).end(page);
  const file = path.normalize(path.join(shell, name));
  if (!file.startsWith(shell)) return res.writeHead(403).end();
  let body;
  try { body = await readFile(file); } catch { return res.writeHead(404).end(); }
  res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://localhost:${server.address().port}/proof.html`;

let failed = 0;
// The installed Edge is Chromium; Playwright's own Chromium may not be downloaded.
for (const [name, engine, launch] of [["chromium (Microsoft Edge)", chromium, { channel: "msedge" }], ["firefox", firefox], ["webkit", webkit]]) {
  let browser, row = { engine: name };
  try {
    browser = await engine.launch(launch);
    row.version = browser.version();
    const tab = await (await browser.newContext()).newPage();
    await tab.goto(url);
    await tab.waitForFunction(() => window.__proof !== undefined, null, { timeout: 180000 });
    const r = await tab.evaluate(() => window.__proof);
    if (r.error) throw new Error(r.error);
    for (const k of ["first", "again", "edited", "later"]) { assert.equal(r[k].ok, true, k + ": " + r[k].why); assert.equal(r[k].verdict, "proved", k); assert.deepEqual(r[k].axioms, ["Quot.sound", "propext"], k); }
    assert.equal(r.first.opened, "library"); assert.equal(r.first.judged, r.first.facts);
    assert.equal(r.again.judged, 0);
    assert.ok(r.edited.judged > 0 && r.edited.judged < r.first.facts);
    assert.equal(r.broken.ok, false); assert.match(r.broken.why, /said refused: Lean's kernel refused INV-002/);
    assert.equal(r.later.opened, "image");
    Object.assign(row, { crossOriginIsolated: r.crossOriginIsolated, firstMs: r.first.ms, againMs: r.again.ms, editedMs: r.edited.ms, laterVisitMs: r.later.ms, facts: r.first.facts, editJudged: r.edited.judged, brokenGuarantee: "refused" });
  } catch (e) { failed++; row.failed = String(e && e.message || e).split("\n").filter(Boolean).slice(0, 5).join(" | ").slice(0, 400); }
  finally { if (browser) await browser.close().catch(() => {}); }
  console.log(JSON.stringify(row));
}
server.close();
process.exit(failed ? 1 : 0);
