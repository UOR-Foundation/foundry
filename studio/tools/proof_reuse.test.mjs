// FA-28: a theorem Lean proved before, on the same exact declarations, is not proved again; only the
// theorems that changed go to Lean, and when none did Lean does not run. The verifier here is a fake that
// records what it is sent and attests exactly the files it verified; everything else is the real code.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as prism from "../shell/prism.js";
import { addresses, admit, canonical, headersOf, sha256, theoremsOf, reuseSentence, REFUSAL, KEY_PREFIX } from "../shell/prism/proof-reuse.mjs";
import { names, renderModel } from "../shell/prism/render.mjs";

const RAW = {
  purpose: "Parking fee: decide the fee tier for one stay.", title: "Parking Fee",
  fields: [{ name: "hours", kind: "number", min: 0, max: 24 }, { name: "vehicle", kind: "choice", values: ["car", "motorcycle", "truck"] }],
  outcomes: ["free", "standard", "premium"],
  rules: [{ when: [{ field: "hours", op: "=", value: 0 }], then: "free" }, { when: [{ field: "vehicle", op: "is", value: "truck" }], then: "premium" }, { when: [{ field: "hours", op: ">", value: 12 }], then: "premium" }],
  otherwise: "standard",
  properties: [
    { kind: "never", when: [{ field: "hours", op: "=", value: 0 }], then: "premium" },
    { kind: "never", when: [{ field: "vehicle", op: "is", value: "car" }, { field: "hours", op: "<", value: 5 }], then: "premium" },
    { kind: "always", when: [{ field: "vehicle", op: "is", value: "truck" }, { field: "hours", op: ">", value: 0 }], then: "premium" },
  ],
  examples: [],
};
const specOf = (raw) => { const r = prism.checkSpec(structuredClone(raw)); assert.ok(r.ok, (r.issues || []).join("; ")); return r.spec; };
const SPEC = specOf(RAW);
const PROFILE_ID = "a".repeat(64);
const TRUST = { schema: "lexlean-mcp/proof-reuse-trust/1", epoch: "e".repeat(64), toolchain: { lean: "1".repeat(64), lake: "2".repeat(64), leanchecker: "3".repeat(64), lexlean: "4".repeat(64), compilerSemantics: "5".repeat(64) } };
const identity = () => ({ server: "https://mcp.uor.foundation/", profile: "prism-app", profileId: PROFILE_ID, trust: structuredClone(TRUST) });

// A stateful app's module, as the LexLean-module path sends it: definitions and two theorems in one file.
const MODULE = (limit = 3) => [
  "\\begin{lexlean}{App}", "\\useglossary{lexlean.std.nat@1.2.0}", "\\title{Counter}", "\\begin{semanticmodule}",
  "definition{name: cap, parameters: [], result: Nat, body: 9}", "",
  "definition{name: bump, parameters: [n : Nat], result: Nat, body: (if (n <? (cap)) then (n + 1) else n)}", "",
  "definition{name: label, parameters: [], result: String, body: \"counter\"}", "",
  "theorem{name: bumpBounded, parameters: [n : Nat], statement: (((bump n) <=? ((cap) + 1)) = true), proof: linear_arithmetic{definitions: [bump, cap]}}", "",
  `theorem{name: capSmall, parameters: [], statement: (((cap) <=? ${limit * 3}) = true), proof: decide{}}`,
  "\\end{semanticmodule}", "\\end{lexlean}", "",
].join("\n");
const moduleFiles = (source) => async () => ({ files: [{ path: "src/Library.lex.tex", content: "library bytes" }, { path: "src/App.lex.tex", content: source }], entrypoints: ["src/App.lex.tex"] });

