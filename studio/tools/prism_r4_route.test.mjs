// FA-87: a chat turn is answered only by Foundry's own model in Prism. Prism R4 (afflom/me's spec,
// r4/spec.json) decides each turn: a route to any other model is ungranted and refused before the
// request is made, and the device model's answer is shown only when its weights were read back by
// their address and its engine's bytes have theirs.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

const shell = new URL("../shell/", import.meta.url);
const specBytes = fs.readFileSync(new URL("r4/spec.json", shell));
const spec = JSON.parse(specBytes);
globalThis.fetch = async (url) => {
  assert.equal(String(url), new URL("r4/spec.json", shell).href, "R4 reads only its own spec, from this origin");
  return { ok: true, json: async () => JSON.parse(specBytes) };
};
const { r4Decide, r4Refusal, r4Request, GRANT } = await import("../shell/r4.mjs");
const { judge } = await import("../shell/prism/spec.mjs");
const host = fs.readFileSync(new URL("host.js", shell), "utf8");
const chatTurn = host.slice(host.indexOf("async function chatTurn("), host.indexOf("    // T6: completed batches"));
const ENGINE = "did:holo:sha256:" + "a".repeat(64);

test("the R4 spec is afflom/me's, byte for byte, and judges each of its examples as stated", () => {
  assert.equal(crypto.createHash("sha256").update(specBytes).digest("hex"), "808b936a8f33c67c0563fbd3069753e221c644ca20fcc1a81a1c37b19644b254");
  assert.equal(spec.examples.length, 18);
  for (const { request, response } of spec.examples) {
    const values = request.split(" ");
    const req = Object.fromEntries(spec.fields.map((f, i) => [f.name, values[i]]));
    assert.equal(judge(spec, req).outcome, response, request);
  }
});

test("Foundry grants no route, so every model outside it is refused before the request", async () => {
  assert.deepEqual(GRANT, []);
  for (const provider of ["featherless", "openrouter", "anything"]) {
    const request = r4Request({ provider });
    assert.equal(request.mode, "routed");
    assert.equal(request.route, "ungranted");
    const decision = await r4Decide(request);
    assert.equal(decision.outcome, "refuse");
    assert.match(r4Refusal(decision, request), /own language and reasoning/);
  }
});

test("the device model answers only from weights read back by their address and an addressed engine", async () => {
  assert.equal((await r4Decide(r4Request({ provider: "local" }))).outcome, "answer", "the route alone is allowed before the model answers");
  assert.equal((await r4Decide(r4Request({ provider: "local", weightsVerified: true, engineAddress: ENGINE }))).outcome, "answer");
  const unread = await r4Decide(r4Request({ provider: "local", weightsVerified: false, engineAddress: ENGINE }));
  assert.equal(unread.outcome, "refuse");
  assert.match(r4Refusal(unread, {}), /weights/);
  const engine = await r4Decide(r4Request({ provider: "local", weightsVerified: true, engineAddress: "did:holo:sha256:(engine unavailable)" }));
  assert.equal(engine.outcome, "refuse");
  assert.equal(engine.rule, "REQ-001");
});

test("a chat turn asks R4 before any request and again before the device answer is sealed", () => {
  const pre = chatTurn.indexOf("await r4Decide(before)");
  assert.ok(pre > 0 && pre < chatTurn.indexOf("await lookup(body)"), "R4 decides the route before the request is looked up or made");
  const made = chatTurn.indexOf("await r4Decide(made)");
  assert.ok(made > chatTurn.indexOf("await inst.buildReceipt(") && made < chatTurn.indexOf("await sealAnswer(body, rec, hit.key)"), "R4 decides the device answer before it is sealed");
  assert.ok(chatTurn.includes("weightsVerified: held.weightsVerified === true"));
  for (const remote of ["paidGenerate", "sealPaid", "openrouter/", 'op: "warmup"']) assert.ok(!chatTurn.includes(remote), `a chat turn never reaches ${remote}`);
});

test("the studio offers and defaults to the device model only", () => {
  assert.ok(host.includes('selectedModel: { name: MODEL_ID, provider: "local" }'));
  assert.ok(host.includes('handlers.set("get-language-model-providers", () => [LOCAL]);'));
  assert.ok(host.includes('handlers.set("get-language-models-by-providers", () => ({ local: LOCAL_MODELS }));'));
  const inference = fs.readFileSync(new URL("inference.js", shell), "utf8");
  assert.ok(inference.includes("weightsVerified: !!loaded.imageKappa"), "the weights fact is the loader's verified image address");
});
