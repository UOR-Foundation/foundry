// Proves apps through live/Tab.lean with one WebAssembly kernel under Node, as a tab does, and plants faults.
//   node live/tab-run.mjs <built dist dir> <library.ndjson> <VerdantRegions.lean>
// Verdant (boxes only): first, again, after edits. RSVP (a comparison of two fields), parking with `is not`, and a
// spec with a number that has no maximum. Every result is printed as one JSON report.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { prover } from "./prove.mjs";
import { tabProof } from "./emit.mjs";
import { tabLinksOf, keyOf, zEmpty, meetZ, subAllZ } from "./zones.mjs";
import { appOf } from "./read-app.mjs";

const [dist, libraryPath, verdantPath] = process.argv.slice(2);
const factory = (await import(pathToFileURL(path.resolve(dist, "lean-kernel.mjs")).href)).default;
const wasmBinary = fs.readFileSync(path.resolve(dist, "lean-kernel.wasm"));
const libraryBytes = fs.readFileSync(libraryPath);
const lines = [];
const m = await factory({ instantiateWasm: (imports, done) => { WebAssembly.instantiate(wasmBinary, imports).then((r) => done(r.instance, r.module)); return {}; }, print: (s) => lines.push(s), printErr: (s) => lines.push(s) });
if (m.ccall("checker_ready", "number", [], []) !== 0) throw new Error("not ready");
const call = (entry, text) => {
  lines.length = 0; m.FS.writeFile("/in.ndjson", text);
  const t = performance.now(); let exit;
  try { exit = m.ccall(entry, "number", ["string"], ["/in.ndjson"]); } catch (e) { exit = 3; lines.push("trap: " + e.message); }
  const ms = performance.now() - t; m.FS.unlink("/in.ndjson");
  const axioms = {};
  for (const line of lines) { const x = /^axioms ([^:]+): ?(.*)$/.exec(line); if (x) axioms[x[1]] = x[2] ? x[2].split(", ") : []; }
  return { exit, ms, axioms: exit === 0 ? axioms : {}, output: lines[lines.length - 1] ?? "" };
};
if (call("load_library", libraryBytes).exit !== 0) throw new Error("the library was not admitted");
const { prove: proveApp, keep, library } = prover(call, libraryBytes.toString("utf8"));
const MB = () => Math.round(m.HEAPU8.length / 1048576);
const brief = (r) => ({ accepted: r.accepted, of: r.guarantees.length, refused: r.refused, why: r.refused.map((i) => r.guarantees[i]?.why).filter(Boolean)[0], facts: r.facts, factsNew: r.factsNew, newByKind: r.newByKind, factMs: r.factMs, glueMs: r.glueMs, writeMs: r.writeMs, totalMs: r.totalMs, axioms: [...new Set(r.guarantees.filter((g) => g.accepted).map((g) => JSON.stringify(g.axioms)))], heapMB: MB() });
const prove = (app, links) => brief(proveApp(app, links));

const BIG = 999999999999999999n;
const report = {};
const verdant = appOf(fs.readFileSync(verdantPath, "utf8"), "VerdantTab");
report.verdant = { first: prove(verdant), again: prove(verdant), edits: [] };
// The rules as data, judged for one request: to confirm a refusal with a request that breaks the guarantee.
const holds = ([f, op, v, other], x) => { const a = x[f], b = other ? x[v] : BigInt(v); return op === 0 ? a < b : op === 1 ? a <= b : op === 2 ? a > b : op === 3 ? a >= b : op === 4 ? a === b : a !== b; };
const judge = (app, x) => { for (const r of app.rules) if (r.when.every((c) => holds(c, x))) return r.outcome; return app.otherwise; };
// A request the kernel's refusal stands on: a piece of a covering the rules do not cover, its lowest corner.
function witness(app, i) {
  const l = tabLinksOf(app), p = app.properties[i];
  for (const s of l.guarantees[i].safes) for (const st of s.steps) for (const x of st) if (x.how === "cover") {
    const f = l.facts.get(x.fact), left = subAllZ(meetZ(f.q, f.w), f.bs);
    if (!left.length) continue;
    // The corner of the box may break a constraint; search the piece's box, smallest first, for a request in it.
    const [b, ds] = left[0], pick = b.map(([lo]) => lo);
    const inside = (y) => ds.every((e) => y[e.a] + BigInt(e.k) <= y[e.b] + BigInt(e.j));
    if (!inside(pick)) continue;
    const o = judge(app, pick), breaks = p.when.every((c) => holds(c, pick)) && (p.always ? o !== p.outcome : o === p.outcome);
    return { request: pick.map(String), answers: o, breaks };
  }
  return null;
}
for (let ri = verdant.rules.length - 1, n = 0; ri >= 0 && n < 5; ri--) {
  const rule = verdant.rules[ri];
  if (!rule.when.length) continue;
  const when = rule.when.map((c, k) => (k === 0 ? [c[0], c[1], c[2] + 1] : c));
  const edited = { ...verdant, rules: verdant.rules.map((x, k) => (k === ri ? { ...x, when } : x)) };
  const r = prove(edited);
  report.verdant.edits.push({ rule: ri, ...r, witness: r.refused.length ? witness({ ...edited, bounds: edited.bounds.map(([l, h]) => [BigInt(l), BigInt(h)]) }, r.refused[0]) : undefined }); n++;
}
// RSVP (studio/tools/fixtures/live/rsvp.json): attending, party 0..6, seats 0..500; party > seats is a comparison.
const rsvp = { name: "Rsvp", bounds: [[0, 2], [0, 6], [0, 500]], otherwise: 0, // confirmed
  rules: [{ when: [[0, 4, 1, false]], outcome: 1 }, { when: [[1, 4, 0, false]], outcome: 1 }, { when: [[1, 2, 2, true]], outcome: 2 }],
  properties: [{ always: false, when: [[0, 4, 1, false]], outcome: 0 }, { always: false, when: [[1, 2, 2, true]], outcome: 0 }] };