// The fake's Lean observes [propext] for the first model definition of the decision app, so an unseeded
// decision proof takes one axiom correction round, as the hosted verifier does.
const observed = /definition\{\s*name: (\w+),/.exec(renderModel(SPEC))[1];

function fakeVerifier({ profileId = PROFILE_ID } = {}) {
  const v = { calls: [], verifies: [], attested: new Set(), drafts: new Map(), forget: false, n: 0, trust: structuredClone(TRUST), evidence: new Map() };
  const reply = (id, result) => new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: { "content-type": "application/json" } });
  v.fetch = async (url, init) => {
    if (String(url).startsWith("file:")) return new Response(fs.readFileSync(fileURLToPath(url), "utf8"));
    const { id, method, params } = JSON.parse(init.body);
    assert.equal(method, "tools/call");
    const { name, arguments: args } = params;
    v.calls.push(name);
    if (name === "lexlean_profiles") return reply(id, { structuredContent: { profiles: [{ id: profileId, name: "prism-app", proof_reuse: v.trust }] } });
    if (name === "lexlean_attestation") {
      const evidence = v.evidence.get(args.value);
      return reply(id, { structuredContent: { found: !v.forget && !!evidence, ...evidence } });
    }
    if (name === "lexlean_draft_write") { const draft = "spec/" + (await sha256(JSON.stringify(args.files))); v.drafts.set(draft, args.files); return reply(id, { structuredContent: { draft } }); }
    if (name === "lexlean_verify") {
      const files = v.drafts.get(args.project);
      v.verifies.push(files);
      const model = files.find((f) => f.content.includes(`name: ${observed},`));
      const block = model ? model.content.slice(model.content.indexOf(`name: ${observed},`)).split("\n}\n")[0] : "axioms: [propext]";
      const body = block.includes("axioms: [propext]")
        ? { attestation_id: (++v.n).toString(16).padStart(64, "0"), modules: args.files.map((p) => p.replace(/^src\//, "").replace(/\.lex\.tex$/, "").split("/").join(".")) }
        : { diagnostics: [{ message: `\`Spec.${observed}\` violates its exact axiom policy: observed [propext]` }] };
      if (body.attestation_id) {
        const digests = await Promise.all(files.map((f) => sha256(f.content)));
        for (const digest of digests) v.attested.add(digest);
        v.evidence.set(body.attestation_id, { attestation_id: body.attestation_id, status: "verified", files: digests, proof_reuse: structuredClone(v.trust) });
      }
      return reply(id, { taskId: "t" + v.verifies.length, status: "completed", result: { structuredContent: { state: body.attestation_id ? "verified" : "failed" }, content: [{ text: JSON.stringify(body) }] } });
    }
    throw new Error("unexpected tool " + name);
  };
  return v;
}
function memoryStore() {
  const m = new Map();
  return { m, get: async (k) => m.get(k), put: async (k, val) => { m.set(k, structuredClone(val)); } };
}
async function withVerifier(v, fn) {
  const saved = globalThis.fetch;
  globalThis.fetch = v.fetch;
  try { return await fn(); } finally { globalThis.fetch = saved; }
}
const theoremsSent = (files) => [...files.map((f) => f.content).join("\n").matchAll(/theorem\{\s*name: (\w+),/g)].map((m) => m[1]);

test("a decision app's first proof sends every guarantee and files one record per theorem address", async () => {
  const v = fakeVerifier(), store = memoryStore();
  const result = await withVerifier(v, () => prism.prove(SPEC, { store }));
  assert.equal(result.ok, true, result.error);
  assert.equal(v.verifies.length, 2, "one axiom correction round, then the verified run");
  assert.equal(theoremsSent(v.verifies[1]).length, 3);
  assert.equal(result.record.proved, 3);
  assert.equal(result.record.reused, 0);
  assert.equal(store.m.size, 3);
  for (const key of store.m.keys()) assert.ok(key.startsWith(KEY_PREFIX));
  assert.deepEqual(result.record.theorems.map((g) => g.refusal), [REFUSAL.absent, REFUSAL.absent, REFUSAL.absent]);
});

test("an unchanged decision app is proved with no Lean run, under the axiom sets Lean observed", async () => {
  const v = fakeVerifier(), store = memoryStore();
  const first = await withVerifier(v, () => prism.prove(SPEC, { store }));
  const runs = v.verifies.length, drafts = v.calls.filter((c) => c === "lexlean_draft_write").length;
  let submitted = 0;
  const again = await withVerifier(v, () => prism.prove(specOf(RAW), { store, beforeSubmit: () => submitted++ }));
  assert.equal(again.ok, true, again.error);
  assert.equal(v.verifies.length, runs, "no verify call");
  assert.equal(v.calls.filter((c) => c === "lexlean_draft_write").length, drafts, "no source sent");
  assert.equal(submitted, 1, "the caller is told the proof was committed to");
  assert.equal(again.record.reused, 3);
  assert.equal(again.record.proved, 0);
  assert.equal(again.record.attestation_id, first.record.attestation_id);
  assert.deepEqual(again.axioms, first.axioms);
  assert.match(reuseSentence(SPEC.properties.length, again.record.reused), /none was proved again/);
});

test("changing one guarantee sends only its theorem, with the cached axiom sets, in one run", async () => {
  const v = fakeVerifier(), store = memoryStore();
  await withVerifier(v, () => prism.prove(SPEC, { store }));
  const edited = structuredClone(RAW);
  edited.properties[1].when[1].value = 4;
  const spec = specOf(edited);
  const runs = v.verifies.length;
  const result = await withVerifier(v, () => prism.prove(spec, { store }));
  assert.equal(result.ok, true, result.error);
  assert.equal(v.verifies.length, runs + 1, "no axiom correction round");
  assert.deepEqual(theoremsSent(v.verifies.at(-1)), [names(spec).properties[spec.properties[1].id].theorem]);
  assert.deepEqual(result.record.theorems.map((g) => g.reused), [true, false, true]);
  assert.equal(result.record.reused, 2);
  assert.equal(result.record.proved, 1);
  assert.equal(result.record.attestations.length, 2);
  assert.match(reuseSentence(spec.properties.length, result.record.reused), /2 were proved before.*Lean proved the other 1/);
});

test("in a LexLean module, editing one theorem re-proves it alone; editing a definition re-proves its dependants", async () => {
  const v = fakeVerifier(), store = memoryStore();
  const first = await withVerifier(v, () => prism.proveFiles(moduleFiles(MODULE()), { store }));
  assert.equal(first.ok, true, first.error);
  assert.deepEqual(theoremsSent(v.verifies.at(-1)), ["bumpBounded", "capSmall"]);
  const runs = v.verifies.length;
  const edited = await withVerifier(v, () => prism.proveFiles(moduleFiles(MODULE(4)), { store }));
  assert.equal(edited.ok, true, edited.error);
  assert.equal(v.verifies.length, runs + 1);
  assert.deepEqual(theoremsSent(v.verifies.at(-1)), ["capSmall"], "bumpBounded is left out of the file");
  assert.equal(edited.record.reused, 1);
  // A definition only one theorem reaches does not move the other; one both reach moves both.
  const relabel = await withVerifier(v, () => prism.proveFiles(moduleFiles(MODULE(4).replace('"counter"', '"tally"')), { store }));
  assert.equal(relabel.record.reused, 2, "label is reached by neither theorem");
  const recap = await withVerifier(v, () => prism.proveFiles(moduleFiles(MODULE(4).replace("body: 9}", "body: 8}")), { store }));
  assert.equal(recap.record.reused, 0, "cap is reached by both");
});

test("addresses ignore axioms and layout, and move with the verifier, the library and any reached byte", async () => {
  const id = identity();
  const { files, entrypoints } = await moduleFiles(MODULE())();
  const base = await addresses({ files, entrypoints, verifier: id });
  assert.equal(new Set(Object.values(base)).size, 2);
  for (const changed of ["epoch", ...Object.keys(TRUST.toolchain)]) {
    const verifier = identity();
    if (changed === "epoch") verifier.trust.epoch = "f".repeat(64); else verifier.trust.toolchain[changed] = "f".repeat(64);
    const other = await addresses({ files, entrypoints, verifier });
    for (const key of Object.keys(base)) assert.notEqual(other[key], base[key], changed);
  }
  const relaid = MODULE().replace("theorem{name: bumpBounded, ", "theorem{\n  name: bumpBounded,\n  ").replace("proof: linear_arithmetic{definitions: [bump, cap]}}", "proof: linear_arithmetic{definitions: [bump, cap]},\n  axioms: [\n    Quot.sound,\n    propext\n  ]\n}");
  assert.deepEqual(await addresses({ files: [files[0], { ...files[1], content: relaid }], entrypoints, verifier: id }), base);
  const moved = [
    await addresses({ files, entrypoints, verifier: { ...id, profileId: "b".repeat(64) } }),
    await addresses({ files: [{ ...files[0], content: "other library" }, files[1]], entrypoints, verifier: id }),
    await addresses({ files: [files[0], { ...files[1], content: MODULE().replace("result: Nat, body: (if", "result: Nat, body:  (if") }], entrypoints, verifier: id }),
  ];
  for (const other of moved.slice(0, 2)) for (const k of Object.keys(base)) assert.notEqual(other[k], base[k]);
  assert.deepEqual(moved[2], base, "layout whitespace is not a byte the kernel sees");
  // A reached definition moves the address; one the theorem does not reach leaves it.
  const bounded = "src/App.lex.tex#bumpBounded";
  const recapped = await addresses({ files: [files[0], { ...files[1], content: MODULE().replace("body: 9}", "body: 8}") }], entrypoints, verifier: id });
  const relabelled = await addresses({ files: [files[0], { ...files[1], content: MODULE().replace('"counter"', '"tally"') }], entrypoints, verifier: id });
  assert.notEqual(recapped[bounded], base[bounded]);
  assert.equal(relabelled[bounded], base[bounded]);
  assert.notEqual(canonical('definition{name: g, body: (f ab)}'), canonical('definition{name: g, body: (fa b)}'));
  assert.notEqual(canonical('definition{name: g, body: "a  b"}'), canonical('definition{name: g, body: "a b"}'));
});

test("a record is refused unless its address, verifier, bytes and attestation all re-derive", async () => {
  const v = fakeVerifier(), store = memoryStore();
  await withVerifier(v, () => prism.proveFiles(moduleFiles(MODULE()), { store }));
  const { files, entrypoints } = await moduleFiles(MODULE())();
  const authors = files.filter((f) => entrypoints.includes(f.path));
  const verifier = identity();
  const address = await addresses({ files, entrypoints, verifier });
  const theorem = theoremsOf(authors).find((t) => t.name === "bumpBounded");
  const entry = store.m.get(KEY_PREFIX + address[theorem.id]);
  const found = async (id) => ({ found: !v.forget, ...v.evidence.get(id) });
  const check = (e, more = {}) => admit({ entry: e, theorem, address: address[theorem.id], verifier, headers: headersOf(authors), found, ...more });
  assert.deepEqual(await check(entry), { admitted: true });
  assert.equal((await check(null)).refusal, REFUSAL.absent);
  assert.equal((await check(entry, { verifier: { ...verifier, trust: null } })).refusal, REFUSAL.trustUnavailable);
  assert.equal((await check({ ...entry, schema: "other" })).refusal, REFUSAL.malformed);
  assert.equal((await check({ ...entry, theorem: "src/App.lex.tex#capSmall" })).refusal, REFUSAL.malformed);
  assert.equal((await check({ ...entry, address: "c".repeat(64) })).refusal, REFUSAL.address);
  assert.equal((await check(entry, { verifier: { ...verifier, profileId: "d".repeat(64) } })).refusal, REFUSAL.verifier);
  const altered = (content) => ({ ...entry, files: [{ ...entry.files[0], content }] });
  assert.equal((await check(altered(entry.files[0].content + "\n"))).refusal, REFUSAL.bytes, "content no longer matches its digest");
  const rehash = async (content) => ({ ...entry, files: [{ path: entry.files[0].path, content, sha256: await sha256(content) }] });
  assert.equal((await check(await rehash(entry.files[0].content.replace("body: 9}", "body: 8}")))).refusal, REFUSAL.bytes, "a reached definition differs");
  assert.equal((await check(await rehash(entry.files[0].content.replace("\\title{Counter}", "\\title{Other}")))).refusal, REFUSAL.bytes, "another header");
  assert.equal((await check(await rehash(entry.files[0].content + "\n"))).refusal, REFUSAL.attestation, "bytes the verifier never attested");
  assert.equal((await check(entry, { found: async () => false })).refusal, REFUSAL.attestation);
});

test("a refused or unreadable record means proving again, never a failure", async () => {
  const v = fakeVerifier(), store = memoryStore();
  await withVerifier(v, () => prism.prove(SPEC, { store }));
  const [key, entry] = [...store.m.entries()][0];
  store.m.set(key, { ...entry, files: entry.files.map((f, i) => (i ? f : { ...f, content: f.content + " " })) });
  const runs = v.verifies.length;
  const tampered = await withVerifier(v, () => prism.prove(SPEC, { store }));
  assert.equal(tampered.ok, true, tampered.error);
  assert.equal(v.verifies.length, runs + 1);
  assert.equal(tampered.record.proved, 1);
  assert.equal(tampered.record.theorems.find((g) => g.theorem === entry.theorem).refusal, REFUSAL.bytes);
  v.forget = true;
  const forgotten = await withVerifier(v, () => prism.prove(SPEC, { store }));
  assert.equal(forgotten.ok, true, forgotten.error);
  assert.equal(forgotten.record.proved, 3, "attestations the verifier no longer finds are not believed");
  const silent = fakeVerifier();
  const answer = silent.fetch;
  silent.fetch = async (url, init) => (init && JSON.parse(init.body).params.name === "lexlean_attestation" ? new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "unavailable" } })) : answer(url, init));
  const unanswered = await withVerifier(silent, () => prism.prove(SPEC, { store }));
  assert.equal(unanswered.ok, true, "a lookup the verifier does not answer means proving everything");
  assert.equal(theoremsSent(silent.verifies.at(-1)).length, 3);
  const broken = { get: async () => { throw new Error("storage refused"); }, put: async () => { throw new Error("storage refused"); } };
  const unreadable = await withVerifier(fakeVerifier(), () => prism.prove(SPEC, { store: broken }));
  assert.equal(unreadable.ok, true, unreadable.error);
  assert.equal(unreadable.record.proved, 3);
});

