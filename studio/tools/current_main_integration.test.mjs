import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { test } from "node:test";
import * as prism from "../shell/prism.js";
import * as live from "../shell/live/project.mjs";
import * as lexlean from "../shell/live/lexlean.mjs";
import { applyOps, createEditor } from "../shell/live/edit.mjs";
import { assertGenerationActive } from "../shell/generation-patch.mjs";
const host = fs.readFileSync(new URL("../shell/host.js", import.meta.url), "utf8");
const initial = JSON.parse(fs.readFileSync(new URL("./fixtures/live/rsvp.json", import.meta.url)));
const key = spec => { const checked = prism.checkSpec(spec).spec; return live.kappaOfValue({ name: checked.name, logic: live.logicOf(checked) }); };
function fn(name, end, env) {
  const start = host.indexOf(`async function ${name}(`);
  assert.ok(start >= 0 && host.indexOf(end, start) > start);
  return vm.runInNewContext(host.slice(start, host.indexOf(end, start)) + `\n${name}`, env);
}
async function revise(spec, before) {
  let saved, batch;
  const source = { files: [["prism/spec.json", JSON.stringify(initial)], ["src/pages/Index.tsx", "import '@/lib/prism'"]] };
  const run = fn("rulesAfterTurn", "// Lean proves", {
    assertGenerationActive, coreReady: Promise.resolve(), core: {}, dbReady: Promise.resolve({}),
    captureProjectSource: async () => source, prism, live, lexlean, rulesSnapshotOf: async () => ({ state: before, expected: before }),
    enc: new TextEncoder(), kappa: async bytes => live.kappaOfValue([...bytes]),
    nextPhase: async (phase, event) => event === "reword" ? phase : event === "check" ? "checked" : "drafting",
    applyStoredProjectPatch: async (_, id, patch, options) => { batch = { patch, options }; saved = options.rulesUpdate?.state; return { changed: patch.writes.length, source: { ...source, reference: "new" } }; },
    saveRules: async () => { assert.fail("status must commit with source"); }, now: () => "now",
  });
  const result = await run(1, `<prism-spec>${JSON.stringify(spec)}</prism-spec>`);
  return { saved, batch, result, source };
}
const proved = () => ({ phase: "proved", spec: prism.checkSpec(initial).spec, specKappa: "prior", logicKappa: key(initial), proof: { id: "proof" } });
test("checked wording changes retain a matching proof but not a current publication claim", async () => {
  const before = { ...proved(), phase: "published", publishedAs: "https://old.example", publicationCurrent: true };
  const spec = { ...initial, title: "New wording" };
  const { saved, batch, source, result } = await revise(spec, before);
  assert.equal(saved.phase, "published"); assert.equal(saved.proof, before.proof);
  assert.equal(saved.publicationCurrent, false); assert.match(prism.card(saved), /wording changed since publication/);
  assert.equal(batch.options.source, source); assert.equal(result.source.reference, "new");
  assert.ok(batch.patch.writes.some(w => w.path === "prism/spec.json"));
  assert.ok(batch.patch.writes.some(w => w.path === "src/lib/prism.ts"));
  for (const stale of [false, true]) {
    let trust;
    const refresh = fn("refreshLive", "// ---- the one write path", {
      get: async () => JSON.stringify(stale ? initial : spec, null, 2) + "\n", rulesOf: async () => saved,
      enc: new TextEncoder(), kappa: async bytes => live.kappaOfValue([...bytes]), pushLive: (_, __, value) => { trust = value; },
    });
    await refresh(1); assert.equal(trust, stale ? "draft" : "proved");
  }
});
test("changed logic drops proof and returns to checked", async () => {
  const spec = structuredClone(initial); spec.rules[0].then = "none"; spec.properties = []; spec.examples = [];
  assert.equal(prism.checkSpec(spec).ok, true);
  for (const candidate of [spec, { ...initial, name: "renamed-module" }]) {
    const { saved } = await revise(candidate, proved());
    assert.equal(saved.phase, "checked"); assert.equal(saved.proof, null); assert.notEqual(saved.logicKappa, key(initial));
  }
});
test("cached identity cannot lend a proof from a different checked spec", async () => {
  const before = proved(); before.spec = { ...before.spec, otherwise: "none" };
  const { saved } = await revise({ ...initial, title: "Reword" }, before);
  assert.equal(saved.phase, "checked"); assert.equal(saved.proof, null);
});
test("proof completion follows matching logic and refuses a competing commit", async () => {
  for (const accepted of [false, true]) {
    const state = { ...proved(), phase: "proving" }, latest = { ...state, specKappa: "reworded" }; let reads = 0, refreshed = 0, audits = 0;
    const prove = fn("proveRules", '// "approve"', {
      rulesOf: async () => ++reads === 1 ? state : latest,
      prism: { prove: async () => ({ ok: true, record: state.proof }) }, nextPhase: async () => "proved",
      saveRules: async (_, value, expected) => { assert.equal(expected, latest); assert.equal(value.specKappa, "reworded"); return accepted; },
      put: async (_, __, value) => { assert.equal(value.resource, state.logicKappa); audits++; }, refreshLive: async () => refreshed++, now: () => "now",
    });
    assert.equal((await prove(1, state.logicKappa))?.ok ?? false, accepted);
    assert.equal(refreshed, Number(accepted)); assert.equal(audits, Number(accepted));
  }
});
test("live persistence failure discards optimistic history and reloads committed state", async () => {
  const source = { files: [["prism/spec.json", JSON.stringify(initial)]] }, editors = new Map([[1, createEditor(initial, () => ({ ok: true }))]]);
  let refreshed = 0, refused = 0;
  const patch = fn("patchSpec", "// What the user points", {
    structuredClone, liveEditors: editors, liveBusy: new Map(), pushLive() {}, applyOps, inOrder: (_, job) => job(),
    assertGenerationActive, captureProjectSource: async () => source, dbReady: Promise.resolve(),
    editorOf: async (_, captured) => { assert.equal(captured, source); return editors.get(1); }, rulesOf: async () => proved(),
    saveSpec: async (_, spec, options) => { assert.equal(spec.title, "Changed"); assert.equal(options.source, source); throw Object.assign(Error("projectEditConflict"), { code: "projectEditConflict" }); },
    refreshLive: async () => refreshed++, refuse: () => refused++,
  });
  await assert.rejects(patch(1, [{ op: "set", path: ["title"], value: "Changed" }]), e => e.code === "projectEditConflict");
  assert.equal(editors.has(1), false); assert.equal(refreshed, 1); assert.equal(refused, 1);
});
test("the signed installed guest supports reword alongside composition and work", async () => {
  const self = {};
  vm.runInNewContext(fs.readFileSync(new URL("../shell/kernel.js", import.meta.url), "utf8"), { self, crypto: webcrypto, WebAssembly, TextEncoder, TextDecoder, Uint8Array, atob });
  const guest = await self.ForgeKernel.load(async path => new Response(fs.readFileSync(new URL("../shell/" + path, import.meta.url))));
  assert.ok(guest.vectors >= 114);
  for (const phase of ["drafting", "checked", "proving", "proved", "published"]) assert.equal(await guest.ask(phase + " reword"), phase);
  assert.equal(await guest.ask("compose "), "malformedComposition");
  assert.equal(await guest.ask("work "), "invalidWorkRequest");
});

