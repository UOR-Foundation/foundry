import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { stageGenerationPatch, assertGenerationActive } from "../shell/generation-patch.mjs";
const source = { name: "app", reference: "blake3:" + "a".repeat(64), files: [["a", "old"], ["b", "other"]], dependencies: [] };
const tags = (extra = {}) => ({ writes: [], deletes: [], renames: [], deps: [], ...extra });
test("stage applies complete distinct writes deletes and renames without mutating source", () => {
  const result = stageGenerationPatch(source, tags({ writes: [{ path: "c", content: "new" }], renames: [{ from: "a", to: "d" }], deletes: [{ path: "b" }] }));
  assert.deepEqual([...result.files].sort(), [["c", "new"], ["d", "old"]]); assert.deepEqual(source.files, [["a", "old"], ["b", "other"]]); assert.equal(result.changed, 3);
});
test("ambiguous escaping missing and overwriting operations refuse", () => {
  for (const patch of [tags({ writes: [{ path: "../x", content: "x" }] }), tags({ deletes: [{ path: "missing" }] }), tags({ renames: [{ from: "a", to: "b" }] }), tags({ writes: [{ path: "a", content: "x" }], deletes: [{ path: "a" }] }), tags({ writes: [{ path: "x", content: "x" }, { path: "x", content: "y" }] })]) assert.throws(() => stageGenerationPatch(source, patch), e => e.code === "invalidGenerationPatch");
});
test("direct dependencies require exact versions and become snapshot bytes", () => {
  const p = stageGenerationPatch(source, tags({ deps: ["react@19.1.0", "@scope/pkg@1.2.3"] }));
  assert.deepEqual(p.dependencies, ["@scope/pkg@1.2.3", "react@19.1.0"]);
  const declaration = JSON.parse(p.files.get("prism/dependencies.json")); assert.equal(declaration.profile, "foundry/direct-dependency-requests/1"); assert.deepEqual(declaration.dependencies, [{ name: "@scope/pkg", version: "1.2.3" }, { name: "react", version: "19.1.0" }]);
  for (const dep of ["react", "react@^19.1.0", "react@latest", "file:local", "https://example.test/x", "react@01.2.3"]) assert.throws(() => stageGenerationPatch(source, tags({ deps: [dep] })), e => e.code === "unlockedDependencyRequest");
});
test("conflicting versions reserved manifest and oversized batches refuse", () => {
  assert.throws(() => stageGenerationPatch(source, tags({ deps: ["react@19.1.0", "react@19.2.0"] })), e => e.code === "invalidGenerationPatch");
  assert.throws(() => stageGenerationPatch(source, tags({ deps: ["react@19.1.0"], writes: [{ path: "prism/dependencies.json", content: "wrong" }] })), e => e.code === "invalidGenerationPatch");
  assert.throws(() => stageGenerationPatch(source, tags({ writes: Array.from({ length: 1001 }, (_, i) => ({ path: String(i), content: "" })) })), e => e.code === "invalidGenerationPatch");
});
test("identical writes are no-ops and pre-cancellation is typed", () => {
  assert.equal(stageGenerationPatch(source, tags({ writes: [{ path: "a", content: "old" }] })).changed, 0);
  const controller = new AbortController(); controller.abort("secret"); assert.throws(() => assertGenerationActive(controller.signal), e => e.code === "generationCancelled" && !e.message.includes("secret"));
});
test("the host binds generation source signal and committed results", () => {
  const host = fs.readFileSync(new URL("../shell/host.js", import.meta.url), "utf8");
  assert.ok(host.includes("codebaseOf(appId, projectSource)"));
  assert.ok(host.includes("prism.deviceRequest(intent.prompt, capturedSpec)"));
  assert.ok(host.includes("current?.specKappa === await kappa(enc.encode(capturedSpec))"));
  assert.ok(host.includes("applyPrismTags(appId, tags, { signal: abort.signal, source: projectSource, onCommit })"));
  assert.ok(host.includes("rulesAfterTurn(appId, full, tags.writes.map((w) => w.path), { signal: abort.signal, source: applied.source, onCommit })"));
  assert.ok(host.includes("Committed project changes were retained."));
  assert.ok(!host.includes('if (updatedFiles) commit = await seal('));
});
