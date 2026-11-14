import {readUserSettings,replaceUserSettings,changeUserSettings} from "./settings-transactions.mjs";
import {deviceProviderCredential,deviceInferenceRoute} from './private-provider-credentials.mjs';
import { authorizeInference } from "./inference-consent.mjs";
import { cloudCompletion } from "./inference-effects.mjs";
// Inference on the page, shared by the landing page (shell.js) and the builder's host (host.js).
// Adapters only: the rules are in core.wasm, generated from the Lean verified model (the route table,
// the preimages, the OpenAI wire, the OpenRouter request); the engine is Hologram Q's snapshot under
// q/; addresses are BLAKE3 from the holospaces wasm; seals live in the device store. No server is
// contacted except Hugging Face, once, for the model's blocks, and OpenRouter with the visitor's own
// key on the paid route.

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

// ---- settings: the renderer's own record, one place for the key and the chosen model
export function settingsGet() { return readUserSettings(db()); }
export function settingsPut(s) { return replaceUserSettings(db(),s); }
export async function deviceKeyGet() { return deviceProviderCredential(await settingsGet(), "openrouter"); }
export async function keyGet() { return deviceKeyGet(); }
export async function featherlessKeyGet() { return deviceProviderCredential(await settingsGet(), "featherless"); }
export const providerOf = (model) => (String(model).startsWith("featherless/") ? "featherless" : "openrouter");
export const SITE_RELAY = "site-relay";
export const inferenceRoute = async model => deviceInferenceRoute(await settingsGet(),providerOf(model));
export const keyFor = async model => {const route=await inferenceRoute(model);return route.key || (route.kind==="siteFeatherless"?SITE_RELAY:"");};
export function keySet(value) { return changeUserSettings(db(),{value},(s,captured)=>({...s,providerSettings:{...(s.providerSettings||{}),openrouter:{...(s.providerSettings?.openrouter||{}),apiKey:{value:captured.value}}}})); }
// Who answers: local (the Q engine) or paid (an OpenRouter model). Read from and written to the same
// selectedModel the renderer's settings page and composer use.
export const MODEL_ID = "webgpu:Bonsai";
export const paidId = (model) => model.replace(/^(openrouter|featherless)\//, "");
export async function readWho() {
  const s = await settingsGet();
  const m = s && s.selectedModel;
  if (m && m.provider === "openrouter" && m.name) return { provider: "paid", model: paidId(m.name) };
  return { provider: "local", model: "" };
}
export function writeWho(w) { return changeUserSettings(db(),w,(s,captured)=>({...s,selectedModel:captured.provider === "paid" ? {provider:"openrouter",name:captured.model} : {provider:"local",name:MODEL_ID}})); }

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
    if (receipt.kind === "or-receipt") {
      if ((await kappa(enc.encode(JSON.stringify(receipt.value)))) !== receipt.id || (await kappa(enc.encode(answer.value))) !== answer.id) continue;
      return { hit: true, text: answer.value, receipt: m.value.receipt, rec: receipt.value, paid: true, fingerprint: `${receipt.value.model};${receipt.value.provider || ""};${receipt.value.fingerprint || ""}` };
    }
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
export async function sealPaid(body, rec, key) {
  const receipt = await sealPut("or-receipt", rec);
  const outputKappa = await sealPut("answer", rec.text);
  const memo = { iri: "https://freeinference.ai/memo/v1", model: [rec.model, body.model], engineKappa: "openrouter:" + (rec.provider || ""), promptKappa: key.promptKappa, paramsKappa: key.paramsKappa, outputKappa, receipt };
  await sealPut("memo", memo, { promptKappa: key.promptKappa });
  return receipt;
}

// ---- the engine: Hologram Q on WebGPU, resident across turns, warm KV as q-brain-fast does it.
//
// The ladder. A device that has never seen this page holds no weights, and the large model is 424 MB.
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
    const entry = L.MODELS.find((m) => m.fam === "TernaryBonsai");   // Ternary Bonsai 1.7B, the device's model
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
// The model that writes an app's rules on the device: the device's one model, Ternary Bonsai 1.7B, the same
// resident engine that answers chat, so a rules turn downloads and holds nothing more. Measured 2026-11-13 with
// DEVICE_RULES on five requests: 1 of 5 passed checkSpec, at 85 to 114 tokens a second. The checker and the
// approval card still stand between its rules and a proof.
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

// ---- the paid route: OpenRouter with the visitor's key. The request bytes are the model's encoder.
// A reasoning model (GLM 5.3 Flash) streams its reasoning in `delta.reasoning` for minutes before the
// answer starts; onReasoning receives it so the chat can show the work instead of an empty message.
const GLM_LOCK = "forge-featherless-glm";
export async function paidGenerate(body, onDelta, signal, onReasoning) {
  // One GLM request per browser: this browser's tabs and turns queue for it in order (Web Locks), rather
  // than racing each other for the configured account's provider capacity.
  if (providerOf(body.model) !== "featherless" || !(navigator.locks && navigator.locks.request)) return paidGenerateOnce(body, onDelta, signal, onReasoning);
  const run = () => paidGenerateOnce(body, onDelta, signal, onReasoning);
  const first = await navigator.locks.request(GLM_LOCK, { ifAvailable: true }, async (lock) => (lock ? { done: await run() } : null));
  if (first) return first.done;
  if (onReasoning) onReasoning("Waiting for this browser's other GLM 5.3 Flash request to finish…");
  return navigator.locks.request(GLM_LOCK, signal ? { signal } : {}, run);
}
async function paidGenerateOnce(body, onDelta, signal, onReasoning) {
  const provider = providerOf(body.model);
  const route = await inferenceRoute(body.model), key = route.key;
  if (!key && route.kind !== "siteFeatherless") throw Object.assign(new Error("The provider requires a valid API key"), {code:"inferenceUnauthorized"});
  const c = await coreReady(); const V = await viewReady();
  let bytes = c.run({ op: "encode-openrouter-request", model: paidId(body.model), request: body, stream: true }).bytes;
  // Featherless speaks plain OpenAI chat completions: the core's request without the three fields only
  // OpenRouter reads (usage.include, reasoning, provider), and the standard usage option in their place.
  if (provider === "featherless") { const j = JSON.parse(bytes); delete j.usage; delete j.reasoning; delete j.provider; if (j.stream) j.stream_options = { include_usage: true }; bytes = JSON.stringify(j); }
  const credentialOwner = route.credentialOwner;
  const permission = await authorizeInference({ provider: route.provider, model: paidId(body.model), bytes, credentialOwner, signal });
  let result;
  try { result = await cloudCompletion({ provider: route.provider, key, bytes: permission.disclosure.bytes, origin: location.origin, signal: permission.signal, onDelta, onReasoning }); }
  catch (error) {
    if (error.code === "inferenceUnauthorized") error.message = V.noKeyLabel;
    if (error.code === "inferencePaymentRequired") error.message = V.noCreditLabel;
    throw error;
  } finally { permission.close(); }
  const { last, text, finish, ttftMs } = result;
  const usage = (last && last.usage) || {};
  const rec = { kind: provider, id: last && last.id, model: (last && last.model) || paidId(body.model), provider: last && last.provider, fingerprint: (last && last.system_fingerprint) || "", usage: { prompt: usage.prompt_tokens || 0, completion: usage.completion_tokens || 0 }, cost: String(usage.cost ?? ""), text: text.trim(), rederivable: false, ttftMs, finish };
  return { text: rec.text, rec };
}

// ---- the route: the model's table decides who answers
export async function routeOf(hit, body) {
  const c = await coreReady();
  return c.run({ op: "route", hit: !!hit.hit, provider: /^(openrouter|featherless)\//.test(body.model) ? "paid" : "local", gpuReady: !!navigator.gpu, keyPresent: !!(await keyFor(body.model)), online: navigator.onLine }).route;
}
export async function refusalWord(route) { const V = await viewReady(); return { NoKey: V.noKeyLabel, NoGpu: V.noGpuLabel, PaidOffline: V.paidOfflineLabel }[route]; }
export async function modelFor(who) { const V = await viewReady(); return who.provider === "paid" ? "openrouter/" + (who.model || V.paidModels[0].id) : MODEL_ID; }

// ---- the endpoint: one function answers an OpenAI request, memo first, then the engine. Every byte
// it returns is encoded by the verified core. Two transports carry it and compute nothing: the
// service worker on this origin, and the one file relay for native harnesses.
const wire = (op, extra) => core.run({ op, ...extra }).bytes;
function completionOf(id, text, fingerprint, receipt, model = MODEL_ID) { return { id, created: String(Math.floor(Date.now() / 1000)), model, text, fingerprint, receipt }; }
async function requestOf(raw) {
  const V = await viewReady();
  const messages = raw.messages.map((m) => ({ role: m.role || "user", content: Array.isArray(m.content) ? m.content.map((p) => (p && p.text) || "").join("\n") : String(m.content ?? "") }));
  const maxTokens = raw.max_completion_tokens ?? raw.max_tokens;
  const who = await readWho();
  const model = typeof raw.model === "string" && raw.model.startsWith("openrouter/") ? raw.model
    : raw.model === LADDER_ID ? LADDER_ID
    : who.provider === "paid" ? "openrouter/" + (who.model || V.paidModels[0].id) : MODEL_ID;
  return { model, messages, max_tokens: Number.isInteger(maxTokens) && maxTokens > 0 ? Math.min(maxTokens, 2048) : 512, temperature: raw.temperature == null ? "" : String(raw.temperature), seed: raw.seed };
}
export async function serve(raw, sink) {
  await coreReady(); const V = await viewReady();
  if (!raw || !Array.isArray(raw.messages) || !raw.messages.length) {
    return { status: 400, bytes: wire("encode-error", { message: "messages must not be empty", type: "invalid_request_error" }), headers: {} };
  }
  const body = await requestOf(raw);
  const hit = await lookup(body);
  const rt = await routeOf(hit, body);
  const word = await refusalWord(rt);
  if (word) return { status: rt === "NoKey" ? 401 : 503, bytes: wire("encode-error", { message: word, type: rt === "NoKey" ? "authentication_error" : "server_error" }), headers: {} };
  if (rt === "Serve") {
    // A replay names the model whose answer it replays, not the rung this request asked for.
    const c = completionOf("chatcmpl-" + hit.receipt.replace("blake3:", "").slice(0, 12), hit.text, hit.fingerprint, hit.receipt, hit.modelId || body.model);
    const headers = { "x-hologram-receipt": hit.receipt, "x-hologram-reuse": "1", "x-hologram-stream": sink ? "memo" : "plain", "x-hologram-provider": hit.paid ? "openrouter" : "local" };
    if (!sink) return { status: 200, bytes: wire("encode-completion", { completion: c }), headers };
    sink.head(headers);
    sink.frame(wire("encode-role", { completion: c })); sink.frame(wire("encode-delta", { completion: c, delta: hit.text }));
    sink.frame(wire("encode-final", { completion: c })); sink.frame(wire("done"));
    return { status: 200, headers };
  }
  if (rt === "Paid") {
    const c = completionOf("chatcmpl-" + Math.random().toString(16).slice(2, 14), "", "", "", body.model);
    let sent = "";
    if (sink) { sink.head({ "x-hologram-stream": "native", "x-hologram-provider": "openrouter" }); sink.frame(wire("encode-role", { completion: c })); }
    const { text, rec } = await paidGenerate(body, (t) => { if (sink && t.startsWith(sent) && t.length > sent.length) { sink.frame(wire("encode-delta", { completion: c, delta: t.slice(sent.length) })); sent = t; } });
    const receipt = await sealPaid(body, rec, hit.key);
    const done = { ...c, text, fingerprint: `${rec.model};${rec.provider || ""};${rec.fingerprint || ""}`, receipt, model: body.model };
    const headers = { "x-hologram-receipt": receipt, "x-hologram-stream": sink ? "native" : "plain", "x-hologram-provider": "openrouter", "x-hologram-cost": rec.cost };
    if (!sink) return { status: 200, bytes: wire("encode-completion", { completion: done }), headers };
    if (text.length > sent.length && text.startsWith(sent)) sink.frame(wire("encode-delta", { completion: done, delta: text.slice(sent.length) }));
    sink.frame(wire("encode-final", { completion: done })); sink.frame(wire("done"));
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
export async function modelsBytes() { await coreReady(); const V = await viewReady(); return wire("encode-models", { ids: [LADDER_ID, MODEL_ID].concat(V.paidModels.map((m) => "openrouter/" + m.id)) }); }

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

// Transport 2: the relay. When freeinference-relay.py runs on this machine, this tab serves its jobs.
export const RELAY_PORT = Number(new URLSearchParams(location.search).get("relay")) || 11435;
export const RELAY = `http://127.0.0.1:${RELAY_PORT}`;
const TAB_ID = (() => { try { const k = "holo.tab.v1"; let id = sessionStorage.getItem(k); if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random())).replace(/-/g, "").slice(0, 12); sessionStorage.setItem(k, id); } return id; } catch (e) { return String(Math.random()).slice(2, 14); } })();
const CONNECT = "holo.connect.v1";
export const readConnect = () => { try { return JSON.parse(localStorage.getItem(CONNECT) || "null") || {}; } catch (e) { return {}; } };
export const writeConnect = (c) => { try { localStorage.setItem(CONNECT, JSON.stringify(c)); } catch (e) {} };
export const relay = { token: "", running: false, timer: null, state: "off", seen: false, other: "", onState: () => {}, sheetOpen: () => false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tabHeaders = () => ({ "X-Freeinference-Tab": relay.token || "hello", "X-Freeinference-Tab-Id": TAB_ID });
function setRelayState(state, other) {
  if (state === "connected") relay.seen = true;
  if (state === relay.state && (other || "") === relay.other) return;
  relay.state = state; relay.other = other || ""; relay.onState();
}
async function relayLoop() {
  if (relay.running) return; relay.running = true;
  try {
    for (;;) {
      let job = null;
      try {
        const r = await fetch(RELAY + "/tab/next", { cache: "no-store", headers: tabHeaders() });
        if (r.status === 200) job = await r.json();
        else if (r.status === 409) { setRelayState("second", ((await r.json()).serving || "")); await sleep(5000); continue; }
        else if (r.status === 403) { relay.token = ""; scheduleWatch(2000); return; }
        else if (r.status !== 204) { await sleep(2000); continue; }
        setRelayState("connected");
      } catch (e) { setRelayState("listening"); scheduleWatch(); return; }
      if (!job) continue;
      const post = (action, payload) => fetch(`${RELAY}/tab/${job.id}/${action}`, { method: "POST", headers: { "content-type": "application/json", ...tabHeaders() }, body: JSON.stringify(payload) }).catch(() => {});
      try {
        await coreReady();
        if (job.op === "models") { await post("result", { bytes: await modelsBytes(), headers: {} }); continue; }
        const raw = job.request || {};
        if (!raw.stream) { const out = await serve(raw, null); await post(out.status === 200 ? "result" : "fail", out.status === 200 ? { bytes: out.bytes, headers: out.headers } : { message: JSON.parse(out.bytes).error.message }); continue; }
        let chain = Promise.resolve();
        const sink = { head: (headers) => { chain = chain.then(() => post("head", { headers })); }, frame: (bytes) => { chain = chain.then(() => post("frame", { bytes })); } };
        const out = await serve(raw, sink); await chain;
        if (out.bytes) await post("fail", { message: JSON.parse(out.bytes).error.message });
      } catch (err) { await post("fail", { message: err.message }); }
    }
  } finally { relay.running = false; }
}
export function scheduleWatch(ms) { clearTimeout(relay.timer); relay.timer = setTimeout(relayWatch, ms ?? (relay.sheetOpen() ? 2000 : 10000)); }
export async function relayWatch() {
  if (!readConnect().enabled) return;
  try {
    const r = await fetch(RELAY + "/tab/hello", { cache: "no-store", headers: tabHeaders() });
    if (r.ok) { const h = await r.json(); relay.token = h.token || ""; setRelayState("connected"); relayLoop(); return; }
  } catch (e) {}
  setRelayState("listening"); scheduleWatch();
}
export { setRelayState };
