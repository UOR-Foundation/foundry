// What content addressing removes from an app's proof, counted on Verdant, and a Lean file that times the kernel on
// what is left.
//   node live/obligations.mjs <VerdantRegions.lean> <out.lean>
//
// An obligation is: the region M where a rule's box meets a guarantee's box must be covered by the boxes of earlier
// rules. Two things make most of the kernel's work redundant:
//   - an earlier box that does not touch M cannot cover any of it, so it need not be subtracted;
//   - M and the boxes that touch it are the obligation's whole meaning, so two obligations with the same ones are one.
// This counts both, as studio/shell/live/obligations.mjs keys them, and writes the distinct obligations as literal
// data for `decide +kernel`. It proves nothing: the file it writes states only that the listed regions are covered.
import fs from "node:fs";
import { createHash } from "node:crypto";

const [leanPath, out] = process.argv.slice(2);
const lean = fs.readFileSync(leanPath, "utf8");
const block = (name) => new RegExp(`def ${name} : [^\\n]* := \\[([\\s\\S]*?)\\]\\n\\n`).exec(lean)[1];
const conds = (s) => [...s.matchAll(/⟨(\d+), (\d+), (\d+)⟩/g)].map((m) => m.slice(1).map(Number));
const rules = [...block("rules").matchAll(/⟨\[(.*?)\], (\d+)⟩/g)].map((m) => ({ when: conds(m[1]), outcome: Number(m[2]) }));
const props = [...block("props").matchAll(/⟨(true|false), \[(.*?)\], (\d+)⟩/g)].map((m) => ({ always: m[1] === "true", when: conds(m[2]), outcome: Number(m[3]) }));
const B = [.../def B : Box := \[(.*)\]/.exec(lean)[1].matchAll(/\((\d+), (\d+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
const d = Number(/def d : Nat := (\d+)/.exec(lean)[1]);

// PrismLive.Kernel's boxOf and meet, on literals. `!=` does not narrow.
const boxOf = (when) => { const b = B.map((x) => [...x]); for (const [f, op, v] of when) { if (op === 0) { if (v === 0) { b[f][0] = Math.max(b[f][0], 1); b[f][1] = Math.min(b[f][1], 0); } else b[f][1] = Math.min(b[f][1], v - 1); } else if (op === 1) b[f][1] = Math.min(b[f][1], v); else if (op === 2) b[f][0] = Math.max(b[f][0], v + 1); else if (op === 3) b[f][0] = Math.max(b[f][0], v); else if (op === 4) { b[f][0] = Math.max(b[f][0], v); b[f][1] = Math.min(b[f][1], v); } } return b; };
const meet = (a, b) => a.map(([l, h], i) => [Math.max(l, b[i][0]), Math.min(h, b[i][1])]);
const nonEmpty = (b) => b.every(([l, h]) => l <= h);
const address = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");

const ruleBoxes = rules.map((r) => boxOf(r.when));
const count = { obligations: 0, subtractions: 0, subtractionsTouching: 0, emptyRegions: 0 };
const distinct = new Map();
for (const p of props) {
  const W = boxOf(p.when), bad = (o) => (p.always ? o !== p.outcome : o === p.outcome);
  const one = (A, earlier) => {
    const M = meet(A, W);
    count.obligations++; count.subtractions += earlier.length;
    if (!nonEmpty(M)) { count.emptyRegions++; return; }
    const touching = earlier.filter((b) => nonEmpty(meet(b, M)));
    count.subtractionsTouching += touching.length;
    const key = address([M, touching.map((b) => JSON.stringify(b)).sort()]);
    if (!distinct.has(key)) distinct.set(key, { M, touching });
  };
  rules.forEach((r, i) => { if (bad(r.outcome)) one(ruleBoxes[i], ruleBoxes.slice(0, i)); });
  if (bad(d)) one(B, ruleBoxes);
}
const kept = [...distinct.values()];
count.distinctNonEmpty = kept.length;
count.subtractionsDistinct = kept.reduce((n, o) => n + o.touching.length, 0);
console.log(JSON.stringify({ rules: rules.length, guarantees: props.length, ...count }, null, 1));

const box = (b) => "[" + b.map(([l, h]) => `(${l}, ${h})`).join(", ") + "]";
fs.writeFileSync(out, `import PrismLive.Regions
open PrismLive.Kernel

/-! Verdant's distinct obligations with only the boxes that touch each region, written by v2/in-tab-kernel/live/
obligations.mjs to time the kernel. It states that the listed regions are covered, and nothing about Verdant. -/
def obligations : List (Box × List Box) := [
${kept.map((o) => `  (${box(o.M)}, [${o.touching.map(box).join(", ")}])`).join(",\n")}]

theorem covered : obligations.all (fun o => (subAll o.1 o.2).isEmpty) = true := by decide +kernel
`);
