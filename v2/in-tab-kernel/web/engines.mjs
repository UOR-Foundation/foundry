// Runs web/bench.html in each browser engine Playwright has installed and writes evidence/engines.json.
//   node web/engines.mjs <path to a playwright install> [runs]
// It starts web/serve.mjs itself: no COOP or COEP header, and the worker's network closed. A phone row is an engine
// with a phone's viewport and user agent on this machine's CPU; it says nothing of a phone's speed or memory.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const [install, runs = "7"] = process.argv.slice(2);
const require = createRequire(pathToFileURL(path.resolve(install, "package.json")));
const { firefox, webkit, devices } = require("playwright");
const port = 8794;
const server = spawn(process.execPath, [path.join(here, "serve.mjs"), String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1200));

const targets = [
  ["firefox", firefox, {}],
  ["webkit", webkit, {}],
  ["webkit, iPhone 15 viewport and user agent (emulated)", webkit, devices["iPhone 15"]],
];
const rows = [];
for (const [name, engine, context] of targets) {
  const row = { engine: name };
  let browser;
  try {
    browser = await engine.launch();
    row.version = browser.version();
    const page = await (await browser.newContext(context)).newPage();
    await page.goto(`http://localhost:${port}/web/bench.html?runs=${runs}&whole=1`);
    await page.waitForFunction(() => window.__bench !== undefined, null, { timeout: 300000 });
    const r = await page.evaluate(() => window.__bench);
    if (r.error || !r.summary) row.failed = r.error ?? r.openByLibrary?.refusal ?? "no summary";
    else {
      const inputs = Object.values(r.inputs), span = (k) => { const xs = inputs.map((x) => x[k]).filter((x) => typeof x === "number"); return xs.length ? [Math.round(Math.min(...xs) * 10) / 10, Math.round(Math.max(...xs) * 10) / 10] : null; };
      const ms = (x) => x === undefined ? null : Math.round(x);
      Object.assign(row, {
        userAgent: r.userAgent, crossOriginIsolated: r.crossOriginIsolated,
        fetchKernelMs: ms(r.fetchKernelMs), fetchLibraryMs: ms(r.fetchLibraryMs),
        openByLibrary: { totalMs: ms(r.openByLibrary.totalMs), libraryMs: ms(r.openByLibrary.timings.libraryMs), heapMB: r.openByLibrary.heapMB },
        imageKept: r.imageKept, keepImageMs: ms(r.keepImageMs),
        openByImage: r.openByImage.ok ? { totalMs: ms(r.openByImage.totalMs), imageMs: ms(r.openByImage.timings.imageMs), heapMB: r.openByImage.heapMB } : { failed: r.openByImage.need ?? r.openByImage.refusal },
        judged: { kernelMs: span("kernelMs"), roundTripMs: span("judgedRoundTripMs") },
        reused: { medianMs: span("againMs"), worstMs: span("againWorstMs")?.[1] ?? null },
        laterVisit: { reusedMs: span("laterMs"), kernelOnImageMs: span("onImageKernelMs") },
        wholeFromNothing: r.whole && { accepted: r.whole.accepted, ms: ms(r.whole.kernelMs), heapMB: r.whole.heapMB },
        faults: Object.fromEntries(Object.entries(r.faults).map(([k, v]) => [k, v.notRun ? "not run: " + v.notRun : v.refused ? "refused" : "ACCEPTED: " + v.says])),
        summary: r.summary,
      });
    }
  } catch (e) { row.failed = String(e && e.message || e).split("\n")[0].slice(0, 300); }
  finally { if (browser) await browser.close().catch(() => {}); }
  rows.push(row);
  console.log(JSON.stringify(row.failed ? { engine: name, version: row.version, failed: row.failed } : { engine: name, version: row.version, openByLibrary: row.openByLibrary, openByImage: row.openByImage, keepImageMs: row.keepImageMs, judged: row.judged, reused: row.reused, laterVisit: row.laterVisit, faults: row.faults, summary: row.summary }));
}
server.kill();
fs.writeFileSync(path.join(here, "..", "evidence", "engines.json"), JSON.stringify({ note: "web/bench.html through Playwright on one Windows 11 desktop. Playwright's WebKit is Safari's engine built for Windows, not Safari on a Mac or a phone. Chromium is in evidence/browser.json.", runs: Number(runs), rows }, null, 1) + "\n");
process.exit(rows.some((r) => r.failed) ? 1 : 0);
