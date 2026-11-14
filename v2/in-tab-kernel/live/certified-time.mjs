// Writes a Lean file that has Lean's kernel judge Verdant one guarantee at a time with live/Certified.lean's check,
// to time it beside the check as it is. A measurement: the file is not part of any proof used elsewhere.
//   node live/certified-time.mjs <VerdantRegions.lean> <out.lean>
import fs from "node:fs";
import { certsOf } from "./certs.mjs";
import { appOf } from "./read-app.mjs";

const [leanPath, out] = process.argv.slice(2);
const lean = fs.readFileSync(leanPath, "utf8");
const app = appOf(lean, "VerdantR");
const certs = certsOf(app);
const cert = (c) => `([${c.sel.join(", ")}], none)`;
const cond = ([f, o, v]) => `⟨${f}, ${o}, ${v}⟩`;
fs.writeFileSync(out, `import PrismLive.VerdantRegions
import PrismLive.Certified
open PrismLive.Kernel VerdantR

${app.properties.map((p, i) => `theorem g${i} : certCheck B rules [] d ⟨${p.always}, [${p.when.map(cond).join(", ")}], ${p.outcome}⟩
    [${certs[i].rules.map(cert).join(", ")}] ${cert(certs[i].other)} = true := by decide +kernel`).join("\n\n")}

#print axioms PrismLive.Kernel.certCheck_sound
`);
console.log(JSON.stringify({ guarantees: certs.length, facts: certs.reduce((n, c) => n + c.facts.length, 0), named: certs.reduce((n, c) => n + c.rules.reduce((k, s) => k + s.sel.length, 0) + c.other.sel.length, 0) }));
