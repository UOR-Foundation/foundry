// Zones, as live/Tab.lean defines them, on numbers: every function here is the Lean definition of the same name,
// step for step, so the tab knows what the kernel will compute before it asks. Bounds are BigInt: a number field
// with no maximum reaches 10^18 - 1, the largest a request can carry.
//
//   zone  [box, diffs]   box: [[lo, hi], ...] of BigInt; diffs: [{ a, k, b, j }] meaning x_a + k <= x_b + j
//   cond  [field, op, value, other]   op 0 <, 1 <=, 2 >, 3 >=, 4 =, 5 and above !=; `other`: value is a field
//
//   tabLinksOf(app) -> { zones: [Qs per rule], rules: [key per rule], facts: Map(key -> fact),
//                        guarantees: [{ ws, prop, safes: [{ steps: [step per rule, then one for otherwise] } per w] }] }
//   fact  { key, kind: "zones", B, cs, Qs } | { key, kind: "notbad", always, outcome, o }
//         | { key, kind: "covers", q, w, bs }
//   step  { qs: [{ how: "ok", fact } | { how: "cover", fact, sel: [[rule, zone], ...] } per zone of the rule] }
import { sha256Hex } from "./certs.mjs";

const big = (n) => BigInt(n);
const max = (a, b) => (a > b ? a : b), min = (a, b) => (a < b ? a : b);

