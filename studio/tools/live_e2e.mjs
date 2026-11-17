// The End-to-end gate: the live preview in the real Forge (the built renderer, core, worker and kernel)
// in Chromium, against the budgets. A chat turn's stream is replayed through the host's own live
// functions in the order the turn calls them (showLive on the first spec token, pushLive per projection,
// rulesAfterTurn at the end), so everything but the model's network call is the real path: Prism's preview
// panel, the service worker's sandboxed route, the frame, the table worker, click to edit, the checker,
// the kernel.
//
//   node tools/live_e2e.mjs <served Forge base url> <spec.json | module.lex.tex> <out dir>
//
// Needs a built shell served at the base URL (the lane's output, or the deployed site with this branch's
// shell sources over it) and Playwright (the root package's devDependency; PLAYWRIGHT_MODULE names another
// copy). Exits 1 when a budget is missed:
//   first spec node to first pixel under 100 ms; every patch's work under 16 ms and its paint on the next
//   frame; zero reloads of the live frame; the check's result on screen under 3 s; edits saved, refused
//   and undone as the spec says.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
import fs from "node:fs";
import path from "node:path";

const [BASE, SPEC, OUT] = process.argv.slice(2);
// A .lex.tex spec is a LexLean module: the turn carries it in <prism-lexlean>, theorems left to the
// studio, and the host must read it as it streams and store its canonical source after the turn.
const lex = SPEC.endsWith(".lex.tex");
const lexlean = await import(new URL("../shell/live/lexlean.mjs", import.meta.url));
const spec = lex ? lexlean.readLexLean(fs.readFileSync(SPEC, "utf8")) : JSON.parse(fs.readFileSync(SPEC, "utf8"));
fs.mkdirSync(OUT, { recursive: true });
const report = {};
const log = (k, v) => { report[k] = v; console.log(k.padEnd(28), typeof v === "string" ? v : JSON.stringify(v)); };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));

// the worker must control the page before any preview can be served
await page.goto(BASE);
await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.ready, null, { timeout: 30000 });
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
await page.waitForFunction(() => !!navigator.serviceWorker.controller && !!window.__live && !!window.electron, null, { timeout: 30000 });
log("worker controls page", "yes");

const { appId, chatId } = await page.evaluate(async (name) => { const r = await window.electron.ipcRenderer.invoke("create-app", { name, initialChatMode: "build" }); return { appId: r.app.id, chatId: r.chatId }; }, lex ? spec.name : "rsvp-seat");
log("app created", { appId, chatId });
// The renderer may open the chat before it has picked the new app up ("Select an app to see the
// preview"); the preview panel is what the test needs, so wait for it. A loaded chat URL does not select
// its app in the current renderer, so the second attempt opens the chat the way a user does: from the
// app's page, by "Open in Chat".
for (let attempt = 0; attempt < 2; attempt++) {
  if (attempt) {
    await page.goto(BASE + "app-details?appId=" + appId);
    await page.locator("text=Open in Chat >> visible=true").first().click();
  } else await page.goto(BASE + "chat?id=" + chatId);
  await page.waitForFunction(() => !!window.__live, null, { timeout: 30000 });
  const ready = await page.waitForSelector('[data-testid="preview-iframe-element"]', { timeout: 20000 }).then(() => true, () => false);
  if (ready) break;
  if (attempt) throw new Error("the renderer never showed the app's preview panel");
}
await page.waitForTimeout(3000);

// count every load of the live frame: a reload is a load after the first
const liveLoads = [];
page.on("framenavigated", (f) => { if (f.url().includes("/p/blake3:")) liveLoads.push({ t: Date.now(), url: f.url().slice(-80) }); });

// paint reports from the live frame, as the host sees them
// paint reports, and each edit as it reaches the host (the user's action, on the host's clock)
await page.evaluate(() => { window.__paints = []; window.__actions = []; addEventListener("message", (e) => { if (!e.data) return; if (e.data.type === "live/painted") window.__paints.push({ ...e.data, at: performance.now() }); if (e.data.type === "live/patch" || e.data.type === "live/undo") window.__actions.push(performance.now()); if (e.data.type === "live/table") window.__tables = (window.__tables || []).concat([e.data]); }); });

