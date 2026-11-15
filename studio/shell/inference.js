import {readUserSettings,replaceUserSettings,changeUserSettings} from "./settings-transactions.mjs";
// Inference on the page, shared by the landing page (shell.js) and the builder's host (host.js).
// Adapters only: the rules are in core.wasm, generated from the Lean verified model (the route table,
// the preimages, the OpenAI wire, the OpenRouter request); the engine is Hologram Q's snapshot under
// q/; addresses are BLAKE3 from the holospaces wasm; seals live in the device store. No server is
// contacted except Hugging Face, once, for the model's blocks. There is no cloud route and no key:
// Prism R4 grants only the model in Prism on this device.

const BASE = new URL("./", import.meta.url);
const enc = new TextEncoder();
export const short = (k) => (k ? String(k).replace(/^blake3:/, "").replace("did:holo:sha256:", "").slice(0, 12) + "…" : "");

// ---- the verified core, through its JSON ABI
let core = null, coreLoading = null;
export function coreReady() {
  if (core) return Promise.resolve(core);
  if (coreLoading) return coreLoading;
  coreLoading = (async () => {
    const { instance } = await WebAssembly.instantiateStreaming(fetch(new URL("core.wasm", BASE)), {});
    const { memory, holo_alloc, holo_free, holo_run } = instance.exports;
    core = {
      run(request) {
        const bytes = enc.encode(JSON.stringify(request));
        const ptr = holo_alloc(bytes.length);
        new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
        const packed = holo_run(ptr, bytes.length);
        const outPtr = Number(packed >> 32n), outLen = Number(packed & 0xffffffffn);
        const text = new TextDecoder().decode(new Uint8Array(memory.buffer, outPtr, outLen));
        holo_free(outPtr, outLen); holo_free(ptr, bytes.length);
        const out = JSON.parse(text);
        if (out.error) throw new Error(out.error);
        return out;
      },
    };
    return core;
  })();
  return coreLoading;
}
export let VIEW = null;
export async function viewReady() { if (VIEW) return VIEW; const inline = document.getElementById("view"); VIEW = inline ? JSON.parse(inline.textContent) : (await coreReady()).run({ op: "view" }); return VIEW; }

// ---- BLAKE3 addresses from the holospaces wasm (the same κ every daemon computes)
let kappaFn = null;
export async function kappaReady() {
  if (kappaFn) return kappaFn;
  const mod = await import(new URL("q/pkg/holospaces_web.js", BASE).href);
  if (typeof mod.default === "function") { try { await mod.default(); } catch (e) {} }
  kappaFn = (bytes) => String(mod.kappa(bytes));
  return kappaFn;
}
export async function kappa(bytes) { return (await kappaReady())(bytes); }