/** A key for data that holds BigInt. */
export const keyOf = (...data) => sha256Hex(JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

// ---- Regions.lean: boxes
export const nonEmpty = (B) => B.every(([l, h]) => l <= h);
export function meet(A, B) { const out = []; for (let i = 0; i < Math.min(A.length, B.length); i++) out.push([max(A[i][0], B[i][0]), min(A[i][1], B[i][1])]); return out; }
export function sub(A, B) {
  if (!A.length) return B.length ? [[]] : [];
  if (!B.length) return [A];
  const [[al, ah], ...as] = A, [[bl, bh], ...bs] = B;
  if (ah < bl || bh < al) return [A];
  return [...(al < bl ? [[[al, bl - 1n], ...as]] : []), ...(bh < ah ? [[[bh + 1n, ah], ...as]] : []), ...sub(as, bs).map((p) => [[max(al, bl), min(ah, bh)], ...p])];
}
const setLo = (B, f, lo) => B.map((b, i) => (i === f ? [max(b[0], lo), b[1]] : b));
const setHi = (B, f, hi) => B.map((b, i) => (i === f ? [b[0], min(b[1], hi)] : b));
// PrismLive.Kernel's condBox, op < 5.
function condBox(B, f, op, v) {
  if (op === 0) return v === 0n ? setHi(setLo(B, f, 1n), f, 0n) : setHi(B, f, v - 1n);
  if (op === 1) return setHi(B, f, v);
  if (op === 2) return setLo(B, f, v + 1n);
  if (op === 3) return setLo(B, f, v);
  if (op === 4) return setHi(setLo(B, f, v), f, v);
  return B;
}

// ---- Tab.lean: zones
const negDiff = (e) => ({ a: e.b, k: e.j + 1, b: e.a, j: e.k });
function addEdge(es, e) {
  for (let i = 0; i < es.length; i++) if (es[i].u === e.u && es[i].v === e.v) return [...es.slice(0, i), es[i].w < e.w ? e : es[i], ...es.slice(i + 1)];
  return [...es, e];
}
function throughNode(es, c) {
  const ins = es.filter((e) => e.v === c), out = es.filter((e) => e.u === c);
  return ins.reduce((acc, e1) => out.reduce((acc2, e2) => addEdge(acc2, { u: e1.u, v: e2.v, w: e1.w + e2.w }), acc), es);
}
const boundEdges = (B, f) => (f < B.length ? [{ u: 0, v: f + 1, w: B[f][0] }, { u: f + 1, v: 0, w: -B[f][1] }] : []);
const edgesOf = ([B, ds]) => ds.flatMap((e) => [{ u: e.a + 1, v: e.b + 1, w: big(e.k) - big(e.j) }, ...boundEdges(B, e.a), ...boundEdges(B, e.b)]);
const nodesOf = ([, ds]) => [0, ...ds.flatMap((e) => [e.a + 1, e.b + 1])];
export const zEmpty = (z) => !nonEmpty(z[0]) || nodesOf(z).reduce(throughNode, edgesOf(z)).some((e) => e.u === e.v && 0n < e.w);
export const meetZ = (q, w) => [meet(q[0], w[0]), [...q[1], ...w[1]]];
function diffPieces(m, ds, held, es) {
  const out = [];
  for (let i = 0; i < es.length; i++) out.push([m, [negDiff(es[i]), ...held, ...es.slice(0, i), ...ds]]);
  return out;
}
export const subZ = (a, b) => [...sub(a[0], b[0]).map((p) => [p, a[1]]), ...diffPieces(meet(a[0], b[0]), a[1], [], b[1])].filter((z) => !zEmpty(z));
export function subAllZ(a, bs) {
  if (!bs.length) return zEmpty(a) ? [] : [a];
  return subAllZ(a, bs.slice(1)).flatMap((p) => subZ(p, bs[0]));
}
function condZones([B, ds], [f, op, v, other]) {
  if (other) {
    const a = f, b = v;
    if (op === 0) return [[B, [{ a, k: 1, b, j: 0 }, ...ds]]];
    if (op === 1) return [[B, [{ a, k: 0, b, j: 0 }, ...ds]]];
    if (op === 2) return [[B, [{ a: b, k: 1, b: a, j: 0 }, ...ds]]];
    if (op === 3) return [[B, [{ a: b, k: 0, b: a, j: 0 }, ...ds]]];
    if (op === 4) return [[B, [{ a, k: 0, b, j: 0 }, { a: b, k: 0, b: a, j: 0 }, ...ds]]];
    return [[B, [{ a, k: 1, b, j: 0 }, ...ds]], [B, [{ a: b, k: 1, b: a, j: 0 }, ...ds]]];
  }
  const value = big(v);
  if (op < 5) return [[condBox(B, f, op, value), ds]];
  return [...(value === 0n ? [] : [[setHi(B, f, value - 1n), ds]]), [setLo(B, f, value + 1n), ds]];
}
export const zonesOf = (B, cs) => cs.reduce((zs, c) => zs.flatMap((z) => condZones(z, c)), [[B, []]]);
export const condsOk = (n, cs) => cs.every(([f, , v, other]) => f < n && (!other || v < n));

// The diffs `diffPieces` above holds before the failing one are Lean's `held ++ [e]` at each step: the first i of es.
// (Lean builds `negDiff e :: held ++ ds` with held growing; this is the same list, written at once.)

/** What the proof of each guarantee of `app` is assembled from. app.bounds may hold numbers or BigInt. */
export function tabLinksOf(app) {
  const B = app.bounds.map(([l, h]) => [big(l), big(h)]), facts = new Map();
  const fact = (kind, data, ...address) => { const key = keyOf(kind, ...address); if (!facts.has(key)) facts.set(key, { key, kind, ...data }); return key; };
  const zonesFact = (cs) => { const Qs = zonesOf(B, cs); return { Qs, key: fact("zones", { B, cs, Qs }, B, cs) }; };
  const rules = app.rules.map((r) => zonesFact(r.when));
  const guarantees = app.properties.map((p) => {
    const bad = (o) => (p.always ? o !== p.outcome : o === p.outcome);
    const { Qs: ws, key: prop } = zonesFact(p.when);
    const safes = ws.map((w) => {
      // What answers "a request of w in zone q of rule n, in no zone of an earlier rule, is never answered o".
      const step = (qs, n, o) => qs.map((q) => {
        if (!bad(o)) return { how: "ok", fact: fact("notbad", { always: p.always, outcome: p.outcome, o }, p.always, p.outcome, o) };
        const m = meetZ(q, w), sel = [];
        for (let j = 0; j < n; j++) rules[j].Qs.forEach((z, k) => { if (!zEmpty(meetZ(m, z))) sel.push([j, k]); });
        const bs = sel.map(([j, k]) => rules[j].Qs[k]);
        return { how: "cover", sel, fact: fact("covers", { q, w, bs }, q, w, bs) };
      });
      return { steps: [...app.rules.map((r, i) => step(rules[i].Qs, i, r.outcome)), step([[B, []]], app.rules.length, app.otherwise)] };
    });
    return { ws, prop, safes };
  });
  return { B, zones: rules.map((r) => r.Qs), rules: rules.map((r) => r.key), facts, guarantees };
}