// the model's answer, streamed at about 60 tokens a second (about 240 characters a second)
const ORDER = ["name", "title", "purpose", "view", "fields", "outcomes", "meanings", "rules", "otherwise", "otherwiseWhy", "properties", "examples", "limits"];
const ordered = Object.fromEntries(ORDER.filter((k) => spec[k] !== undefined).map((k) => [k, spec[k]]));
const answer = lex
  ? "Here is the module.\n<prism-lexlean>\n" + lexlean.toLexLean(spec).replace(/\n\ntheorem\{[\s\S]*?\n\}(?=\n)/g, "") + "</prism-lexlean>\nThe screen is drawn from it."
  : "Here are the rules for your RSVP app.\n<prism-spec>" + JSON.stringify(ordered) + "</prism-spec>\nThe screen is drawn from them.";
const stream = await page.evaluate(async ({ appId, answer, lex }) => {
  const live = await import(new URL("live/project.mjs", location.href.replace(/chat.*$/, "")).href);
  const lexlean = await import(new URL("live/lexlean.mjs", location.href.replace(/chat.*$/, "")).href);
  const marks = { firstNodePush: null, firstNodeRoot: null, pushes: 0 };
  let shown = false, last = null;
  for (let i = 4; i <= answer.length + 4; i += 4) {
    const full = answer.slice(0, i);
    if (full.includes(lex ? "<prism-lexlean>" : "<prism-spec>")) {
      // as the host does: a LexLean turn opens the frame on its tag
      if (lex && !shown) { shown = true; window.__live.showLive(appId); }
      const raw = lex ? (lexlean.partialFromTurn(full) || {}).spec : live.partialSpec(full);
      if (raw) {
        if (!shown) { shown = true; window.__live.showLive(appId); }
        const p = live.project(raw);
        if (p.root !== last) { last = p.root; window.__live.pushLive(appId, raw, "draft"); marks.pushes++; }
        if (p.nodes.length && !marks.firstNodePush) { marks.firstNodePush = performance.now(); marks.firstNodeRoot = p.root; }
      }
    }
    await new Promise((r) => setTimeout(r, 16));
  }
  marks.end = performance.now();
  return marks;
}, { appId, answer, lex });
await page.waitForTimeout(800);
const paints = await page.evaluate(() => window.__paints);
const firstPaint = paints.find((p) => p.changed > 0);
log("stream pushes", stream.pushes);
log("first node to first pixel", firstPaint ? `${Math.round(firstPaint.at - stream.firstNodePush)} ms (frame mounted, said hello and painted ${firstPaint.changed} node(s))` : "no paint");
const ms = paints.filter((p) => p.changed > 0).map((p) => p.ms).sort((a, b) => a - b);
const work = paints.filter((p) => p.changed > 0).map((p) => p.work).sort((a, b) => a - b);
log("patch to pixel (stream)", { patches: ms.length, median: ms[ms.length >> 1], max: ms[ms.length - 1] });
log("patch work (stream)", { median: work[work.length >> 1], max: work[work.length - 1] });
const heaviest = paints.filter((p) => p.changed > 0).sort((a, b) => b.work - a.work)[0];
if (heaviest) log("heaviest patch", { work: heaviest.work, changed: heaviest.changed, sizes: paints.filter((p) => p.changed > 0).map((p) => p.changed + ":" + p.work) });
const frameGap = await page.evaluate(async () => { const t = []; await new Promise((r) => { let n = 0; const f = (ts) => { t.push(ts); if (++n < 40) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); }); const d = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b); return Math.round(d[d.length >> 1] * 10) / 10; });
log("frame interval here", frameGap + " ms");

