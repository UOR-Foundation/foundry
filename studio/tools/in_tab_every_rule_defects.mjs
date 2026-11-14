// Plants one defect at a time in how the tab reads and proves every shape of rule, and reports whether FA-88's suite
// refuses it. Exits 1 if any survives. Each file is restored after its defect, and at the end whatever happened.
//   node studio/tools/in_tab_every_rule_defects.mjs
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const suite = at("./in_tab_every_rule.test.mjs");
const defects = [
  ["a comparison of two fields is read the other way round", "../shell/in-tab/spec-app.mjs", "return [i, op, j, true];", "return [j, op, i, true];"],
  ["is not is read as is", "../shell/in-tab/spec-app.mjs", '"is not": 5, "!=": 5', '"is not": 4, "!=": 5'],
  ["a number with no maximum is bounded below what a request can carry", "../shell/in-tab/spec-app.mjs", "export const LARGEST = 10n ** 18n - 1n;", "export const LARGEST = 10n ** 9n;"],
  ["the zones of is not leave out the values above", "../shell/in-tab/zones.mjs", "return [...(value === 0n ? [] : [[setHi(B, f, value - 1n), ds]]), [setLo(B, f, value + 1n), ds]];", "return [...(value === 0n ? [] : [[setHi(B, f, value - 1n), ds]])];"],
  ["the zones of a strict comparison are not strict", "../shell/in-tab/zones.mjs", "if (op === 0) return [[B, [{ a, k: 1, b, j: 0 }, ...ds]]];", "if (op === 0) return [[B, [{ a, k: 0, b, j: 0 }, ...ds]]];"],
  ["the zones of a greater-than comparison are not strict", "../shell/in-tab/zones.mjs", "if (op === 2) return [[B, [{ a: b, k: 1, b: a, j: 0 }, ...ds]]];", "if (op === 2) return [[B, [{ a: b, k: 0, b: a, j: 0 }, ...ds]]];"],
  ["the zones of = keep only one direction", "../shell/in-tab/zones.mjs", "if (op === 4) return [[B, [{ a, k: 0, b, j: 0 }, { a: b, k: 0, b: a, j: 0 }, ...ds]]];", "if (op === 4) return [[B, [{ a, k: 0, b, j: 0 }, ...ds]]];"],
  ["a covering names no earlier zone", "../shell/in-tab/zones.mjs", "if (!zEmpty(meetZ(m, z))) sel.push([j, k]);", "if (false) sel.push([j, k]);"],
];
// A run that does not end is stopped: a defect that makes the suite hang is not one it refuses.
const run = () => spawnSync(process.execPath, ["--test", "--test-reporter=tap", "--test-timeout=200000", suite], { encoding: "utf8", timeout: 600000 });
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
