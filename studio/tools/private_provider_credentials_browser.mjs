// Durable guest-admitted delivery through actual host, bridge and IndexedDB.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { chromium } from "../vendor/dyad/node_modules/playwright-core/index.mjs";
assert.equal(JSON.parse(fs.readFileSync(new URL("../vendor/dyad/node_modules/monaco-editor/package.json", import.meta.url), "utf8")).version, "0.52.2");
const root = fileURLToPath(new URL("../shell/", import.meta.url));
for (const name of ["core.wasm", "assets/index.js", "manifest.json", "sw.js", "provenance.json"]) assert.ok(fs.existsSync(path.join(root, name)), `Build and project the actual shell first: ${name}`);
const types = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".html": "text/html" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost"), relative = decodeURIComponent(url.pathname).replace(/^\/foundry\//, "");
  let file = path.resolve(root, relative);
  if ((file !== path.resolve(root) && !file.startsWith(root)) || relative.split("/").includes("..")) { res.writeHead(404); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file) && !path.extname(file) && !relative.startsWith("p/")) file = path.join(root, "index.html");
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.setHeader("content-type", types[path.extname(file)] || "application/octet-stream"); res.setHeader("cache-control", "no-store"); res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/foundry/`, origin = new URL(base).origin;
const executablePath = process.env.CHROME_BIN || ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(p => fs.existsSync(p));
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ serviceWorkers: "block" }), page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  let publicCredentialReads=0,cloudRequests=0;
  await context.route("**/*", route => {const url=new URL(route.request().url());if(url.pathname.endsWith('/warmup.json')){publicCredentialReads++;return route.fulfill({status:200,contentType:'application/json',body:'{"key":"public-fixture","featherless":"public-fixture"}'});}if(url.origin!==origin){if(['https://openrouter.ai','https://api.featherless.ai'].includes(url.origin))cloudRequests++;return route.abort();}return route.continue();});
  await page.goto(base); await page.waitForFunction(() => !!window.__host && !!window.__prism && !!window.electron);
  const report=await page.evaluate(async()=>{
    const inference=await import(new URL('inference.js',location.href)),check=(value,message)=>{if(!value)throw Error(message);};
    await inference.settingsPut({});check(await inference.keyGet()===''&&await inference.featherlessKeyGet()==='','public credentials substituted for missing device keys');
    let code;try{await inference.paidGenerate({model:'openrouter/model',messages:[{role:'user',content:'fixture'}]});}catch(error){code=error.code;}check(code==='inferenceUnauthorized','missing credential opened inference');
    await inference.settingsPut({providerSettings:{openrouter:{apiKey:{value:'visitor-openrouter-fixture'}},featherless:{apiKey:{value:'visitor-featherless-fixture'}}}});
    check(await inference.keyGet()==='visitor-openrouter-fixture'&&await inference.featherlessKeyGet()==='visitor-featherless-fixture','device credential mapping failed');
    const environment=await window.electron.ipcRenderer.invoke('get-env-vars');check(environment.OPENROUTER_API_KEY===undefined&&environment.HOLOGRAM_DEVICE==='on this device','a remote provider is advertised to the renderer');check(!JSON.stringify(environment).includes('visitor-openrouter-fixture'),'environment exposed key');
    await inference.settingsPut({providerSettings:{openrouter:{apiKey:{value:{unexpected:'private'}}}}});code=null;try{await inference.keyGet();}catch(error){code=error.code;check(!error.message.includes('private'),'private malformed value escaped');}check(code==='invalidStoredProviderCredential','malformed credential coerced');
    await inference.settingsPut({});check(await inference.keyGet()==='','credential removal retained fallback');return {noPublicFallback:true,missingKeyRefused:true,deviceProviders:true,presenceOnly:true,malformedRefused:true,removalRespected:true};
  });
  assert.equal(publicCredentialReads,0);assert.equal(cloudRequests,0);assert.equal(await page.getByRole('dialog',{name:'Review cloud request'}).count(),0);assert.deepEqual(errors,[]);console.log(JSON.stringify({...report,publicCredentialReads,cloudRequests,pageExceptions:0}));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