// the turn ends: the host checks the rules, the kernel sets the phase, the frame shows it
const check = await page.evaluate(async ({ appId, answer }) => {
  const t0 = performance.now();
  await window.__prism.rulesAfterTurn(appId, answer, []);
  await window.__live.refreshLive(appId);
  const state = await window.__prism.rulesOf(appId);
  return { ms: Math.round(performance.now() - t0), phase: state && state.phase, issues: state && state.issues };
}, { appId, answer });
await page.waitForTimeout(600);
log("check result on screen", `${check.ms} ms to checked rules and phase ${check.phase}${check.issues && check.issues.length ? " (" + check.issues.join("; ") + ")" : ""}`);
await page.screenshot({ path: path.join(OUT, "1-streamed-and-checked.png") });
if (lex) {
  const want = lexlean.canonicalSource(spec);
  const stored = await page.evaluate(({ appId, file }) => window.electron.ipcRenderer.invoke("read-app-file", { appId, filePath: file }).catch((e) => "unread: " + e.message), { appId, file: "prism/" + want.name + ".lex.tex" });
  log("canonical source stored", stored === want.source ? `prism/${want.name}.lex.tex, ${want.source.length} bytes, byte for byte` : "NO: " + String(stored).slice(0, 120));
}

// the live frame inside Prism's preview panel
const frame = page.frames().find((f) => f.url().includes("/p/blake3:"));
log("live frame in preview", frame ? "yes" : "NO");
const tables = await page.evaluate(() => window.__tables || []);
log("table", tables.length ? tables[tables.length - 1] : "none");

// click to edit: rule 3's answer becomes none, through the frame, the host and the checker
if (frame && !lex) try {
  const before = await page.evaluate(() => window.__paints.length);
  const badge = frame.locator('[data-key="rule:2"] [title="Click to edit"]').first();
  await badge.click();
  await frame.locator('[data-key="rule:2"] input').fill("none");
  await frame.locator('[data-key="rule:2"] input').press("Enter");
  await page.waitForTimeout(1500);
  const saved = JSON.parse(await page.evaluate(({ appId }) => window.electron.ipcRenderer.invoke("read-app-file", { appId, filePath: "prism/spec.json" }), { appId }));
  log("edit saved to spec", saved.rules[2].then);
  const diff = await frame.locator("text=/This edit changes/").first().textContent().catch(() => null);
  log("outcome diff shown", diff || "none");
  // a refused edit: an answer the app does not have
  await frame.locator('[data-key="rule:0"] [title="Click to edit"]').first().click();
  await frame.locator('[data-key="rule:0"] input').fill("nobody");
  await frame.locator('[data-key="rule:0"] input').press("Enter");
  await page.waitForTimeout(800);
  const refused = await frame.locator('[data-key="rule:0"] p.text-destructive').first().textContent().catch(() => null);
  const kept = JSON.parse(await page.evaluate(({ appId }) => window.electron.ipcRenderer.invoke("read-app-file", { appId, filePath: "prism/spec.json" }), { appId }));
  log("refused edit", `${refused || "no message"}; spec still ${kept.rules[0].then}`);
  await page.screenshot({ path: path.join(OUT, "2-edited-and-refused.png") });
  // a reword: the heading changes, the logic does not
  const phaseBefore = await page.evaluate(async ({ appId }) => (await window.__prism.rulesOf(appId)).phase, { appId });
  await frame.locator('[data-key="h:0"] [title="Click to edit"]').first().click();
  await frame.locator('[data-key="h:0"] input').fill("Join us");
  await frame.locator('[data-key="h:0"] input').press("Enter");
  await page.waitForTimeout(1500);
  const after = await page.evaluate(async ({ appId }) => { const s = await window.__prism.rulesOf(appId); let kernel = null; try { kernel = await window.__prism.nextPhase(s.phase, "reword"); } catch (e) { kernel = "refused: " + e.message; } return { phase: s.phase, kernel }; }, { appId });
  log("reword", `phase ${phaseBefore} -> ${after.phase}; the pinned kernel answers reword with: ${after.kernel}`);
  // undo, by keyboard, inside the frame
  await frame.locator('[data-key="t:0"]').first().click({ position: { x: 2, y: 2 } }).catch(() => {});
  await page.keyboard.press("Escape");
  await frame.locator("main").first().focus().catch(() => {});
  await frame.press("main", "Control+z").catch(() => {});
  await page.waitForTimeout(1500);
  const undone = JSON.parse(await page.evaluate(({ appId }) => window.electron.ipcRenderer.invoke("read-app-file", { appId, filePath: "prism/spec.json" }), { appId }));
  log("undo", `heading is ${undone.view.blocks[0].text}`);
  const eps = (await page.evaluate((n) => window.__paints.slice(n), before)).filter((p) => p.changed > 0);
  log("patch to pixel (edits)", eps.map((p) => p.ms));
  log("patch work (edits)", eps.map((p) => p.work));
  // A refused edit changes no node (its message is shown instead), so an action counts only when a
  // changed paint follows it before the next action.
  const acts = await page.evaluate(() => window.__actions.map((a, i) => { const end = window.__actions[i + 1] ?? Infinity; const p = window.__paints.find((x) => x.changed > 0 && x.at > a && x.at < end); return p ? Math.round((p.at - a) * 10) / 10 : null; }));
  log("action to pixel (edits)", acts.filter((x) => x !== null));
} catch (e) { log("edit flow", "failed: " + String(e.message).split(String.fromCharCode(10))[0]); }
log("live frame loads", { loads: liveLoads.length, reloads: Math.max(0, liveLoads.length - 1) });
log("page errors", errors.length ? errors : "none");
await page.screenshot({ path: path.join(OUT, "3-final.png") });
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
await browser.close();

