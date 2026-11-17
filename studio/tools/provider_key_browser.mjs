import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { chromium } from "../vendor/prism/node_modules/playwright-core/index.mjs";
const source = fs.readFileSync(new URL("../shell/provider-key-validation.mjs", import.meta.url));
let aborted = 0, redirected = 0;
const server = http.createServer((request, response) => {
  if (request.url === "/") { response.setHeader("content-type", "text/html"); response.end("<!doctype html><title>Credential boundary acceptance</title>"); return; }
  if (request.url === "/key.mjs") { response.setHeader("content-type", "text/javascript"); response.end(source); return; }
  if (request.url === "/redirect") { response.writeHead(302, { location: "/leak" }); response.end(); return; }
  if (request.url === "/leak") { redirected++; response.end(); return; }
  if (request.url !== "/success" && request.url !== "/stall") { response.writeHead(404); response.end(); return; }
  assert.equal(request.headers.authorization, "Bearer synthetic-key");
  response.setHeader("content-type", "application/json");
  if (request.url === "/stall") { response.flushHeaders(); response.on("close", () => { aborted++; }); return; }
  response.end(JSON.stringify({ data: { label: "browser-test", is_free_tier: false } }));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const executablePath = process.env.CHROME_BIN || ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(path => fs.existsSync(path));
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const report = await page.evaluate(async () => {
    const { validateProviderKey } = await import("/key.mjs");
    const input = { provider: "openrouter", apiKey: "synthetic-key" };
    const local = path => (url, options) => fetch(path, options);
    const refused = async (operation, code) => { try { await operation(); throw Error("unexpected success"); } catch (error) { if (error.code !== code) throw error; } };
    const success = await validateProviderKey(input, { fetch: local("/success") });
    await refused(() => validateProviderKey(input, { fetch: local("/redirect") }), "keyValidationNetworkFailed");
    await refused(() => validateProviderKey(input, { fetch: local("/stall"), timeoutMs: 100 }), "keyValidationTimedOut");
    const controller = new AbortController();
    await refused(() => validateProviderKey(input, { signal: controller.signal, fetch: async (url, options) => { const response = await local("/stall")(url, options); controller.abort(); return response; } }), "keyValidationCancelled");
    return { success, redirect: "refused", deadline: "refused", cancellation: "refused" };
  });
  await page.waitForTimeout(50); assert.equal(aborted, 2); assert.equal(redirected, 0); assert.equal(report.success.ok, true);
  console.log(JSON.stringify({ ...report, closedConnections: aborted, redirectTargetsReached: redirected }));
} finally { if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
