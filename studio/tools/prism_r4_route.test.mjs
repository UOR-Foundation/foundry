// FA-87: a chat turn is answered only by Foundry's own reader, compiled with Prism into the kernel
// guest. Prism R4 (afflom/me's spec, r4/spec.json) decides each turn: a route to any other model is
// ungranted and refused before the request is made, and the reading is judged as a compiled answer.
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

test("the studio offers and defaults to Foundry's reader only", () => {
  assert.ok(host.includes('selectedModel: { name: LOCAL_MODEL, provider: "local" }'));
  assert.ok(host.includes('handlers.set("get-language-model-providers", () => [LOCAL]);'));
  assert.ok(host.includes('handlers.set("get-language-models-by-providers", () => ({ local: LOCAL_MODELS }));'));
});