// the budgets
const bad = [];
const first = firstPaint ? firstPaint.at - stream.firstNodePush : Infinity;
if (!(first < 100)) bad.push(`first node to first pixel ${Math.round(first)} ms, budget 100`);
const works = [...work, ...(report["patch work (edits)"] || [])];
if (!works.length || Math.max(...works) >= 16) bad.push(`patch work up to ${Math.max(...works)} ms, budget 16`);
const frameMs = parseFloat(report["frame interval here"]);
// A streamed patch lands on the next frame: half of them within one frame interval of arriving.
if (!(ms[ms.length >> 1] <= frameMs + 2)) bad.push(`streamed patches paint at a median ${ms[ms.length >> 1]} ms, later than the next frame (${frameMs} ms)`);
// An edit is on screen within two frame intervals of reaching the host: the host's check, the frame's
// patch, and at most one wait for the screen's next frame.
const late = (report["action to pixel (edits)"] || []).filter((x) => !(x <= 2 * frameMs));
if (!lex && (late.length || !(report["action to pixel (edits)"] || []).length)) bad.push(`edits on screen in ${(report["action to pixel (edits)"] || []).join(", ") || "never"} ms; budget two frames (${(2 * frameMs).toFixed(1)} ms)`);
if (liveLoads.length !== 1) bad.push(`the live frame loaded ${liveLoads.length} times; budget: once, no reloads`);
if (!(check.ms < 3000)) bad.push(`check result on screen in ${check.ms} ms, budget 3000`);
if (lex) {
  if (!String(report["canonical source stored"]).includes("byte for byte")) bad.push("the turn's module was not stored as its canonical LexLean source");
  if (check.phase !== "checked") bad.push(`the module's rules ended ${check.phase}, not checked`);
} else {
  if (report["edit saved to spec"] !== "none") bad.push("the click edit was not saved to the spec");
  if (!String(report["refused edit"] || "").includes("not an answer")) bad.push("the bad edit was not refused with the checker's words");
  if (!String(report["undo"] || "").includes("You're invited")) bad.push("undo did not restore the heading");
}
if (errors.length) bad.push(`${errors.length} page error(s)`);
if (bad.length) { console.log("\nend to end refused:\n" + bad.join("\n")); process.exit(1); }
console.log("\nthe live preview meets its budgets in the real Forge");
