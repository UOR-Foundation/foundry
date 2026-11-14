// Proves an app through live/Linked.lean: every evaluation a fact kept by its address, every guarantee assembled
// from facts. Then proves it again, then after edits, and plants faults. WebAssembly kernel under Node; one kernel
// for the whole run, as a tab has.
//   node live/linked.mjs <built dist dir> <library.ndjson> <VerdantRegions.lean>
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { linkedProof } from "./emit.mjs";
import { linksOf, linkKey } from "./certs.mjs";
import { prover } from "./prove.mjs";
import { appOf } from "./read-app.mjs";

const [dist, libraryPath, verdantPath] = process.argv.slice(2);
const factory = (await import(pathToFileURL(path.resolve(dist, "lean-kernel.mjs")).href)).default;
const wasmBinary = fs.readFileSync(path.resolve(dist, "lean-kernel.wasm"));
const libraryBytes = fs.readFileSync(libraryPath);
const lines = [];
const m = await factory({ instantiateWasm: (imports, done) => { WebAssembly.instantiate(wasmBinary, imports).then((r) => done(r.instance, r.module)); return {}; }, print: (s) => lines.push(s), printErr: (s) => lines.push(s) });
if (m.ccall("checker_ready", "number", [], []) !== 0) throw new Error("not ready");
// The kernel's answer to one suffix, with what it says each accepted theorem rests on.
const call = (entry, text) => {
  lines.length = 0; m.FS.writeFile("/in.ndjson", text);
  const t = performance.now(); let exit;
  try { exit = m.ccall(entry, "number", ["string"], ["/in.ndjson"]); } catch (e) { exit = 3; lines.push("trap: " + e.message); }
  const ms = performance.now() - t; m.FS.unlink("/in.ndjson");
  const axioms = {};
  for (const line of lines) { const x = /^axioms ([^:]+): ?(.*)$/.exec(line); if (x) axioms[x[1]] = x[2] ? x[2].split(", ") : []; }
  return { exit, ms, axioms: exit === 0 ? axioms : {}, output: lines[lines.length - 1] ?? "" };
};
const MB = () => Math.round(m.HEAPU8.length / 1048576);

if (call("load_library", libraryBytes).exit !== 0) throw new Error("the library was not admitted");
const { prove: proveApp, keep, library, resident } = prover(call, libraryBytes.toString("utf8"));
const prove = (app, links) => { const r = proveApp(app, links); return { ...r, axioms: [...new Set(r.guarantees.filter((g) => g.accepted).map((g) => JSON.stringify(g.axioms)))].map((x) => JSON.parse(x)), kernelMsEach: r.guarantees.map((g) => g.kernelMs ?? null), guarantees: r.guarantees.length, heapMB: MB() }; };

const verdant = appOf(fs.readFileSync(verdantPath, "utf8"), "VerdantLinked");
const report = { rules: verdant.rules.length, first: prove(verdant), again: prove(verdant) };

// Edits: one number in one rule moved by one, from the last rule back. An edit that breaks a guarantee must be
// refused, and is counted.
report.edits = [];
let tried = 0, breaking = 0;
for (let ri = verdant.rules.length - 1; ri >= 0 && report.edits.length < 5; ri--) {
  const rule = verdant.rules[ri];
  if (!rule.when.length) continue;
  const when = rule.when.map((c, k) => (k === 0 ? [c[0], c[1], c[2] + 1] : c));
  const edited = { ...verdant, rules: verdant.rules.map((x, k) => (k === ri ? { ...x, when } : x)) };
  tried++;
  const r = prove(edited);
  if (r.refused.length) { breaking++; continue; }
  report.edits.push({ rule: ri, from: rule.when[0], to: when[0], ...r });
}
report.editsTried = tried; report.editsThatBreakAGuarantee = breaking;
// The app as it was, after the edits: everything it needs is still resident.
report.backToTheFirst = prove(verdant);

// Faults. None may be accepted.
const faults = {}, links = linksOf(verdant);
const gi = links.guarantees.findIndex((g) => g.steps.some((s) => s.how === "cover" && s.sel.length)), g = links.guarantees[gi];
const si = g.steps.findIndex((s) => s.how === "cover" && s.sel.length), step = g.steps[si];
const scratch = () => ({ factsNew: 0, factsReused: 0, newByKind: {}, factMs: 0, writeMs: 0 });
const said = (tally) => tally.said;
{ // A covering that is false: the last box that covers the region is left out.
  const f = links.facts.get(step.covers), Bs = f.Bs.slice(0, -1), lie = { key: linkKey("covers", f.M, Bs), kind: "covers", M: f.M, Bs };
  const tally = scratch(); faults.aCoveringThatIsFalse = { kept: keep([lie], tally), said: said(tally) };
}
{ // A proof that leaves out a rule it needs: the covering it then names is the false one above.
  const sel = step.sel.slice(0, -1), Bs = sel.map((q) => links.boxes[q]), key = linkKey("covers", step.M, Bs);
  const short = { ...links, facts: new Map(links.facts).set(key, { key, kind: "covers", M: step.M, Bs }), guarantees: links.guarantees.map((x, k) => (k !== gi ? x : { ...x, steps: x.steps.map((s, j) => (j === si ? { ...s, sel, covers: key } : s)) })) };
  const r = prove({ ...verdant, name: "FaultShort" }, short);
  faults.aRuleLeftOut = { refused: r.refused, accepted: r.accepted };
}
{ // A rule that breaks the guarantee, said not to: the fact that it does not is false.
  const p = verdant.properties[gi], o = si < verdant.rules.length ? verdant.rules[si].outcome : verdant.otherwise;
  const lie = { key: linkKey("notbad", p.always, p.outcome, o), kind: "notbad", always: p.always, outcome: p.outcome, o };
  const tally = scratch(); faults.aBreakingAnswerSaidHarmless = { kept: keep([lie], tally), said: said(tally) };
  // And answered instead by a true fact about another answer: the assembly does not fit.
  const other = [...links.facts.values()].find((f) => f.kind === "notbad" && f.always === p.always && f.outcome === p.outcome);
  if (other) {
    const wrong = { ...links, guarantees: links.guarantees.map((x, k) => (k !== gi ? x : { ...x, steps: x.steps.map((s, j) => (j === si ? { how: "ok", fact: other.key } : s)) })) };
    const v = call("check_suffix", linkedProof(library, { ...verdant, name: "FaultOther" }, gi, wrong));
    faults.aStepAnsweredByAnotherStepsFact = { exit: v.exit, said: v.output };
  }
}
{ // A fact the kernel never judged: there is nothing to name.
  const ghost = { ...links, guarantees: links.guarantees.map((x, k) => (k !== gi ? x : { ...x, prop: "0".repeat(64) })) };
  try { linkedProof(library, { ...verdant, name: "FaultGhost" }, gi, ghost); faults.aFactNeverJudged = "written"; } catch (e) { faults.aFactNeverJudged = e.message.slice(0, 40); }
}
{ // A guarantee the rules break, with honest facts: a covering it needs cannot be proved.
  const broken = { ...verdant, name: "FaultBroken", properties: verdant.properties.map((p, k) => (k === 0 ? { ...p, always: !p.always } : p)) };
  const r = prove(broken);
  faults.aGuaranteeTheRulesBreak = { refused: r.refused, accepted: r.accepted, of: r.guarantees };
}
report.faults = faults;
report.residentFacts = resident.size; report.heapMB = MB();
console.log(JSON.stringify(report, null, 1));
