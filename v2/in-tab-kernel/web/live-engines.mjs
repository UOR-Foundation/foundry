// Runs web/live.html in each browser engine Playwright has installed and writes evidence/live-browser.json.
//   node web/live-engines.mjs <path to a playwright install>
// It starts web/serve.mjs itself: no COOP or COEP header, and the worker's network closed. A phone row is an engine
// with a phone's viewport and user agent on this machine's CPU; it says nothing of a phone's speed or memory.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const [install] = process.argv.slice(2);
const require = createRequire(pathToFileURL(path.resolve(install, "package.json")));
const { chromium, firefox, webkit, devices } = require("playwright");
const port = 8795;
const server = spawn(process.execPath, [path.join(here, "serve.mjs"), String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1200));

const targets = [
  // The installed Edge, which is Chromium: Playwright's own Chromium may not be downloaded.
  ["chromium (Microsoft Edge)", chromium, {}, { channel: "msedge" }],
  ["firefox", firefox, {}],
  ["webkit", webkit, {}],
  ["webkit, iPhone 15 viewport and user agent (emulated)", webkit, devices["iPhone 15"]],
];
const rows = [];
for (const [name, engine, context, launch] of targets) {
  const row = { engine: name };
  let browser;
  try {
    browser = await engine.launch(launch);
    row.version = browser.version();
    const page = await (await browser.newContext(context)).newPage();
    await page.goto(`http://localhost:${port}/web/live.html`);
    await page.waitForFunction(() => window.__live !== undefined, null, { timeout: 300000 });
    const r = await page.evaluate(() => window.__live);
    if (r.error) row.failed = r.error; else Object.assign(row, r);
  } catch (e) { row.failed = String(e && e.message || e).split("\n")[0].slice(0, 300); }
  finally { if (browser) await browser.close().catch(() => {}); }
  rows.push(row);
  const brief = (x) => x && (x.failed ? { failed: x.failed } : { accepted: x.accepted + " of " + x.of, factsNew: x.factsNew, ms: x.roundTripMs });
  console.log(JSON.stringify(row.failed ? { engine: name, version: row.version, failed: row.failed } : { engine: name, version: row.version, open: row.openByLibrary, first: brief(row.first), again: brief(row.again), edits: row.edits.map((e) => e.roundTripMs), later: brief(row.laterVisit), openByImage: row.openByImage, broken: row.aGuaranteeTheRulesBreak, parking: brief(row.parking) }));
}
server.kill();
fs.writeFileSync(path.join(here, "..", "evidence", "live-browser.json"), JSON.stringify({ note: "web/live.html through Playwright on one Windows 11 desktop, one run each. Playwright's WebKit is Safari's engine built for Windows, not Safari; the iPhone row is that engine with a phone's viewport and user agent, on this desktop's CPU.", rows }, null, 1) + "\n");
process.exit(rows.some((r) => r.failed) ? 1 : 0);
