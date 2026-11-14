// Plants one defect at a time in the in-tab proof's shell code and reports whether the suite refuses it. Exits 1 if
// any survives. Each file is restored after its defect, and at the end whatever happened.
//   node studio/tools/in_tab_prove_defects.mjs
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const suite = at("./in_tab_prove.test.mjs");
const library = JSON.parse(fs.readFileSync(at("../shell/in-tab/manifest.json"), "utf8")).library.sha256;
const defects = [
  ["a verdict other than proved is taken as a proof", "../shell/in-tab/client.mjs", 'if (verdict.verdict !== "proved") {', "if (false) {"],
  ["the page takes the library's pinned address from the worker", "../shell/in-tab/client.mjs", "libraryPinned: word(s.manifest.library.sha256)", "libraryPinned: word(proof.evidence.library)"],
  ["the page takes the kernel's pinned address from the worker", "../shell/in-tab/client.mjs", "kernelPinned: word(s.manifest.wasm.sha256)", "kernelPinned: word(proof.evidence.kernel)"],
  ["the page takes the statement from the worker", "../shell/in-tab/client.mjs", "specStatement: word(statementAddress(read.app))", "specStatement: word(proof.evidence.statement)"],
  ["the axioms the kernel observed are replaced by the declared ones", "../shell/in-tab/client.mjs", "axiomsObserved: verdictAxiomSet(observed)", "axiomsObserved: verdictAxiomSet(AXIOMS)"],
  ["Lean's refusal is not reported to the guest", "../shell/in-tab/client.mjs", "leanAccepted: accepted ? 1 : 0", "leanAccepted: 1"],
  ["a guest that gives no verdict is taken as proved", "../shell/in-tab/client.mjs", 'if (!verdict.ok) return no("the kernel guest gave no verdict (" + verdict.code + ")");', 'if (!verdict.ok) verdict = { ok: true, verdict: "proved" };'],
  ["the statement's address leaves out otherwise", "../shell/in-tab/spec-app.mjs", "app.rules.map((r) => [r.when, r.outcome]), app.otherwise,", "app.rules.map((r) => [r.when, r.outcome]),"],
  // The manifest names the library by its address once as a file (and once more in the binding, as `library`).
  ["the shell's library is not the one its manifest names", "../shell/in-tab/manifest.json", `"sha256": "${library}"`, `"sha256": "${library.replace(/^./, (c) => (c === "0" ? "1" : "0"))}"`],
];
// A run that does not end is stopped: a defect that makes the suite hang is not one it refuses.
const run = () => spawnSync(process.execPath, ["--test", "--test-reporter=tap", "--test-timeout=60000", suite], { encoding: "utf8", timeout: 240000 });
let survived = 0;
for (const [name, file, find, replace] of defects) {
  const path = at(file), original = fs.readFileSync(path, "utf8");
  // The manifest names the library twice (the file, and the binding); the first is the one planted.
  if (!original.includes(find) || (file.endsWith(".json") ? false : original.split(find).length !== 2)) { console.log("CANNOT PLANT " + name); survived++; continue; }
  try {
    fs.writeFileSync(path, original.replace(find, () => replace));
    const r = run();
    const failing = (r.stdout.match(/^not ok \d+ - .*$/gm) ?? []).map((l) => l.replace(/^not ok \d+ - /, ""));
    const refused = r.status !== 0 && failing.length > 0;
    if (!refused) survived++;
    console.log(`${refused ? "refused " : "SURVIVED"} ${name}${refused ? ": " + failing[0].slice(0, 70) : ""}`);
  } finally { fs.writeFileSync(path, original); }
}
const restored = run();
console.log(restored.status === 0 ? "restored: the suite passes" : "NOT RESTORED: the suite fails");
process.exit(survived || restored.status !== 0 ? 1 : 0);
