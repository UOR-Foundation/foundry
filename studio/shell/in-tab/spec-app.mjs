// A validated Prism spec as the data the in-tab prover takes (prove.mjs), and the address of what it then states.
//
// The prover speaks of boxes: every field a range of whole numbers, every rule a box. A spec outside that is not
// proved here, and the caller asks the hosted verifier instead:
//   a condition that compares two fields is not a box;
//   a rule that says `is not` or `!=` is not a box (a guarantee may: its conditions are only ever over-covered).
//
//   appOfSpec(spec) -> { ok: true, app } | { ok: false, why }
//   app = { name, bounds: [[lo, hi]], rules: [{ when: [[field, op, value]], outcome }], otherwise,
//           properties: [{ always, when, outcome }] }
// The encoding is PrismLive.Kernel's: operators 0 <, 1 <=, 2 >, 3 >=, 4 =, 5 !=; a choice is its position among
// the field's values; an outcome is its position among the spec's outcomes; a request is one number per field.
import { sha256Hex } from "./certs.mjs";

const OP = { "<": 0, "<=": 1, ">": 2, ">=": 3, is: 4, "=": 4, "is not": 5, "!=": 5 };
const whole = (n) => Number.isSafeInteger(n) && n >= 0;

export function appOfSpec(spec) {
  const no = (why) => ({ ok: false, why });
  try {
    const bounds = [];
    for (const f of spec.fields) {
      if (f.kind === "choice") bounds.push([0, f.values.length - 1]);
      else if (f.kind === "number") { const lo = f.min ?? 0; if (!whole(lo) || !whole(f.max) || lo > f.max) return no(`the field ${f.name} is not a range of whole numbers`); bounds.push([lo, f.max]); }
      else return no(`the field ${f.name} is neither a number nor a choice`);
    }
    const conds = (when, strict, where) => when.map((c) => {
      const i = spec.fields.findIndex((f) => f.name === c.field), f = spec.fields[i], op = OP[c.op];
      if (!f || op === undefined) throw new Error(`${where} has a condition this prover cannot read`);
      if (c.value !== null && typeof c.value === "object") throw new Error(`${where} compares two fields`);
      if (strict && op === 5) throw new Error(`${where} says \`${c.op}\``);
      const value = f.kind === "choice" ? f.values.indexOf(c.value) : c.value;
      if (!whole(value)) throw new Error(`${where} names a value this prover cannot read`);
      return [i, op, value];
    });
    const outcome = (word, where) => { const o = spec.outcomes.indexOf(word); if (o < 0) throw new Error(`${where} answers a word that is not an outcome`); return o; };
    return { ok: true, app: {
      name: "Tab", bounds,
      rules: spec.rules.map((r, k) => ({ when: conds(r.when, true, "rule " + (r.id ?? k + 1)), outcome: outcome(r.then, "rule " + (r.id ?? k + 1)) })),
      otherwise: outcome(spec.otherwise, "otherwise"),
      properties: spec.properties.map((p, k) => ({ always: p.kind === "always", when: conds(p.when, false, "guarantee " + (p.id ?? k + 1)), outcome: outcome(p.then, "guarantee " + (p.id ?? k + 1)) })),
    } };
  } catch (e) { return no(String((e && e.message) || e)); }
}

/**
 * The address of what a proof of `app` states: for every guarantee, that no request in the bounds is answered
 * against it by these rules and this `otherwise`. The page derives it from the spec; the worker derives it again
 * from the data it wrote the statements from; the kernel guest compares the two.
 */
export const statementAddress = (app) => "sha256:" + sha256Hex(JSON.stringify(["prism/in-tab-statement/1", app.bounds, app.rules.map((r) => [r.when, r.outcome]), app.otherwise, app.properties.map((p) => [p.always, p.when, p.outcome])]));