test("invalid live edits redraw with source-bound publication trust", async () => {
  for (const mismatch of [false, true]) {
    const json = JSON.stringify(initial), state = { ...proved(), phase: "published", publicationCurrent: false, specKappa: mismatch ? "other" : "current" };
    let trust;
    const refresh = fn("refreshLive", "// ---- the one write path", {
      get: async () => json, rulesOf: async () => state, enc: new TextEncoder(),
      kappa: async () => "current", pushLive: (_, __, value) => { trust = value; },
    });
    const editor = createEditor(initial, () => ({ ok: false, issues: ["invalid"] }));
    const patch = fn("patchSpec", "// What the user points", {
      structuredClone, liveEditors: new Map([[1, editor]]), liveBusy: new Map(), applyOps,
      pushLive: (_, __, value) => { trust = value; }, inOrder: (_, job) => job(),
      assertGenerationActive, dbReady: Promise.resolve(), captureProjectSource: async () => ({}),
      editorOf: async () => editor, rulesOf: async () => state, refuse() {}, refreshLive: refresh,
    });
    assert.equal((await patch(1, [{ op: "set", path: ["title"], value: "Rejected" }])).ok, false);
    assert.equal(trust, mismatch ? "draft" : "proved");
  }
});
test("proof completion retries a matching reword CAS without rerunning the prover", async () => {
  const state = { ...proved(), phase: "proving", proof: null }, reword = { ...state, specKappa: "new" };
  let reads = 0, saves = 0, proofs = 0;
  const prove = fn("proveRules", '// "approve"', {
    rulesOf: async () => ++reads <= 2 ? state : reword,
    prism: { prove: async () => { proofs++; return { ok: true, record: { id: "settled" } }; } },
    nextPhase: async () => "proved", saveRules: async (_, next, expected) => {
      saves++; if (saves === 1) return false;
      assert.equal(expected, reword); assert.equal(next.specKappa, "new"); assert.equal(next.proof.id, "settled"); return true;
    }, put: async () => {}, refreshLive: async () => {}, now: () => "now",
  });
  assert.equal((await prove(1, state.logicKappa))?.ok, true);
  assert.equal(saves, 2); assert.equal(proofs, 1);
});
test("proof completion stops retrying when the competing edit changes semantics", async () => {
  const state = { ...proved(), phase: "proving" };
  let reads = 0, saves = 0;
  const prove = fn("proveRules", '// "approve"', {
    rulesOf: async () => ++reads <= 2 ? state : { ...state, logicKappa: "different" },
    prism: { prove: async () => ({ ok: true, record: { id: "old-proof" } }) },
    nextPhase: async () => "proved", saveRules: async () => { saves++; return false; },
    put() { assert.fail("changed semantics must not accept old proof"); }, now: () => "now",
  });
  assert.equal(await prove(1, state.logicKappa), null); assert.equal(saves, 1);
});