// ---- the device store: one database for the builder and the seals. Seals are rows keyed by κ,
// indexed by kind and by memo prompt κ; the builder's own stores sit beside them.
export const DB = "hologram-forge", DB_VERSION = 2;
export const STORES = ["settings", "apps", "chats", "files", "objects", "refs", "versions", "audit"];
let dbHandle = null;
export function db() {
  if (dbHandle) return Promise.resolve(dbHandle);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
      if (!d.objectStoreNames.contains("seals")) { const s = d.createObjectStore("seals", { keyPath: "id" }); s.createIndex("kind", "kind"); s.createIndex("promptKappa", "promptKappa"); }
    };
    req.onsuccess = () => resolve((dbHandle = req.result)); req.onerror = () => reject(req.error);
  });
}
export async function sealPut(kind, value, extra = {}) {
  const bytes = enc.encode(typeof value === "string" ? value : JSON.stringify(value));
  const id = await kappa(bytes);
  const d = await db();
  await new Promise((res, rej) => { const t = d.transaction("seals", "readwrite"); t.objectStore("seals").put({ id, kind, value, created: Date.now(), ...extra }); t.oncomplete = res; t.onerror = () => rej(t.error); });
  return id;
}
export async function sealGet(id) {
  const d = await db();
  return new Promise((res, rej) => { const r = d.transaction("seals").objectStore("seals").get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function byPrompt(promptKappa) {
  const d = await db();
  return new Promise((res, rej) => { const r = d.transaction("seals").objectStore("seals").index("promptKappa").getAll(promptKappa); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
}

// ---- settings: the renderer's own record
export function settingsGet() { return readUserSettings(db()); }
export function settingsPut(s) { return replaceUserSettings(db(),s); }
// Who answers: the device model, always.
export const MODEL_ID = "webgpu:Qwen";
export async function readWho() { return { provider: "local", model: "" }; }

// ---- memo: the core owns the preimages and the route, the wasm owns the address, the store owns the rest
export async function keyOf(body) {
  const c = await coreReady();
  const pre = c.run({ op: "preimages", request: body });
  return { promptKappa: await kappa(enc.encode(pre.prompt)), paramsKappa: await kappa(enc.encode(pre.params)) };
}
export async function lookup(body) {
  const key = await keyOf(body);
  const memos = (await byPrompt(key.promptKappa)).filter((o) => o.kind === "memo" && o.value.paramsKappa === key.paramsKappa && o.value.model.includes(body.model)).sort((a, b) => b.created - a.created);
  for (const m of memos) {
    const receipt = await sealGet(m.value.receipt); const answer = await sealGet(m.value.outputKappa);
    if (!receipt || !answer) continue;
    if (receipt.kind !== "q-receipt") continue;
    const { verifyIntegrity } = await import(new URL("q/core/kappa.js", BASE).href);
    if (!(await verifyIntegrity(receipt.value)).ok) continue;
    return { hit: true, text: answer.value, receipt: m.value.receipt, rec: receipt.value, modelId: m.value.modelId || null, fingerprint: `${receipt.value.body["prov:used"]["holo:model"]};${receipt.value.body["prov:used"]["holo:engine"]}` };
  }
  return { hit: false, key };
}
export async function seal(body, rec, key, modelId) {
  const receipt = await sealPut("q-receipt", { id: rec.id, body: rec.body, text: rec.text, promptText: rec.promptText, ctxIds: rec.ctxIds, turnIds: rec.turnIds, outIds: rec.outIds, params: rec.params });
  const outputKappa = await sealPut("answer", rec.text);
  const used = rec.body["prov:used"] || {};
  const memo = { iri: "https://freeinference.ai/memo/v1", model: [used["holo:model"], body.model], modelId: modelId || body.model, engineKappa: used["holo:engine"] || "", promptKappa: key.promptKappa, paramsKappa: key.paramsKappa, outputKappa, receipt };
  await sealPut("memo", memo, { promptKappa: key.promptKappa });
  return receipt;
}
// ---- the engine: Hologram Q on WebGPU, resident across turns, warm KV as q-brain-fast does it.
//
// The ladder. A device that has never seen this page holds no weights, and the large model is 0.97 GB.
// So the small one loads first and answers, the large one loads behind it, and the swap happens only
// when the model's own `promote` rule says so: resident, and measured fast enough to be worth it. The
// rule is verified (Object.promote, four theorems); nothing here decides it. A request that names the
// large model directly is never laddered, so the homepage keeps answering with what it says it runs.
export const LADDER_ID = "webgpu:Hologram";
export const SEED_ID = "webgpu:SmolLM2";
export const idOf = (held) => (held && held.model && held.model.fam === "SmolLM2" ? SEED_ID : MODEL_ID);
const PROMOTE_TOKPS = 8;   // the floor the large model must beat; the rule takes the answer, not the number
// The seed's address. Its bytes are interchangeable wherever they are served (the file is content
// addressed and every block is verified before it binds), so a mirror on this origin is the same model.
const SEED = {
  fam: "SmolLM2", name: "SmolLM2-360M-Instruct · seed",
  kappaUrl: "https://huggingface.co/HOLOGRAMTECH/q-smollm2-360m/resolve/main",
  holoUrl: "https://huggingface.co/HOLOGRAMTECH/q-smollm2-360m/resolve/main/q-smollm2-360m.v1.holo",
  manifestKappa: "did:holo:sha256:07aff22ceecacedb78c1e408be015cd08516ad819b32c9da50f84fb6c13a9c23",
  size: "0.21 GB", fmt: "q4 κ", cap: 400, ctx: 3000, kv4: true, gpu: true, gpuOnly: true, chat: true,
  qwen: true, eosText: "<|im_end|>", rep: 1.05, kappa: true,
};
// On a developer machine the same bytes are served from this origin, so the ladder can be exercised
// before the file is published. Anywhere else the address above is the only one.
const LOCAL_SEED = typeof location !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? new URL("/seed/q-smollm2-360m.v1.holo", location.origin).href : null;
const seedEntry = () => (LOCAL_SEED ? { ...SEED, holoUrl: LOCAL_SEED } : SEED);
export const engine = { instance: null, model: null, mods: null, session: null, loading: null, onState: () => {}, onReady: () => {},
                        tier: "Small", seed: null, large: null, largeLoading: null, promoted: false };
const sigOf = (list) => (list || []).map((m) => (m.role || "") + (m.content || "")).join("");
const tailFor = (M, u) => M.llama3 ? `<|eot_id|><|start_header_id|>user<|end_header_id|>

${u || ""}<|eot_id|><|start_header_id|>assistant<|end_header_id|>

` : null;
async function mods() {
  if (engine.mods) return engine.mods;
  const q = (p) => new URL("q/core/" + p, BASE).href;
  const [L, E, F] = await Promise.all([import(q("loader.js")), import(q("engine.js")), import(q("q-brain-fast.mjs"))]);
  await L.ready();
  return (engine.mods = { L, E, F });
}
// One model, resident. `word` is what the visitor is told while its bytes arrive.
async function residentModel(entry, word) {
  const { L, E } = await mods();
  const loaded = await L.loadModel(entry, {
    onStatus: () => engine.onState(word),
    onProgress: (d, t) => engine.onState(t ? `${word} · ${Math.round((d / t) * 100)}%` : word),
  });
  if (!loaded || !loaded.gpu) throw new Error("model load failed");
  // weightsVerified is Prism R4's weights fact: the loader read the weights back by their image
  // address, every block re-derived, rather than naming them by declared identity.
  return { instance: await E.createEngine(entry, loaded), model: entry, weightsVerified: !!loaded.imageKappa };
}
// The large model, loaded behind whatever is answering, then measured once and offered to the rule.
function loadLarge(word) {
  if (engine.large || engine.largeLoading) return engine.largeLoading || Promise.resolve(engine.large);
  engine.largeLoading = (async () => {
    const { L } = await mods();
    const V = await viewReady();
    const entry = L.MODELS.find((m) => m.fam === "Qwen2.5");   // Qwen2.5-1.5B-Instruct, the device's model
    // Behind the seed it is the larger model arriving; without a seed it is the only model there is.
    const held = await residentModel(entry, word || V.largerLoadingLabel);
    engine.large = held;
    engine.onState("");
    const tokps = await measure(held);
    const core = await coreReady();
    const next = core.run({ op: "promote", current: engine.tier.toLowerCase(), largeResident: true, largeFast: tokps >= PROMOTE_TOKPS }).tier;
    if (next === "Large" && engine.tier !== "Large") {
      engine.tier = "Large"; engine.promoted = true; engine.session = null;
      engine.instance = held.instance; engine.model = held.model;
      engine.onState(V.promotedLabel); setTimeout(() => engine.onState(""), 4000);
    }
    return held;
  })().catch((error) => { engine.largeLoading = null; throw error; });
  return engine.largeLoading;
}
// Tokens per second on a short turn, so the rule is offered a measurement and not a guess. Twice: the
// first turn after a model becomes resident pays for warm up, and that rate is not the one a visitor
// will see. The second is what the rule is told.
async function measure(held) {
  try {
    const { F } = await mods();
    let ids = held.instance.tokenize(F.frameHistory(held.model, [{ role: "user", content: "Say ready." }]));
    if (held.model.bos && held.instance.bosId != null) ids = [held.instance.bosId, ...ids];
    let tokps = 0;
    for (let turn = 0; turn < 2; turn++) {
      let stats = null;
      await withEngine(() => held.instance.generate(ids, { maxNew: 12, onToken: ({ stats: s }) => { if (s) stats = s; } }));
      tokps = stats ? stats.tokps : 0;
    }
    return tokps;
  } catch { return 0; }
}
// The model that writes an app's rules on the device: the device's one model, Qwen2.5-1.5B-Instruct, the same
// resident engine that answers chat, so a rules turn downloads and holds nothing more. Its rules turn is held to
// the spec grammar (host.js, spec-grammar.mjs). Measured 2026-11-14 with DEVICE_RULES on ten requests: 8 of 10
// passed checkSpec, at 15 to 60 s a spec (Ternary Bonsai 1.7B: 1 of 10; 1-bit Bonsai 8B: 7 of 10 at 34 to 75 s).
// The checker and the approval card still stand between its rules and a proof.
export async function rulesModel() {
  if (!engine.rules) engine.rules = await heldFor(MODEL_ID);
  return engine.rules;
}
// The engine a request is answered by. The ladder's id takes the tier; the large model's own id always
// takes the large model, so a page that names it is never answered by something else.
export async function heldFor(id) {
  if (id === MODEL_ID) return await loadLarge();
  await gpuReady(id);
  return engine.tier === "Large" && engine.large ? engine.large : engine.seed || { instance: engine.instance, model: engine.model };
}
export function gpuReady(id) {
  if (id === MODEL_ID) return loadLarge().then((held) => held.instance);
  if (engine.instance) { loadLarge().catch(() => {}); return Promise.resolve(engine.instance); }
  if (engine.loading) return engine.loading;
  engine.loading = (async () => {
    const V = await viewReady();
    engine.onState(V.loadingLabel);
    try {
      engine.seed = await residentModel(seedEntry(), V.loadingLabel);
      engine.tier = "Small";
      engine.instance = engine.seed.instance; engine.model = engine.seed.model;
    } catch (error) {
      // No seed (it is not published yet, or this device refused it): the large model is the only rung.
      engine.tier = "Large";
      const held = await loadLarge(V.loadingLabel);
      engine.instance = held.instance; engine.model = held.model;
    }
    engine.onState("");
    engine.onReady();
    if (engine.tier === "Small") loadLarge().catch(() => {});
    return engine.instance;
  })().catch((err) => { engine.loading = null; throw err; });
  return engine.loading;
}
export function gpuIds(inst, messages, entry = engine.model) {
  const last = messages[messages.length - 1];
  if (engine.session && engine.session.fam === entry.fam && messages.length >= 2 && last && last.role === "user") {
    const tail = tailFor(entry, last.content);
    if (tail != null && sigOf(messages.slice(0, -1)) === engine.session.sig) return { ids: engine.session.ids.concat(inst.tokenize(tail)), warm: true };
  }
  let ids = inst.tokenize(engine.mods.F.frameHistory(entry, messages));
  if (entry.bos && inst.bosId != null) ids = [inst.bosId, ...ids];
  return { ids, warm: false };
}
export function rememberSession(messages, res, text, entry = engine.model) { if (res.ids && text && !res.error) engine.session = { ids: res.ids.slice(), fam: entry.fam, sig: sigOf(messages.concat([{ role: "assistant", content: text }])) }; }
let gpuBusy = Promise.resolve();
export function withEngine(fn) { const run = gpuBusy.then(fn, fn); gpuBusy = run.catch(() => {}); return run; }

// ---- the route: the model's table decides who answers
// Whether this browser can run the model: WebGPU present AND an adapter granted. A browser can expose
// navigator.gpu with no adapter behind it (headless, a blocklisted GPU). The engine's loader answers it,
// once per page, so a device without one is told so instead of failing to load the model.
let adapterOnce = null;
export function gpuAvailable() {
  adapterOnce ??= mods().then(({ L }) => (L.adapterReady ? L.adapterReady() : !!navigator.gpu)).catch(() => false);
  return adapterOnce;
}
export async function routeOf(hit, body) {
  const c = await coreReady();
  return c.run({ op: "route", hit: !!hit.hit, provider: "local", gpuReady: await gpuAvailable(), keyPresent: false, online: navigator.onLine }).route;
}
export async function refusalWord(route) { const V = await viewReady(); return { NoGpu: V.noGpuLabel }[route]; }

// ---- the endpoint: one function answers an OpenAI request, memo first, then the engine. Every byte
// it returns is encoded by the verified core. Two transports carry it and compute nothing: the
// service worker on this origin.
const wire = (op, extra) => core.run({ op, ...extra }).bytes;
function completionOf(id, text, fingerprint, receipt, model = MODEL_ID) { return { id, created: String(Math.floor(Date.now() / 1000)), model, text, fingerprint, receipt }; }
async function requestOf(raw) {
  const messages = raw.messages.map((m) => ({ role: m.role || "user", content: Array.isArray(m.content) ? m.content.map((p) => (p && p.text) || "").join("\n") : String(m.content ?? "") }));
  const maxTokens = raw.max_completion_tokens ?? raw.max_tokens;
  const model = raw.model === LADDER_ID ? LADDER_ID : MODEL_ID;
  return { model, messages, max_tokens: Number.isInteger(maxTokens) && maxTokens > 0 ? Math.min(maxTokens, 2048) : 512, temperature: raw.temperature == null ? "" : String(raw.temperature), seed: raw.seed };
}
export async function serve(raw, sink) {
  await coreReady();
  if (!raw || !Array.isArray(raw.messages) || !raw.messages.length) {
    return { status: 400, bytes: wire("encode-error", { message: "messages must not be empty", type: "invalid_request_error" }), headers: {} };
  }
  const body = await requestOf(raw);
  const hit = await lookup(body);
  const rt = await routeOf(hit, body);
  const word = await refusalWord(rt);
  if (word) return { status: 503, bytes: wire("encode-error", { message: word, type: "server_error" }), headers: {} };
  if (rt !== "Serve" && rt !== "Local") return { status: 503, bytes: wire("encode-error", { message: "This route is not granted", type: "server_error" }), headers: {} };
  if (rt === "Serve") {
    // A replay names the model whose answer it replays, not the rung this request asked for.
    const c = completionOf("chatcmpl-" + hit.receipt.replace("blake3:", "").slice(0, 12), hit.text, hit.fingerprint, hit.receipt, hit.modelId || body.model);
    const headers = { "x-hologram-receipt": hit.receipt, "x-hologram-reuse": "1", "x-hologram-stream": sink ? "memo" : "plain", "x-hologram-provider": "local" };
    if (!sink) return { status: 200, bytes: wire("encode-completion", { completion: c }), headers };
    sink.head(headers);
    sink.frame(wire("encode-role", { completion: c })); sink.frame(wire("encode-delta", { completion: c, delta: hit.text }));
    sink.frame(wire("encode-final", { completion: c })); sink.frame(wire("done"));
    return { status: 200, headers };
  }
  const held = await heldFor(body.model);
  const inst = held.instance;
  const messages = body.messages;
  // The answer names the model that produced it, never the rung the request asked for.
  const c = completionOf("chatcmpl-" + Math.random().toString(16).slice(2, 14), "", "", "", idOf(held));
  if (sink) { sink.head({ "x-hologram-stream": "native" }); sink.frame(wire("encode-role", { completion: c })); }
  let sent = "";
  const { ids, warm } = gpuIds(inst, messages, held.model);
  const res = await withEngine(() => inst.generate(ids, { maxNew: body.max_tokens, onToken: ({ text }) => {
    if (sink && text.startsWith(sent) && text.length > sent.length) { sink.frame(wire("encode-delta", { completion: c, delta: text.slice(sent.length) })); sent = text; }
  } }));
  const text = (res.text || "").trim();
  rememberSession(messages, res, text, held.model);
  const promptText = (messages.filter((m) => m.role === "user").slice(-1)[0] || {}).content || "";
  const rec = await inst.buildReceipt({ promptText, ctxIds: [], turnIds: ids, outIds: res.outIds });
  const receipt = await seal(body, rec, hit.key, idOf(held));
  const used = rec.body["prov:used"] || {};
  const done = { ...c, text, fingerprint: `${used["holo:model"]};${used["holo:engine"]}`, receipt };
  const headers = { "x-hologram-receipt": receipt, "x-hologram-stream": sink ? "native" : "plain", "x-hologram-warm": warm ? "1" : "0" };
  if (!sink) return { status: 200, bytes: wire("encode-completion", { completion: done }), headers };
  if (text.length > sent.length && text.startsWith(sent)) sink.frame(wire("encode-delta", { completion: done, delta: text.slice(sent.length) }));
  sink.frame(wire("encode-final", { completion: done })); sink.frame(wire("done"));
  return { status: 200, headers };
}
export async function modelsBytes() { await coreReady(); return wire("encode-models", { ids: [LADDER_ID, MODEL_ID] }); }

// Transport 1: the service worker hands each /v1 request on this origin to this page over a
// MessageChannel: {head:{status,headers}} once, then {frame} per wire frame, then {done}.
if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", async (event) => {
  const { endpoint, body } = event.data || {}; const port = event.ports && event.ports[0];
  if (!port || !endpoint) return;
  const json = (status, bytes, headers = {}) => { port.postMessage({ head: { status, headers: { "content-type": "application/json", ...headers } } }); port.postMessage({ frame: bytes, done: true }); };
  try {
    await coreReady();
    if (endpoint === "v1/models") return json(200, await modelsBytes());
    let raw; try { raw = JSON.parse(body || ""); } catch (e) { return json(400, wire("encode-error", { message: "request is not JSON", type: "invalid_request_error" })); }
    if (!raw.stream) { const out = await serve(raw, null); return json(out.status, out.bytes, out.headers); }
    let headed = false;
    const sink = {
      head: (headers) => { if (!headed) { headed = true; port.postMessage({ head: { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache", ...headers } } }); } },
      frame: (bytes) => port.postMessage({ frame: "data: " + bytes + "\n\n" }),
    };
    const out = await serve(raw, sink);
    if (!headed) return json(out.status, out.bytes, out.headers);
    port.postMessage({ done: true });
  } catch (err) { try { json(500, wire("encode-error", { message: err.message, type: "server_error" })); } catch (e) {} }
});
