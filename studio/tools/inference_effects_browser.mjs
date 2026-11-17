import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { chromium } from "../vendor/prism/node_modules/playwright-core/index.mjs";
const source = fs.readFileSync(new URL("../shell/inference-effects.mjs", import.meta.url));
const stream = 'data: {"choices":[{"index":0,"delta":{"content":"browser 🌱"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
let aborted = 0;
const server = http.createServer((request, response) => {
  if (request.url === "/") { response.setHeader("content-type", "text/html"); response.end("<!doctype html><title>Cloud transport acceptance</title>"); return; }
  if (request.url === "/effects.mjs") { response.setHeader("content-type", "text/javascript"); response.end(source); return; }
  if (request.url === "/success") { response.setHeader("content-type", "text/event-stream"); response.end(stream); return; }
  if (request.url === "/stall") {
    response.setHeader("content-type", "text/event-stream"); response.flushHeaders();
    response.on("close", () => { aborted++; }); return;
  }
  response.statusCode = 404; response.end();
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const executablePath = process.env.CHROME_BIN || ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(path => fs.existsSync(path));
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const report = await page.evaluate(async () => {
    const { cloudCompletion } = await import("/effects.mjs");
    const request = { provider: "openrouter", key: "synthetic-test-key", bytes: "{}", origin: location.origin };
    const local = path => (url, options) => fetch(path, options);
    const result = await cloudCompletion(request, { fetch: local("/success") });
    const refusal = async (input, options, expected) => {
      try { await cloudCompletion(input, options); throw Error("unexpected success"); }
      catch (error) { if (error.code !== expected) throw error; }
    };
    await refusal(request, { fetch: local("/stall"), timeoutMs: 100 }, "inferenceTimedOut");
    const controller = new AbortController();
    const pending = refusal({ ...request, signal: controller.signal }, { fetch: async (url, options) => {
      const response = await local("/stall")(url, options); controller.abort(); return response;
    } }, "inferenceCancelled");
    await pending;
    return { text: result.text, deadline: "refused", cancellation: "refused" };
  });
  assert.deepEqual(report, { text: "browser 🌱", deadline: "refused", cancellation: "refused" });
  await page.waitForTimeout(50);
  assert.equal(aborted, 2, "both stalled real browser requests must close");
  console.log(JSON.stringify({ ...report, abortedConnections: aborted }));
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
