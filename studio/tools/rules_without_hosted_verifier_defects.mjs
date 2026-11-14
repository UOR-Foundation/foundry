// Plants one defect at a time in how a rules app is approved and published, and reports whether FA-89's suite refuses
// it. Exits 1 if any survives. Each file is restored after its defect, and at the end whatever happened.
//   node studio/tools/rules_without_hosted_verifier_defects.mjs
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const suite = at("./rules_without_hosted_verifier.test.mjs");
const defects = [
  ["a refusal in the tab is handed to the hosted verifier", "../shell/host.js", ": { ok: false, error: tab.why };", ": await prism.prove(reservation.spec, { onWait });"],
  ["a refusal in the tab is saved as proved", "../shell/host.js", ": { ok: false, error: tab.why };", ": { ok: true, seconds: 0, record: {}, axioms: {} };"],
  ["the proof is committed before its answer is in", "../shell/host.js", "  const tab = await inTab.proveInTab(reservation.spec, { guest: kernelReady, commit })", "  commit();\n  const tab = await inTab.proveInTab(reservation.spec, { guest: kernelReady, commit: () => {} })"],
  ["publish asks the hosted verifier first", "../shell/host.js", "  if (refusal) { await show(refusal); return finish(); }\n  const spec = rules.spec;", "  if (refusal) { await show(refusal); return finish(); }\n  await prism.prove(rules.spec, {});\n  const spec = rules.spec;"],
  ["rules over the SDK's limit are published", "../shell/host.js", "    : rules.spec.rules.length > prism.PROVE_RULES_MAX ? prism.publishTooLarge(rules.spec)\n", ""],
  ["the published app claims a hosted attestation", "../shell/prism/template.mjs", "not recorded: the proof ran in the SDK image", "attested by the hosted verifier"],
  ["the proof message promises the hosted verifier", "../shell/prism.js", "Publishing builds the app on GitHub, where its repository proves the model again with the Prism SDK.", "Publishing will ask the hosted verifier for its attestation."],
];
const run = () => spawnSync(process.execPath, ["--test", "--test-reporter=tap", "--test-timeout=60000", suite], { encoding: "utf8", timeout: 300000 });
let survived = 0;
for (const [name, file, find, replace] of defects) {
  const path = at(file), original = fs.readFileSync(path, "utf8");
  if (original.split(find).length !== 2) { console.log("CANNOT PLANT " + name); survived++; continue; }
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
