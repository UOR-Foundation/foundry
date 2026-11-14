// A validated Prism spec as the data the in-tab prover takes (prove.mjs), and the address of what it then states.
//
// Every condition a spec can state is read (Tab.lean): a number or a choice compared with a value, `is not`, and a
// comparison of two fields. A number with no maximum is bounded by the largest a request can carry: a request is
// at most MAX_DIGITS decimal digits (prism/spec.mjs), so no request reaches beyond it.
//
//   appOfSpec(spec) -> { ok: true, app } | { ok: false, why }
//   app = { name, bounds: [[lo, hi]] (BigInt), rules: [{ when: [[field, op, value, other]], outcome }], otherwise,
//           properties: [{ always, when, outcome }] }
// Operators are PrismLive.Kernel's: 0 <, 1 <=, 2 >, 3 >=, 4 =, 5 !=. A choice is its position among the field's
// values; an outcome is its position among the spec's outcomes. With `other`, the value is the index of a field.
import { sha256Hex } from "./certs.mjs";

/** The largest number a request can carry: MAX_DIGITS (18) nines. */
export const LARGEST = 10n ** 18n - 1n;
const OP = { "<": 0, "<=": 1, ">": 2, ">=": 3, is: 4, "=": 4, "is not": 5, "!=": 5 };
const whole = (n) => Number.isSafeInteger(n) && n >= 0;

export function appOfSpec(spec) {
  const no = (why) => ({ ok: false, why });
  try {
    const bounds = [];
    for (const f of spec.fields) {
      if (f.kind === "choice") bounds.push([0n, BigInt(f.values.length - 1)]);
      else if (f.kind === "number") {
        const lo = f.min ?? 0, hi = f.max ?? null;
        if (!whole(lo) || (hi !== null && (!whole(hi) || lo > hi))) return no(`the field ${f.name} is not a range of whole numbers`);
        bounds.push([BigInt(lo), hi === null ? LARGEST : BigInt(hi)]);
      } else return no(`the field ${f.name} is neither a number nor a choice`);
    }
    const index = (name) => spec.fields.findIndex((f) => f.name === name);
    const conds = (when, where) => when.map((c) => {
      const i = index(c.field), f = spec.fields[i], op = OP[c.op];
      if (!f || op === undefined) throw new Error(`${where} has a condition this prover cannot read`);
      if (c.value !== null && typeof c.value === "object") {
        const j = index(c.value.field);
        if (j < 0 || spec.fields[j].kind !== "number" || f.kind !== "number") throw new Error(`${where} compares with a field this prover cannot read`);
        return [i, op, j, true];
      }
      const value = f.kind === "choice" ? f.values.indexOf(c.value) : c.value;
      if (!whole(value)) throw new Error(`${where} names a value this prover cannot read`);
      return [i, op, value, false];
    });
    const outcome = (word, where) => { const o = spec.outcomes.indexOf(word); if (o < 0) throw new Error(`${where} answers a word that is not an outcome`); return o; };
    return { ok: true, app: {
      name: "Tab", bounds,
      rules: spec.rules.map((r, k) => ({ when: conds(r.when, "rule " + (r.id ?? k + 1)), outcome: outcome(r.then, "rule " + (r.id ?? k + 1)) })),
      otherwise: outcome(spec.otherwise, "otherwise"),
      properties: spec.properties.map((p, k) => ({ always: p.kind === "always", when: conds(p.when, "guarantee " + (p.id ?? k + 1)), outcome: outcome(p.then, "guarantee " + (p.id ?? k + 1)) })),
    } };
  } catch (e) { return no(String((e && e.message) || e)); }
}

const exact = (data) => JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v));

/**
 * The address of what a proof of `app` states: for every guarantee, that no request in the bounds is answered
 * against it by these rules and this `otherwise`. The page derives it from the spec; the worker derives it again
 * from the data it wrote the statements from; the kernel guest compares the two.
 */
export const statementAddress = (app) => "sha256:" + sha256Hex(exact(["prism/in-tab-statement/2", app.bounds, app.rules.map((r) => [r.when, r.outcome]), app.otherwise, app.properties.map((p) => [p.always, p.when, p.outcome])]));
