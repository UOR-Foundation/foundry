// Real IndexedDB rollback after a successful request, plus committed recovery.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { chromium } from "../vendor/prism/node_modules/playwright-core/index.mjs";
const source = fs.readFileSync(new URL("../shell/storage-request.mjs", import.meta.url));
const server = http.createServer((request, response) => {
  response.setHeader("content-type", request.url === "/storage.mjs" ? "text/javascript" : "text/html");
  response.end(request.url === "/storage.mjs" ? source : "<!doctype html><title>Storage commit acceptance</title>");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const executablePath = process.env.CHROME_BIN || ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(p => fs.existsSync(p));
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const report = await page.evaluate(async () => {
    const { storageRequest } = await import("/storage.mjs");
    const check = (v, message) => { if (!v) throw Error(message); };
    const open = () => new Promise((resolve, reject) => {
      const q = indexedDB.open("commit-boundary", 1);
      q.onupgradeneeded = () => q.result.createObjectStore("files");
      q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error);
    });
    let db = await open();
    const write = v => storageRequest(db, "files", "readwrite", s => s.put(v, "file"));
    const read = () => storageRequest(db, "files", "readonly", s => s.get("file"));
    await write("original");
    let requestSucceeded = false, refused = false;
    try {
      await storageRequest(db, "files", "readwrite", store => {
        const q = store.put("uncommitted", "file");
        q.addEventListener("success", () => { requestSucceeded = true; q.transaction.abort(); });
        return q;
      });
    } catch (e) { check(e.code === "storageTransactionFailed", "wrong abort code"); refused = true; }
    check(requestSucceeded && refused, "request success was reported as commit");
    check(await read() === "original", "aborted write survived");
    refused = false;
    try { await storageRequest(db, "files", "readwrite", s => { s.put("partial", "file"); throw Error("secret"); }); }
    catch (e) { check(e.code === "storageTransactionFailed" && !e.message.includes("secret"), "unsafe storage failure"); refused = true; }
    check(refused && await read() === "original", "synchronous failure committed queued work");
    await write("recovered"); db.close(); db = await open();
    check(await read() === "recovered", "committed write lost after reopening");
    check(await storageRequest(db, "files", "readwrite", s => s.delete("file")) === undefined, "delete result changed");
    check(await read() === undefined, "delete did not commit");
    db.close();
    refused = false;
    try { await read(); } catch (e) { refused = e.code === "storageTransactionFailed"; }
    check(refused, "closed database accepted");
    return { afterRequestAbort: "refused-and-rolled-back", synchronousFailure: "rolled-back", recovery: "committed-and-reopened", deletion: "committed", closedDatabase: "refused" };
  });
  assert.deepEqual(report, { afterRequestAbort: "refused-and-rolled-back", synchronousFailure: "rolled-back", recovery: "committed-and-reopened", deletion: "committed", closedDatabase: "refused" });
  console.log(JSON.stringify(report));
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
