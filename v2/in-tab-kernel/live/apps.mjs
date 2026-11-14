// Writes proofs for sample apps with live/emit.mjs, with no Lean, into a folder: one suffix per app.
//   node live/apps.mjs <library.ndjson> <VerdantRegions.lean> <out dir>
// parking         the studio's parking-fee example: 3 rules, 1 guarantee
// parking-false   the same rules with a guarantee they break; the kernel must refuse it
// parking-edited  the rules changed so that the true guarantee breaks; the kernel must refuse it
// verdant         Verdant, 35 rules and 15 guarantees, read from the Lean file the gate writes from its fixture
// verdant-gNN     Verdant's guarantees one at a time, each a suffix whole in itself
import fs from "node:fs";
import path from "node:path";
import { readLibrary, proofOf, proofsOf, certifiedProofsOf } from "./emit.mjs";
import { certsOf } from "./certs.mjs";
import { appOf } from "./read-app.mjs";

const [libraryPath, verdantPath, out] = process.argv.slice(2);
const text = fs.readFileSync(libraryPath, "utf8");
let t = performance.now();
const library = readLibrary(text);
const readMs = performance.now() - t;

const parking = {
  name: "ParkingTab", bounds: [[0, 24], [0, 2]], otherwise: 1,
  rules: [{ when: [[0, 4, 0]], outcome: 0 }, { when: [[1, 4, 2]], outcome: 2 }, { when: [[0, 2, 12]], outcome: 2 }],
  properties: [{ always: false, when: [[0, 4, 0]], outcome: 2 }],          // never premium when hours = 0
};
const apps = {
  parking,
  "parking-false": { ...parking, name: "ParkingFalse", properties: [{ always: false, when: [[1, 4, 2]], outcome: 2 }] },   // never premium for a truck: false
  "parking-edited": { ...parking, name: "ParkingEdited", rules: [{ when: [[1, 4, 2]], outcome: 2 }, ...parking.rules.filter((r) => r.outcome !== 2 || r.when[0][0] !== 1)] },   // the truck rule first: a truck at 0 hours is premium
  verdant: appOf(fs.readFileSync(verdantPath, "utf8"), "VerdantTab"),
};

fs.mkdirSync(out, { recursive: true });
const report = { readLibraryMs: Math.round(readMs), apps: {} };
for (const [name, app] of Object.entries(apps)) {
  t = performance.now();
  const suffix = proofOf(text, app, library);
  const ms = performance.now() - t;
  fs.writeFileSync(path.join(out, name + ".ndjson"), suffix);
  report.apps[name] = { rules: app.rules.length, guarantees: app.properties.length, bytes: suffix.length, writeMs: Math.round(ms * 10) / 10 };
}
// Verdant again, one suffix per guarantee.
t = performance.now();
const parts = proofsOf(text, { ...apps.verdant, name: "VerdantParts" }, library);
report.verdantPerGuarantee = { suffixes: parts.length, writeMs: Math.round((performance.now() - t) * 10) / 10, bytes: [Math.min(...parts.map((x) => x.length)), Math.max(...parts.map((x) => x.length))] };
parts.forEach((suffix, i) => fs.writeFileSync(path.join(out, `verdant-g${String(i).padStart(2, "0")}.ndjson`), suffix));
// Verdant once more, one suffix per guarantee, through the certified check.
if (library.nameIndex.has("PrismLive.Kernel.certCheck_sound")) {
  const verdantC = { ...apps.verdant, name: "VerdantCert" };
  t = performance.now();
  const certs = certsOf(verdantC), proofs = certifiedProofsOf(text, verdantC, certs, library);
  report.verdantCertified = { suffixes: proofs.length, writeMs: Math.round((performance.now() - t) * 10) / 10, bytes: [Math.min(...proofs.map((x) => x.length)), Math.max(...proofs.map((x) => x.length))], named: certs.reduce((n, c) => n + c.rules.reduce((k, x) => k + x.sel.length, 0) + c.other.sel.length, 0) };
  proofs.forEach((suffix, i) => fs.writeFileSync(path.join(out, "verdant-c" + String(i).padStart(2, "0") + ".ndjson"), suffix));
  // Faults: a name the proof needs is left out; and a guarantee the rules break, with honest names.
  const first = certs.findIndex((c) => c.rules.some((x) => x.sel.length));
  const dropped = certs.map((c, i) => (i !== first ? c : { ...c, rules: c.rules.map((x, k) => (k === c.rules.findIndex((y) => y.sel.length) ? { ...x, sel: x.sel.slice(1) } : x)) }));
  fs.writeFileSync(path.join(out, "verdant-c-dropped.ndjson"), certifiedProofsOf(text, { ...verdantC, name: "VerdantDropped" }, dropped, library)[first]);
  const falseApp = { ...apps["parking-false"], name: "ParkingCertFalse" };
  fs.writeFileSync(path.join(out, "parking-c-false.ndjson"), certifiedProofsOf(text, falseApp, certsOf(falseApp), library)[0]);
  const trueApp = { ...parking, name: "ParkingCert" };
  fs.writeFileSync(path.join(out, "parking-c.ndjson"), certifiedProofsOf(text, trueApp, certsOf(trueApp), library)[0]);
}
console.log(JSON.stringify(report, null, 1));