report.rsvp = { proved: prove(rsvp) };
report.rsvp.broken = prove({ ...rsvp, name: "RsvpBroken", rules: rsvp.rules.slice(0, 2) });
// The same with seats unbounded: no maximum, so the bound is the largest number a request can carry.
report.rsvpUnbounded = prove({ ...rsvp, name: "RsvpBig", bounds: [[0n, 2n], [0n, 6n], [0n, BIG]] });
report.rsvpBothUnbounded = prove({ ...rsvp, name: "RsvpBig2", bounds: [[0n, 2n], [0n, BIG], [0n, BIG]] });
// Parking with `is not` in a rule and in a guarantee.
const parking = { name: "ParkNot", bounds: [[0, 24], [0, 2]], otherwise: 1,
  rules: [{ when: [[0, 4, 0, false]], outcome: 0 }, { when: [[1, 5, 0, false], [0, 2, 12, false]], outcome: 2 }, { when: [[1, 4, 0, false]], outcome: 1 }],
  properties: [{ always: false, when: [[0, 4, 0, false]], outcome: 2 }, { always: true, when: [[0, 2, 12, false], [1, 5, 0, false]], outcome: 2 }, { always: false, when: [[1, 4, 0, false]], outcome: 2 }] };
report.parkingNot = { proved: prove(parking) };
report.parkingNot.broken = prove({ ...parking, name: "ParkNotBroken", properties: [{ always: true, when: [[0, 2, 12, false]], outcome: 2 }] });
// Two fields compared by `!=` and by `=`.
const pair = { name: "Pair", bounds: [[0, 9], [0, 9]], otherwise: 0,
  rules: [{ when: [[0, 5, 1, true]], outcome: 1 }],
  properties: [{ always: true, when: [[0, 4, 1, true]], outcome: 0 }, { always: false, when: [[0, 2, 1, true]], outcome: 0 }] };
report.pair = prove(pair);
// Faults.
const faults = {}, links = tabLinksOf(rsvp);
{ // A covering that is false: a region with requests in it, said to be covered by nothing. (Leaving out one of the
  // zones a covering names may leave it true: every earlier zone that touches the region is named, needed or not.)
  const f = [...links.facts.values()].find((x) => x.kind === "covers" && x.bs.length);
  const lie = { key: keyOf("covers", f.q, f.w, []), kind: "covers", q: f.q, w: f.w, bs: [] };
  const tally = { factsNew: 0, factsReused: 0, newByKind: {}, factMs: 0, writeMs: 0 };
  faults.aCoveringThatIsFalse = { regionHasRequests: !zEmpty(meetZ(f.q, f.w)), kept: keep([lie], tally), said: tally.said };
}
{ // Zones that are not a rule's: the comparison's constraint dropped.
  const f = [...links.facts.values()].find((x) => x.kind === "zones" && x.Qs.some((q) => q[1].length));
  const Qs = f.Qs.map(([b]) => [b, []]), lie = { key: keyOf("zones-lie", f.B, f.cs), kind: "zones", B: f.B, cs: f.cs, Qs };
  const tally = { factsNew: 0, factsReused: 0, newByKind: {}, factMs: 0, writeMs: 0 };
  faults.zonesThatAreNotTheRules = { kept: keep([lie], tally), said: tally.said };
}
{ // A step answered by the wrong zone list: a proof naming another rule's zones fact.
  const wrong = { ...links, rules: [links.rules[1], ...links.rules.slice(1)] };
  let v; try { v = call("check_suffix", tabProof(library, { ...rsvp, name: "FaultZones" }, 1, wrong)); } catch (e) { v = { exit: "not written", output: e.message }; }
  faults.anotherRulesZones = { exit: v.exit, said: v.output };
}
report.faults = faults;
report.heapMB = MB();
console.log(JSON.stringify(report, null, 1));