test("the host proves a stateful app with a store over its refs records", async () => {
  const host = fs.readFileSync(new URL("../shell/host.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const app = host.slice(host.indexOf("async function proveApp("));
  assert.match(app.slice(0, app.indexOf("\n}\n")), /prism\.proveFiles\([\s\S]*?store: \{ get: \(key\) => get\("refs", key\), put: \(key, value\) => put\("refs", key, value\) \}/);
});


test("an unsupported or malformed service trust descriptor falls back to full proving without storing records", async () => {
  for (const trust of [undefined, null, {}, { ...TRUST, epoch: "" }, { ...TRUST, toolchain: {} }]) {
    const v = fakeVerifier(), store = memoryStore();
    v.trust = trust;
    const first = await withVerifier(v, () => prism.proveFiles(moduleFiles(MODULE()), { store }));
    const again = await withVerifier(v, () => prism.proveFiles(moduleFiles(MODULE()), { store }));
    assert.equal(first.ok, true); assert.equal(again.ok, true);
    assert.equal(v.verifies.length, 2);
    assert.equal(again.record.reused, 0);
    assert.equal(store.m.size, 0, "unbound evidence is not filed for later reuse");
    assert.ok(again.record.theorems.every((t) => t.refusal === REFUSAL.trustUnavailable));
  }
});

test("same-profile toolchain upgrades and trust epoch rotation invalidate reuse in a long-lived tab", async () => {
  for (const changed of ["epoch", ...Object.keys(TRUST.toolchain)]) {
    const v = fakeVerifier(), store = memoryStore();
    await withVerifier(v, () => prism.proveFiles(moduleFiles(MODULE()), { store }));
    if (changed === "epoch") v.trust.epoch = "f".repeat(64); else v.trust.toolchain[changed] = "f".repeat(64);
    const again = await withVerifier(v, () => prism.proveFiles(moduleFiles(MODULE()), { store }));
    assert.equal(again.ok, true); assert.equal(again.record.reused, 0, changed);
    assert.equal(v.verifies.length, 2, changed);
  }
});

test("retired SDK Lean executable addresses cannot authorize reuse", async () => {
  for (const lean of ["e8baaa71855a616dc351028f3ad2200051b0671f423a1696a100e809302d5550", "79fb1d26fa5a39385d59fdc48a711a14b0710ca6480271acce99b4d177cea085"]) {
    const v = fakeVerifier(), store = memoryStore(); v.trust.toolchain.lean = lean;
    await withVerifier(v, () => prism.proveFiles(moduleFiles(MODULE()), { store }));
    const again = await withVerifier(v, () => prism.proveFiles(moduleFiles(MODULE()), { store }));
    assert.equal(again.record.reused, 0); assert.equal(store.m.size, 0);
  }
});

test("bare found, wrong attestation, incomplete files, failed status and old trust evidence never authorize reuse", async () => {
  for (const plant of [
    (e) => ({ found: true }),
    (e) => ({ ...e, attestation_id: "0".repeat(64) }),
    (e) => ({ ...e, files: [] }),
    (e) => ({ ...e, status: "failed" }),
    (e) => ({ ...e, proof_reuse: { ...e.proof_reuse, epoch: "0".repeat(64) } }),
  ]) {
    const v = fakeVerifier(), store = memoryStore();
    await withVerifier(v, () => prism.proveFiles(moduleFiles(MODULE()), { store }));
    for (const [id, e] of v.evidence) v.evidence.set(id, plant(e));
    const again = await withVerifier(v, () => prism.proveFiles(moduleFiles(MODULE()), { store }));
    assert.equal(again.ok, true); assert.equal(again.record.reused, 0);
    assert.equal(v.verifies.length, 2);
  }
});

test("legacy and forged-policy records are invalidated even when copied to the new address", async () => {
  for (const change of [(e) => ({ ...e, schema: "prism/proof-reuse/1" }), (e) => ({ ...e, policyEpoch: "retired" }), (e) => ({ ...e, trust: { ...TRUST, epoch: "0".repeat(64) } })]) {
    const v = fakeVerifier(), store = memoryStore();
    await withVerifier(v, () => prism.proveFiles(moduleFiles(MODULE()), { store }));
    for (const [key, e] of store.m) store.m.set(key, change(e));
    const again = await withVerifier(v, () => prism.proveFiles(moduleFiles(MODULE()), { store }));
    assert.equal(again.record.reused, 0); assert.equal(v.verifies.length, 2);
  }
});

test("an epoch change while admitting cached records reruns the full proof", async () => {
  const v = fakeVerifier(), store = memoryStore();
  await withVerifier(v, () => prism.proveFiles(moduleFiles(MODULE()), { store }));
  const original = v.fetch;
  let rotated = false;
  v.fetch = async (url, init) => {
    const result = await original(url, init);
    if (init && JSON.parse(init.body).params.name === "lexlean_attestation" && !rotated) { v.trust.epoch = "f".repeat(64); rotated = true; }
    return result;
  };
  const again = await withVerifier(v, () => prism.proveFiles(moduleFiles(MODULE()), { store }));
  assert.equal(again.ok, true); assert.equal(again.record.reused, 0); assert.equal(v.verifies.length, 2);
  assert.deepEqual(theoremsSent(v.verifies.at(-1)), ["bumpBounded", "capSmall"]);
});

test("a proof completed by a different toolchain is not relabelled or mixed with earlier reused proofs", async () => {
  const v = fakeVerifier(), store = memoryStore();
  await withVerifier(v, () => prism.proveFiles(moduleFiles(MODULE()), { store }));
  const original = v.fetch;
  let rotated = false;
  v.fetch = async (url, init) => {
    if (init && JSON.parse(init.body).params.name === "lexlean_verify" && !rotated) { v.trust.epoch = "f".repeat(64); rotated = true; }
    return original(url, init);
  };
  const edited = await withVerifier(v, () => prism.proveFiles(moduleFiles(MODULE(4)), { store }));
  assert.equal(edited.ok, true); assert.equal(edited.record.reused, 0);
  assert.deepEqual(theoremsSent(v.verifies.at(-1)), ["bumpBounded", "capSmall"]);
  for (const record of store.m.values()) assert.equal(record.trust.epoch, TRUST.epoch, "changed toolchain never stamped on prior records");
});


test("an epoch rotation during final attestation retrieval cannot commit a mixed verdict", async () => {
  const v = fakeVerifier(), store = memoryStore();
  await withVerifier(v, () => prism.proveFiles(moduleFiles(MODULE()), { store }));
  const original = v.fetch;
  let rotated = false;
  v.fetch = async (url, init) => {
    const result = await original(url, init);
    const params = init && JSON.parse(init.body).params;
    if (params?.name === "lexlean_attestation" && params.arguments.value === "2".padStart(64, "0") && !rotated) {
      v.trust.epoch = "f".repeat(64); rotated = true;
    }
    return result;
  };
  const edited = await withVerifier(v, () => prism.proveFiles(moduleFiles(MODULE(4)), { store }));
  assert.equal(rotated, true); assert.equal(edited.ok, true); assert.equal(edited.record.reused, 0);
  assert.deepEqual(theoremsSent(v.verifies.at(-1)), ["bumpBounded", "capSmall"]);
  assert.equal(store.m.size, 2, "the mixed candidate never enters the reuse store");
});
