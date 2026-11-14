// What an app's proof names for the kernel: for each guarantee and each rule, the earlier rules whose boxes touch
// the region to cover. The kernel trusts none of it (live/Certified.lean); a wrong or missing name makes the check
// fail, never pass.
//
//   certsOf(app) -> per guarantee { rules: [{ sel, memo } per rule], other: { sel, memo }, facts: [{ key, region, boxes }] }
// sel is the earlier rules to subtract; memo is the place in `facts` of the obligation's own fact, or null when
// there is nothing to cover. A fact is the obligation by meaning: the same region and boxes give the same key,
// whichever app, guarantee or edit they come from.
// app is live/emit.mjs's: { bounds, rules: [{ when, outcome }], otherwise, properties: [{ always, when, outcome }] }
// SHA-256 of a string, at once: the same in a worker and under Node, where the platform's own is asynchronous.
const KS = new Uint32Array(64);
{ let n = 2, i = 0; while (i < 64) { let prime = true; for (let k = 2; k * k <= n; k++) if (n % k === 0) { prime = false; break; } if (prime) KS[i++] = (Math.cbrt(n) % 1) * 4294967296; n++; } }
const encoder = new TextEncoder();
export function sha256Hex(string) {
  const bytes = encoder.encode(string), bits = bytes.length * 8, padded = new Uint8Array(((bytes.length + 8) >> 6 << 6) + 64);
  padded.set(bytes); padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer); view.setUint32(padded.length - 8, Math.floor(bits / 4294967296)); view.setUint32(padded.length - 4, bits >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), w = new Uint32Array(64);
  const rot = (x, n) => (x >>> n) | (x << (32 - n));
  for (let at = 0; at < padded.length; at += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(at + i * 4);
    for (let i = 16; i < 64; i++) w[i] = (w[i - 16] + (rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3)) + w[i - 7] + (rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10))) | 0;
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + KS[i] + w[i]) | 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += k;
  }
  return [...h].map((x) => x.toString(16).padStart(8, "0")).join("");
}

// PrismLive.Kernel's boxOf, meet and nonEmpty, on numbers. `!=` does not narrow.
export function boxOf(bounds, when) {
  const b = bounds.map((x) => [...x]);
  for (const [f, op, v] of when) {
    if (op === 0) { if (v === 0) { b[f][0] = Math.max(b[f][0], 1); b[f][1] = Math.min(b[f][1], 0); } else b[f][1] = Math.min(b[f][1], v - 1); }
    else if (op === 1) b[f][1] = Math.min(b[f][1], v);
    else if (op === 2) b[f][0] = Math.max(b[f][0], v + 1);
    else if (op === 3) b[f][0] = Math.max(b[f][0], v);
    else if (op === 4) { b[f][0] = Math.max(b[f][0], v); b[f][1] = Math.min(b[f][1], v); }
  }
  return b;
}
export const meet = (a, b) => a.map(([l, h], i) => [Math.max(l, b[i][0]), Math.min(h, b[i][1])]);
export const nonEmpty = (b) => b.every(([l, h]) => l <= h);
/** The address of an obligation's meaning: its region, and the boxes subtracted from it, in order. */
export const factKey = (region, boxes) => sha256Hex(JSON.stringify([region, boxes]));

export function certsOf(app) {
  const ruleBoxes = app.rules.map((r) => boxOf(app.bounds, r.when));
  return app.properties.map((p) => {
    const W = boxOf(app.bounds, p.when), bad = (o) => (p.always ? o !== p.outcome : o === p.outcome), facts = [], at = new Map();
    const nothing = { sel: [], memo: null };
    const touching = (A, n) => {
      const M = meet(A, W);
      if (!nonEmpty(M)) return nothing;                  // nothing to cover: the kernel sees the region is empty
      const sel = []; for (let i = 0; i < n; i++) if (nonEmpty(meet(ruleBoxes[i], M))) sel.push(i);
      const boxes = sel.map((i) => ruleBoxes[i]), key = factKey(M, boxes);
      if (!at.has(key)) { at.set(key, facts.length); facts.push({ key, region: M, boxes }); }
      return { sel, memo: at.get(key) };
    };
    return {
      rules: app.rules.map((r, i) => (bad(r.outcome) ? touching(ruleBoxes[i], i) : nothing)),
      other: bad(app.otherwise) ? touching(app.bounds, app.rules.length) : nothing,
      facts,
    };
  });
}

/** The address of a fact: its kind and the plain data it states. */
export const linkKey = (kind, ...data) => sha256Hex(JSON.stringify([kind, ...data]));

/**
 * What live/Linked.lean's proof of an app is assembled from: every evaluation as a fact of its own, and for each
 * guarantee, which fact answers each rule. A fact states plain data and names neither the app nor the guarantee,
 * so the same fact serves every guarantee, app and edit that needs it.
 *
 *   linksOf(app) -> { boxes: [Q per rule], rules: [key per rule], facts: Map(key -> fact),
 *                     guarantees: [{ W, prop: key, steps: [step per rule, then one for `otherwise`] }] }
 *   fact  { key, kind: "rule" | "prop" | "notbad" | "apart" | "meets" | "covers", ...its data }
 *   step  { how: "ok", fact } | { how: "apart", fact } | { how: "cover", M, sel, meets, covers }
 */
export function linksOf(app) {
  const B = app.bounds, boxes = app.rules.map((r) => boxOf(B, r.when)), facts = new Map();
  const fact = (kind, data, ...address) => { const key = linkKey(kind, ...address); if (!facts.has(key)) facts.set(key, { key, kind, ...data }); return key; };
  const rules = app.rules.map((r, i) => fact("rule", { B, when: r.when, Q: boxes[i] }, B, r.when, boxes[i]));
  const guarantees = app.properties.map((p) => {
    const W = boxOf(B, p.when), prop = fact("prop", { B, when: p.when, W }, B, p.when, W);
    const bad = (o) => (p.always ? o !== p.outcome : o === p.outcome);
    // What answers "a request in Q, in none of the first n rules' boxes, is never answered o".
    const step = (Q, n, o) => {
      if (!bad(o)) return { how: "ok", fact: fact("notbad", { always: p.always, outcome: p.outcome, o }, p.always, p.outcome, o) };
      const M = meet(Q, W);
      if (!nonEmpty(M)) return { how: "apart", fact: fact("apart", { Q, W }, Q, W) };
      const sel = []; for (let i = 0; i < n; i++) if (nonEmpty(meet(boxes[i], M))) sel.push(i);
      const Bs = sel.map((i) => boxes[i]);
      return { how: "cover", M, sel, meets: fact("meets", { Q, W, M }, Q, W, M), covers: fact("covers", { M, Bs }, M, Bs) };
    };
    return { W, prop, steps: [...app.rules.map((r, i) => step(boxes[i], i, r.outcome)), step(B, app.rules.length, app.otherwise)] };
  });
  return { boxes, rules, facts, guarantees };
}
