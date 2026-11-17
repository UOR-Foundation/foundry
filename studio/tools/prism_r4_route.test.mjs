// FA-87: a chat turn is answered only by Foundry's own reader or the pinned in-Prism LexLean-R4
// Studio. Prism R4 (afflom/me's spec, r4/spec.json) decides each turn: a route to any other model
// is ungranted and refused before the request is made, and every answer is judged before shown.
import assert from "node:assert/strict"; import crypto from "node:crypto"; import fs from "node:fs"; import test from "node:test";

const shell = new URL("../shell/", import.meta.url), specBytes = fs.readFileSync(new URL("r4/spec.json", shell)), pinBytes = fs.readFileSync(new URL("r4/lexlean-r4.json", shell)), spec = JSON.parse(specBytes), pin = JSON.parse(pinBytes);
globalThis.fetch = async (url) => { const s = String(url); if (s === new URL("r4/spec.json", shell).href) return { ok: true, json: async () => JSON.parse(specBytes) }; if (s === new URL("r4/lexlean-r4.json", shell).href) return { ok: true, json: async () => JSON.parse(pinBytes) }; assert.fail("R4 reads only its own spec and pin, from this origin: " + s); };
const { r4Decide, r4InprismFacts, r4Refusal, r4Request, r4StudioPin, GRANT } = await import("../shell/r4.mjs");
const { chatModelRoute, INPRISM_MODEL } = await import("../shell/chat-model-route.mjs"); const { judge } = await import("../shell/prism/spec.mjs");
const host = fs.readFileSync(new URL("host.js", shell), "utf8"), chatTurn = host.slice(host.indexOf("async function chatTurn("), host.indexOf("    // T6: completed batches"));

test("the R4 spec is afflom/me's, byte for byte, and judges each of its examples as stated", () => {
  assert.equal(crypto.createHash("sha256").update(specBytes).digest("hex"), "808b936a8f33c67c0563fbd3069753e221c644ca20fcc1a81a1c37b19644b254");
  assert.equal(spec.examples.length, 18);
  for (const { request, response } of spec.examples) { const values = request.split(" "); assert.equal(judge(spec, Object.fromEntries(spec.fields.map((f, i) => [f.name, values[i]]))).outcome, response, request); }
});

test("Foundry grants no route, so every model outside it is refused before the request", async () => {
  assert.deepEqual(GRANT, []);
  for (const provider of ["featherless", "openrouter", "anything"]) {
    const request = r4Request({ provider }); assert.equal(request.mode, "routed"); assert.equal(request.route, "ungranted");
    const decision = await r4Decide(request); assert.equal(decision.outcome, "refuse"); assert.match(r4Refusal(decision, request), /own language and reasoning/);
  }
});

test("Foundry's reader answers as a compiled model: no weights, no route", async () => {
  const request = r4Request({ provider: "local" });
  assert.deepEqual(request, { mode: "compiled", engine: "match", weights: "none", route: "none", boundary: "allow" });
  assert.equal((await r4Decide(request)).outcome, "answer");
  for (const weights of ["match", "missing"]) assert.equal((await r4Decide({ ...request, weights })).rule, "REQ-003", "a compiled model carries no blob");
  const engine = await r4Decide({ ...request, engine: "missing" });
  assert.equal(engine.rule, "REQ-001");
  assert.match(r4Refusal(engine, request), /pin/);
});

test("a chat turn is read by the kernel guest's IdeaReader and judged by R4 before it is shown", () => {
  const read = chatTurn.indexOf('.ask("read "');
  const made = chatTurn.indexOf("await r4Decide(made)");
  assert.ok(chatTurn.indexOf("await r4Decide(before)") > 0 && read > chatTurn.indexOf("await r4Decide(before)"), "R4 decides the route before the idea is read");
  assert.ok(made > read && made < chatTurn.indexOf("await enqueueText((notationLines"), "R4 judges the reading before it is shown");
  for (const remote of ["paidGenerate", "sealPaid", "openrouter/", 'op: "warmup"', "inst.generate(", "rulesModel("]) assert.ok(!chatTurn.includes(remote), `a chat turn never reaches ${remote}`);
});

test("the studio offers Foundry's reader by default alongside pinned in-Prism LexLean-R4, with zero cloud providers", () => {
  assert.ok(host.includes('selectedModel: { name: LOCAL_MODEL, provider: "local" }'));
  assert.ok(host.includes("apiName: INPRISM_MODEL"));
  assert.ok(host.includes('handlers.set("get-language-model-providers", () => [LOCAL]);'));
  assert.ok(host.includes('handlers.set("get-language-models-by-providers", () => ({ local: LOCAL_MODELS }));'));
});

test("LexLean-R4 Studio answers in Prism only when its .holo archive and weights match their pins", async () => {
  const loadedPin = await r4StudioPin();
  assert.equal(loadedPin.archiveKappa, pin.archiveKappa); assert.equal(loadedPin.wasmSha256, pin.wasmSha256);
  assert.deepEqual(chatModelRoute({ provider: "local", name: INPRISM_MODEL }, { provider: "local", name: "foundry:reader" }), { provider: "local", model: INPRISM_MODEL, paid: false });
  const installed = { kappa: pin.archiveKappa, fingerprint: pin.fingerprint };
  const ok = r4Request({ provider: "local", model: INPRISM_MODEL, ...r4InprismFacts(pin, installed, "match") });
  assert.deepEqual(ok, { mode: "inprism", engine: "match", weights: "match", route: "none", boundary: "allow" });
  assert.equal((await r4Decide(ok)).outcome, "answer");
  for (const [label, facts, rule] of [["mismatch", r4InprismFacts(pin, installed, "mismatch"), "REQ-002"], ["missing", r4InprismFacts(pin, installed, null), "REQ-005"], ["engine", r4InprismFacts(pin, { kappa: "blake3:bad", fingerprint: "00" }, "match"), "REQ-001"]]) {
    const req = r4Request({ provider: "local", model: INPRISM_MODEL, ...facts }), dec = await r4Decide(req);
    assert.equal(dec.outcome, "refuse", label); assert.equal(dec.rule, rule, label); assert.ok(r4Refusal(dec, req).length > 10, label);
  }
});
