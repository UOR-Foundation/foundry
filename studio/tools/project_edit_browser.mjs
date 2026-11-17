// Real IndexedDB compare-and-commit tests; preimage oracle scopes this to adapters.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { chromium } from "../vendor/prism/node_modules/playwright-core/index.mjs";
const sources = new Map([
  ["/project-edit.mjs", fs.readFileSync(new URL("../shell/project-edit.mjs", import.meta.url))],
  ["/project-creation.mjs", fs.readFileSync(new URL("../shell/project-creation.mjs", import.meta.url))],
  ["/storage.mjs", fs.readFileSync(new URL("../shell/storage-request.mjs", import.meta.url))],
  ["/blake3.mjs", fs.readFileSync(new URL("../../try/vendor/prism-code/src/blake3.mjs", import.meta.url))],
]);
const server = http.createServer((request, response) => { const source = sources.get(request.url); response.setHeader("content-type", source ? "text/javascript" : "text/html"); response.end(source || "<!doctype html><title>Atomic edit acceptance</title>"); });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const executablePath = process.env.CHROME_BIN || ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(p => fs.existsSync(p));
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const report = await page.evaluate(async () => {
    const { editStoredProject } = await import("/project-edit.mjs");
    const { prepareNewProject, createStoredProject } = await import("/project-creation.mjs");
    const { storageRequest } = await import("/storage.mjs"); const { kappa } = await import("/blake3.mjs");
    const check = (value, message) => { if (!value) throw Error(message); };
    const stores = ["apps", "chats", "files", "objects", "refs", "versions"];
    const db = await new Promise((resolve, reject) => { const q = indexedDB.open("atomic-edit", 1); q.onupgradeneeded = () => stores.forEach(s => q.result.createObjectStore(s)); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
    const get = (store, key) => storageRequest(db, store, "readonly", s => s.get(key));
    const put = (store, key, value) => storageRequest(db, store, "readwrite", s => s.put(value, key));
    const snapshot = async () => JSON.stringify(await Promise.all(stores.map(store => storageRequest(db, store, "readonly", s => s.getAll()))));
    const core = { run: ({ project, parent }) => ({ bytes: JSON.stringify({ entries: project.entries.map(e => [e.path, e.kappa, e.bytes]), name: project.label, parent }) }) };
    const boundary = { core, derive: kappa };
    const seed = async () => createStoredProject(db, await prepareNewProject({ name: "app", files: { "a.txt": "original", "b.txt": "other", "prism/spec.json": "old rules" } }, boundary));
    const first = await seed(); const appId = first.app.id;
    await put("refs", `prism:${appId}`, { phase: "proved" });
    const oid = await editStoredProject(db, { appId, filePath: "prism/spec.json", content: "new rules" }, boundary);
    check(await get("refs", `prism:${appId}`) === undefined, "stale rule state survived");
    check(await get("files", `${appId}:prism/spec.json`) === "new rules", "edit missing");
    const body = await get("objects", oid); check(kappa(body) === oid && JSON.parse(new TextDecoder().decode(body)).parent === first.oid, "snapshot parent or identity wrong");
    const versions = await get("versions", appId); check(versions.length === 2 && versions[0].oid === oid && versions[1].oid === first.oid, "history not preserved");
    for (const kind of ["changed", "added", "removed", "reference", "name"]) {
      const p = await seed(); let release, started;
      const gate = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { started = resolve; });
      const editing = editStoredProject(db, { appId: p.app.id, filePath: "a.txt", content: "candidate" }, { core, derive: async bytes => { started(); await gate; return kappa(bytes); } });
      await began;
      if (kind === "changed") await put("files", `${p.app.id}:b.txt`, "intervening");
      if (kind === "added") await put("files", `${p.app.id}:added.txt`, "intervening");
      if (kind === "removed") await storageRequest(db, "files", "readwrite", s => s.delete(`${p.app.id}:b.txt`));
      if (kind === "reference") await put("refs", `${p.app.id}:main`, "blake3:" + "f".repeat(64));
      if (kind === "name") await put("apps", p.app.id, { ...(await get("apps", p.app.id)), name: "renamed" });
      const before = await snapshot(); release();
      let refused = false; try { await editing; } catch (e) { refused = e.code === "projectEditConflict"; }
      check(refused && await snapshot() === before, `${kind} source race accepted or modified state`);
    }
    const concurrent = await seed(); let release, starts = 0, started;
    const gate = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { started = resolve; });
    const racingBoundary = { core, derive: async bytes => { if (++starts === 2) started(); await gate; return kappa(bytes); } };
    const edits = ["left", "right"].map(content => editStoredProject(db, { appId: concurrent.app.id, filePath: "a.txt", content }, racingBoundary));
    await began; release(); const outcomes = await Promise.allSettled(edits);
    check(outcomes.filter(x => x.status === "fulfilled").length === 1 && outcomes.filter(x => x.status === "rejected" && x.reason.code === "projectEditConflict").length === 1, "concurrent edits did not reject stale source");
    check((await get("versions", concurrent.app.id)).length === 2, "concurrent history corrupted");
    const before = await snapshot();
    const failingDb = { transaction(names, mode) {
      const t = db.transaction(names, mode); if (mode === "readonly") return t;
      return new Proxy(t, { get(target, key) {
        if (key === "objectStore") return name => {
          const store = target.objectStore(name); if (name !== "refs") return store;
          return { get: store.get.bind(store), put() { throw Error("injected reference write failure"); } };
        };
        const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
      }, set(target, key, value) { target[key] = value; return true; } });
    } };
    let refused = false; try { await editStoredProject(failingDb, { appId, filePath: "a.txt", content: "aborted" }, boundary); } catch (e) { refused = e.code === "projectEditStorageFailed"; }
    check(refused && await snapshot() === before, "failed edit left partial writes");
    const recovery = await editStoredProject(db, { appId, filePath: "a.txt", content: "recovered" }, boundary);
    check(await get("refs", `${appId}:main`) === recovery && await get("files", `${appId}:a.txt`) === "recovered", "recovery failed");
    db.close();
    return { exactParent: true, rulesInvalidated: true, raceKindsRefused: 5, concurrentWinner: 1, failedWrite: "rolled-back", recovery: "committed" };
  });
  assert.deepEqual(report, { exactParent: true, rulesInvalidated: true, raceKindsRefused: 5, concurrentWinner: 1, failedWrite: "rolled-back", recovery: "committed" }); console.log(JSON.stringify(report));
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
