// Proves an app through facts that stay resident, then proves it again, then after an edit, and plants faults.
// WebAssembly kernel under Node; one kernel for the whole run, as a tab has.
//   node live/reuse.mjs <built dist dir> <library.ndjson> <VerdantRegions.lean>
// Each obligation is a theorem named by the address of its meaning, judged once and kept (check_keep). A guarantee's
// proof points at the facts (check_suffix) and is not kept: it is judged again whenever it is asked for.
// What this measures: the subtracting is not where a guarantee's time goes. live/linked.mjs is what followed.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readLibrary, extendLibrary, factProof, reusedProof } from "./emit.mjs";
import { certsOf } from "./certs.mjs";
import { appOf } from "./read-app.mjs";

const [dist, libraryPath, verdantPath] = process.argv.slice(2);
const factory = (await import(pathToFileURL(path.resolve(dist, "lean-kernel.mjs")).href)).default;
const wasmBinary = fs.readFileSync(path.resolve(dist, "lean-kernel.wasm"));
const libraryBytes = fs.readFileSync(libraryPath);
const lines = [];
const m = await factory({ instantiateWasm: (imports, done) => { WebAssembly.instantiate(wasmBinary, imports).then((r) => done(r.instance, r.module)); return {}; }, print: (s) => lines.push(s), printErr: (s) => lines.push(s) });
if (m.ccall("checker_ready", "number", [], []) !== 0) throw new Error("not ready");
const call = (entry, text) => { lines.length = 0; m.FS.writeFile("/in.ndjson", text); const t = performance.now(); let exit; try { exit = m.ccall(entry, "number", ["string"], ["/in.ndjson"]); } catch (e) { exit = 3; lines.push("trap: " + e.message); } const ms = performance.now() - t; m.FS.unlink("/in.ndjson"); return { exit, ms, said: lines[lines.length - 1] }; };
const MB = () => Math.round(m.HEAPU8.length / 1048576);
const round = (x) => Math.round(x * 10) / 10;

if (call("load_library", libraryBytes).exit !== 0) throw new Error("the library was not admitted");
const library = readLibrary(libraryBytes.toString("utf8"));
const resident = new Set();   // the addresses of the facts the kernel holds

// One pass over an app: the facts not yet resident are judged and kept, then each guarantee is judged from them.
function prove(app) {
  let t = performance.now();
  const certs = certsOf(app);
  const r = { guarantees: certs.length, obligations: certs.reduce((n, c) => n + c.rules.filter((x) => x.memo !== null).length + (c.other.memo !== null ? 1 : 0), 0), factsNew: 0, factsReused: 0, factMs: 0, proofMs: 0, proofMsEach: [], accepted: 0, refused: [], writeMs: 0 };
  r.writeMs += performance.now() - t;
  certs.forEach((cert, i) => {
    let ok = true;
    for (const f of cert.facts) {
      if (resident.has(f.key)) { r.factsReused++; continue; }
      t = performance.now(); const text = factProof(library, f); r.writeMs += performance.now() - t;
      const v = call("check_keep", text); r.factMs += v.ms;
      if (v.exit !== 0) { ok = false; break; }           // a fact the kernel refuses is never resident
      extendLibrary(library, text); resident.add(f.key); r.factsNew++;
    }
    if (!ok) { r.refused.push(i); r.proofMsEach.push(null); return; }
    t = performance.now(); const text = reusedProof(library, app, i, cert); r.writeMs += performance.now() - t;
    const v = call("check_suffix", text); r.proofMs += v.ms; r.proofMsEach.push(round(v.ms));
    if (v.exit === 0) r.accepted++; else r.refused.push(i);
  });
  r.totalMs = round(r.factMs + r.proofMs + r.writeMs); r.factMs = round(r.factMs); r.proofMs = round(r.proofMs); r.writeMs = round(r.writeMs); r.heapMB = MB();
  return r;
}

const verdant = appOf(fs.readFileSync(verdantPath, "utf8"), "VerdantReuse");
const report = { first: prove(verdant), again: prove(verdant) };

// An edit: one number in one rule moved by one. The first such edit that leaves every guarantee true is reported,
// with how many it took; an edit that breaks a guarantee must be refused, and is counted.
report.edits = [];
let tried = 0, breaking = 0;
for (let ri = verdant.rules.length - 1; ri >= 0 && report.edits.length < 3; ri--) {
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

// Faults. None may be accepted.
const certs = certsOf(verdant), gi = certs.findIndex((c) => c.facts.length >= 2), cert = certs[gi];
const faults = {};
{ // A fact that is false: the last box that covers the region is left out.
  const f = certs.flatMap((c) => c.facts).find((x) => x.boxes.length >= 1);
  const lie = { ...f, key: "f".repeat(64), boxes: f.boxes.slice(0, -1) };
  const v = call("check_keep", factProof(library, lie));
  faults.aFactThatIsFalse = { exit: v.exit, said: v.said };
}
{ // A pointer at a different fact: two obligations of one guarantee swap what they point at.
  const idx = cert.rules.map((x, k) => (x.memo !== null ? k : -1)).filter((k) => k >= 0);
  let swapped = null;
  for (const a of idx) for (const b of idx) if (!swapped && cert.rules[a].memo !== cert.rules[b].memo) swapped = { ...cert, rules: cert.rules.map((x, k) => (k === a ? { ...x, memo: cert.rules[b].memo } : k === b ? { ...x, memo: cert.rules[a].memo } : x)) };
  if (!swapped) { const a = idx[0]; swapped = { ...cert, rules: cert.rules.map((x, k) => (k === a ? { ...x, memo: cert.other.memo } : x)) }; }
  const v = call("check_suffix", reusedProof(library, { ...verdant, name: "FaultPointer" }, gi, swapped));
  faults.aPointerAtAnotherFact = { exit: v.exit, said: v.said };
}
{ // A fact the kernel never judged: the proof names a theorem that is not there.
  const ghost = { ...cert, facts: cert.facts.map((f, k) => (k === 0 ? { ...f, key: "0".repeat(64) } : f)) };
  let v; try { reusedProof(library, { ...verdant, name: "FaultGhost" }, gi, ghost); v = "written"; } catch (e) { v = e.message; }
  faults.aFactNeverJudged = v;
}
{ // A guarantee the rules break, with honest names: its facts cannot all be proved.
  const broken = { ...verdant, name: "FaultBroken", properties: verdant.properties.map((p, k) => (k === 0 ? { ...p, always: !p.always } : p)) };
  const r = prove(broken);
  faults.aGuaranteeTheRulesBreak = { refused: r.refused.includes(0), accepted: r.accepted, of: r.guarantees };
}
report.faults = faults;
report.residentFacts = resident.size; report.heapMB = MB();
console.log(JSON.stringify(report, null, 1));
