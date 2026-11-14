// Writes an app's proofs as kernel terms, with no Lean and no proof search: suffixes of the proved checker's library
// (live/build.sh) that Lean's kernel then judges. What is written is data (rules, guarantees, bounds, and what the
// proof names) and a few fixed terms. If the data states a guarantee the rules break, the checker the kernel
// evaluates comes out `false`, and the kernel refuses the proof.
//
// Three ways to prove, each sound by a theorem in the library:
//   proofOf / proofsOf       through regionCheck_sound (studio/proof/PrismLive/Regions.lean): the kernel subtracts,
//                            at every rule, every earlier rule's box.
//   certifiedProofsOf        through certCheck_sound (live/Certified.lean): only the earlier rules the proof names.
//   factProof + reusedProof  through certCheck_sound with facts: each obligation is a theorem of its own, named by
//                            the address of its meaning and proved once; a guarantee's proof points at them.
//   linkFacts + linkedProof  through linked_sound (live/Linked.lean): every evaluation is a fact of its own, and a
//                            guarantee's proof applies lemmas to facts and has the kernel evaluate nothing.
//   tabFacts + tabProof      through tab_sound (live/Tab.lean): the same, for every rule a spec can state, as
//                            zones (live/zones.mjs).
//
// app = { name, bounds: [[lo, hi], ...], rules: [{ when: [[field, op, value], ...], outcome }], otherwise,
//         properties: [{ always, when: [[field, op, value], ...], outcome }] }
// Operators and encoding are PrismLive.Kernel's: 0 <, 1 <=, 2 >, 3 >=, 4 =, anything else !=; a request is a list of
// numbers in field order.

/** A resident file, read: its names and terms by index, and the next free index of each kind. */
export function readLibrary(text) {
  const lib = { names: [""], nameIndex: new Map([["", 0]]), exprs: [], exprIndex: new Map(), levels: new Map(), consts: new Map(), nextName: 1, nextExpr: 0, nextLevel: 1 };
  return extendLibrary(lib, text);
}
/** The same tables after a suffix the kernel accepted and kept: what the next suffix continues from. */
export function extendLibrary(lib, text) {
  for (const line of text.split("\n")) {
    if (!line) continue;
    const o = JSON.parse(line);
    if ("in" in o) {
      const full = "str" in o ? (lib.names[o.str.pre] ? lib.names[o.str.pre] + "." : "") + o.str.str : (lib.names[o.num.pre] ? lib.names[o.num.pre] + "." : "") + o.num.i;
      lib.names[o.in] = full; lib.nameIndex.set(full, o.in); lib.nextName = Math.max(lib.nextName, o.in + 1);
    } else if ("il" in o) {
      const { il, ...node } = o; lib.levels.set(JSON.stringify(node), il); lib.nextLevel = Math.max(lib.nextLevel, il + 1);
    } else if ("ie" in o) {
      const { ie, ...node } = o; lib.exprs[ie] = node; lib.exprIndex.set(JSON.stringify(node), ie); lib.nextExpr = Math.max(lib.nextExpr, ie + 1);
    } else if ("thm" in o || "def" in o) { const d = o.thm ?? o.def; lib.consts.set(d.name, d); }
  }
  return lib;
}

const K = "PrismLive.Kernel.";

/** One suffix being written over `lib`. Nothing here changes `lib`. */
export function writer(lib) {
  const out = [], exprs = [], exprIndex = new Map(), ownNames = new Map(), ownLevels = new Map(), nameOf = [];
  let nextName = lib.nextName, nextExpr = lib.nextExpr, nextLevel = lib.nextLevel;
  const nodeOf = (i) => lib.exprs[i] ?? exprs[i];
  // A term is written once: one the resident file already holds is named by its index there.
  const term = (node) => {
    const key = JSON.stringify(node);
    const have = lib.exprIndex.get(key) ?? exprIndex.get(key);
    if (have !== undefined) return have;
    const i = nextExpr++; exprs[i] = node; exprIndex.set(key, i); out.push(JSON.stringify({ ...node, ie: i }));
    return i;
  };
  const level = (node) => {
    const key = JSON.stringify(node);
    const have = lib.levels.get(key) ?? ownLevels.get(key);
    if (have !== undefined) return have;
    const i = nextLevel++; ownLevels.set(key, i); out.push(JSON.stringify({ il: i, ...node }));
    return i;
  };
  const known = (full) => { const i = lib.nameIndex.get(full); if (i === undefined) throw new Error("the resident file does not hold " + full); return i; };
  const has = (full) => lib.nameIndex.has(full) && lib.consts.has(lib.nameIndex.get(full));
  // A dotted name, part by part. A part the resident file already has is used; only what is new is written.
  const name = (full) => {
    let pre = 0, path = "";
    for (const part of full.split(".")) {
      path = path ? path + "." + part : part;
      const have = lib.nameIndex.get(path) ?? ownNames.get(path);
      if (have !== undefined) { pre = have; continue; }
      const i = nextName++; ownNames.set(path, i); out.push(JSON.stringify({ in: i, str: { pre, str: part } }));
      pre = i;
    }
    return pre;
  };
  const declare = (kind, full, type, value) => {
    if (has(full)) throw new Error("already declared: " + full);
    const n = name(full);
    out.push(JSON.stringify(kind === "def" ? { def: { all: [n], hints: { regular: 1 }, levelParams: [], name: n, safety: "safe", type, value } } : { thm: { all: [n], levelParams: [], name: n, type, value } }));
    nameOf.push(full);
    return term({ const: { name: n, us: [] } });
  };
  const one = level({ succ: 0 });
  const C = (full, us = []) => term({ const: { name: known(full), us } });
  const app = (fn, ...args) => args.reduce((f, arg) => term({ app: { arg, fn: f } }), fn);
  const nat = (n) => { if (!(typeof n === "bigint" ? n >= 0n : Number.isInteger(n) && n >= 0)) throw new Error("not a natural number: " + n); return term({ natVal: String(n) }); };
  const Nat = C("Nat"), Bool = C("Bool");
  const listType = (T) => app(C("List", [0]), T);
  const nil = (T) => app(C("List.nil", [0]), T);
  const cons = (T, head, tail) => app(C("List.cons", [0]), T, head, tail);
  const list = (T, items) => items.reduceRight((tail, head) => cons(T, head, tail), nil(T));
  const prodType = (A, B) => app(C("Prod", [0, 0]), A, B);
  const prod = (A, B, a, b) => app(C("Prod.mk", [0, 0]), A, B, a, b);
  const pairType = prodType(Nat, Nat), boxType = listType(pairType), boxesType = listType(boxType), factType = prodType(boxType, boxesType);
  const box = (b) => list(pairType, b.map(([lo, hi]) => prod(Nat, Nat, nat(lo), nat(hi))));
  const boxes = (bs) => list(boxType, bs.map(box));
  const Cond = C(K + "Cond"), Rule = C(K + "Rule"), Property = C(K + "Property");
  const conds = (when) => list(Cond, when.map(([field, op, value]) => app(C(K + "Cond.mk"), nat(field), nat(op), nat(value))));
  const rules = (rs) => list(Rule, rs.map((r) => app(C(K + "Rule.mk"), conds(r.when), nat(r.outcome))));
  const property = (p) => app(C(K + "Property.mk"), C(p.always ? "Bool.true" : "Bool.false"), conds(p.when), nat(p.outcome));
  const eq = (T, a, b) => app(C("Eq", [one]), T, a, b);
  const refl = (T, a) => app(C("Eq.refl", [one]), T, a);
  const isTrue = (run) => [eq(Bool, run, C("Bool.true")), refl(Bool, C("Bool.true"))];
  // The body of a statement `∀ a b c ..., T` with its first binders replaced by closed terms.
  const instantiate = (type, args) => {
    let body = type;
    for (let i = 0; i < args.length; i++) { const n = nodeOf(body); if (!n.forallE) throw new Error("the statement has fewer binders than arguments"); body = n.forallE.body; }
    const n = args.length, memo = new Map();
    const go = (i, depth) => {
      const key = i + ":" + depth;
      if (memo.has(key)) return memo.get(key);
      const node = nodeOf(i);
      let r;
      if ("bvar" in node) r = node.bvar < depth ? i : node.bvar - depth < n ? args[n - 1 - (node.bvar - depth)] : term({ bvar: node.bvar - n });
      else if (node.app) r = term({ app: { arg: go(node.app.arg, depth), fn: go(node.app.fn, depth) } });
      else if (node.forallE) r = term({ forallE: { ...node.forallE, type: go(node.forallE.type, depth), body: go(node.forallE.body, depth + 1) } });
      else if (node.lam) r = term({ lam: { ...node.lam, type: go(node.lam.type, depth), body: go(node.lam.body, depth + 1) } });
      else if (node.letE) r = term({ letE: { ...node.letE, type: go(node.letE.type, depth), value: go(node.letE.value, depth), body: go(node.letE.body, depth + 1) } });
      else if (node.proj) r = term({ proj: { ...node.proj, struct: go(node.proj.struct, depth) } });
      else r = i;   // a constant, a sort or a literal holds no variable
      memo.set(key, r);
      return r;
    };
    return go(body, 0);
  };
  // A theorem of the resident file applied to closed terms, under the type its statement takes for them.
  const applied = (full, args) => [instantiate(lib.consts.get(known(full)).type, args), app(C(full), ...args)];
  return { declare, term, name, instantiate, C, app, nat, list, listType, nil, cons, prodType, prod, box, boxes, boxType, boxesType, factType, rules, property, conds, eq, refl, isTrue, applied, has, Nat, Bool, Rule, Property, text: () => out.join("\n") + "\n" };
}

/** The whole proof of an app in one suffix, through regionCheck_sound. */
export function proofOf(libraryText, spec, library = readLibrary(libraryText)) {
  const w = writer(library), n = spec.name + ".";
  const rules = w.declare("def", n + "rules", w.listType(w.Rule), w.rules(spec.rules));
  const props = w.declare("def", n + "props", w.listType(w.Property), w.list(w.Property, spec.properties.map(w.property)));
  const d = w.declare("def", n + "d", w.Nat, w.nat(spec.otherwise));
  const B = w.declare("def", n + "B", w.boxType, w.box(spec.bounds));
  // checked : regionCheck B rules props d = true := Eq.refl true
  const checked = w.declare("thm", n + "checked", ...w.isTrue(w.app(w.C(K + "regionCheck"), B, rules, props, d)));
  w.declare("thm", n + "all_hold", ...w.applied(K + "regionCheck_sound", [B, rules, props, d, checked]));
  return w.text();
}

/** One suffix per guarantee, each whole in itself; regionCheck_sound holds for a list of one. */
export function proofsOf(libraryText, spec, library = readLibrary(libraryText)) {
  return spec.properties.map((property, i) => proofOf(libraryText, { ...spec, name: spec.name + ".g" + i, properties: [property] }, library));
}

// The parts every certified proof of one guarantee shares.
function certified(w, n, spec, property, cert, known, allKnown) {
  const listNat = w.listType(w.Nat), optionNat = w.app(w.C("Option", [0]), w.Nat), certType = w.prodType(listNat, optionNat);
  const certTerm = (c) => w.prod(listNat, optionNat, w.list(w.Nat, c.sel.map(w.nat)), c.memo === null ? w.app(w.C("Option.none", [0]), w.Nat) : w.app(w.C("Option.some", [0]), w.Nat, w.nat(c.memo)));
  const rules = w.declare("def", n + "rules", w.listType(w.Rule), w.rules(spec.rules));
  const d = w.declare("def", n + "d", w.Nat, w.nat(spec.otherwise));
  const B = w.declare("def", n + "B", w.boxType, w.box(spec.bounds));
  const p = w.declare("def", n + "p", w.Property, w.property(property));
  const cs = w.declare("def", n + "cs", w.listType(certType), w.list(certType, cert.rules.map(certTerm)));
  const co = w.declare("def", n + "co", certType, certTerm(cert.other));
  const checked = w.declare("thm", n + "checked", ...w.isTrue(w.app(w.C(K + "certCheck"), B, rules, known, d, p, cs, co)));
  w.declare("thm", n + "holds", ...w.applied(K + "certCheck_sound", [B, rules, known, d, p, cs, co, allKnown, checked]));
}

/**
 * One suffix per guarantee through certCheck_sound, with no facts: the kernel subtracts, for each rule, only the
 * earlier rules the certificate names. certs is live/certs.mjs's certsOf(spec).
 */
export function certifiedProofsOf(libraryText, spec, certs, library = readLibrary(libraryText)) {
  return spec.properties.map((property, i) => {
    const w = writer(library);
    const plain = { rules: certs[i].rules.map((c) => ({ sel: c.sel, memo: null })), other: { sel: certs[i].other.sel, memo: null } };
    certified(w, spec.name + ".g" + i + ".", spec, property, plain, w.nil(w.factType), w.C(K + "allKnown_nil"));
    return w.text();
  });
}

/** The name a fact's theorem is declared under: the address of the obligation's meaning. */
export const factName = (key) => "Fact.k" + key;

/**
 * One obligation as a theorem of its own: the boxes cover the region.
 *   Fact.k<address> : subAll region boxes = [] := Eq.refl []
 * The kernel accepts it only by doing the subtraction and finding nothing left. To be kept resident once accepted.
 */
export function factProof(library, fact) {
  const w = writer(library);
  const empty = w.nil(w.boxType);
  w.declare("thm", factName(fact.key), w.eq(w.boxesType, w.app(w.C(K + "subAll"), w.box(fact.region), w.boxes(fact.boxes)), empty), w.refl(w.boxesType, empty));
  return w.text();
}

/**
 * One guarantee, proved from facts that are resident: the kernel compares each obligation's region and boxes with
 * the fact pointed at, and subtracts nothing. Every fact named must have been accepted and kept (factProof).
 */
export function reusedProof(library, spec, i, cert) {
  const w = writer(library);
  for (const f of cert.facts) if (!w.has(factName(f.key))) throw new Error("the fact is not resident: " + f.key);
  // known = [f0, f1, ...], and AllKnown known from each fact's own theorem.
  const fact = (f) => w.prod(w.boxType, w.boxesType, w.box(f.region), w.boxes(f.boxes));
  let known = w.nil(w.factType), allKnown = w.C(K + "allKnown_nil");
  for (const f of [...cert.facts].reverse()) {
    const head = fact(f);
    allKnown = w.app(w.C(K + "allKnown_cons"), head, known, w.C(factName(f.key)), allKnown);
    known = w.cons(w.factType, head, known);
  }
  certified(w, spec.name + ".g" + i + ".", spec, spec.properties[i], cert, known, allKnown);
  return w.text();
}

/** The name a Linked.lean fact's theorem is declared under. */
export const linkName = (key) => "Link.k" + key;

/**
 * Facts of live/Linked.lean, each a theorem named by its address, in one suffix to be kept once accepted. The
 * kernel accepts a fact only by doing its evaluation. If any one is false the whole suffix is refused.
 */
export function linkFacts(library, facts) {
  const w = writer(library), tru = w.C("Bool.true"), fls = w.C("Bool.false"), L = (n) => w.C(K + n);
  const bool = (b) => (b ? tru : fls);
  for (const f of facts) {
    let type, value;
    if (f.kind === "rule" || f.kind === "prop") {
      // RuleBox B c Q := ruleBox_intro B c Q (Eq.refl true) (Eq.refl Q), and the same for a guarantee's conditions.
      const [B, c, Q] = [w.box(f.B), w.conds(f.when), w.box(f.kind === "rule" ? f.Q : f.W)];
      type = w.app(L(f.kind === "rule" ? "RuleBox" : "PropBox"), B, c, Q);
      value = w.app(L(f.kind === "rule" ? "ruleBox_intro" : "propBox_intro"), B, c, Q, w.refl(w.Bool, tru), w.refl(w.boxType, Q));
    } else if (f.kind === "notbad") {
      const args = [bool(f.always), w.nat(f.outcome), w.nat(f.o)];
      type = w.app(L("NotBad"), ...args); value = w.app(L("notBad_intro"), ...args, w.refl(w.Bool, fls));
    } else if (f.kind === "apart") {
      const args = [w.box(f.Q), w.box(f.W)];
      type = w.app(L("Apart"), ...args); value = w.app(L("apart_intro"), ...args, w.refl(w.Bool, fls));
    } else if (f.kind === "meets") {
      const args = [w.box(f.Q), w.box(f.W), w.box(f.M)];
      type = w.app(L("Meets"), ...args); value = w.app(L("meets_intro"), ...args, w.refl(w.boxType, args[2]));
    } else if (f.kind === "covers") {
      const args = [w.box(f.M), w.boxes(f.Bs)];
      type = w.app(L("CoveredBy"), ...args); value = w.app(L("coveredBy_intro"), ...args, w.refl(w.boxesType, w.nil(w.boxType)));
    } else throw new Error("not a kind of fact: " + f.kind);
    w.declare("thm", linkName(f.key), type, value);
  }
  return w.text();
}

/**
 * One guarantee assembled from resident facts, from the last rule to the first: lemma applications only. links is
 * live/certs.mjs's linksOf(app). Every fact named must be resident.
 */
export function linkedProof(library, spec, i, links) {
  const w = writer(library), L = (n) => w.C(K + n), g = links.guarantees[i], p = spec.properties[i], n = spec.rules.length;
  const fact = (key) => { if (!w.has(linkName(key))) throw new Error("the fact is not resident: " + key); return w.C(linkName(key)); };
  const B = w.box(spec.bounds), a = w.C(p.always ? "Bool.true" : "Bool.false"), pw = w.conds(p.when), po = w.nat(p.outcome), d = w.nat(spec.otherwise);
  const W = w.box(g.W), Q = links.boxes.map(w.box), prop = fact(g.prop);
  const head = [B, a, pw, po];
  // pre[k]: the boxes of the first k rules, the latest first. rest[k]: the rules from k on.
  const pre = [w.nil(w.boxType)]; for (let k = 0; k < n; k++) pre.push(w.cons(w.boxType, Q[k], pre[k]));
  const ruleTerm = (r) => w.app(L("Rule.mk"), w.conds(r.when), w.nat(r.outcome));
  const rest = []; rest[n] = w.nil(w.Rule); for (let k = n - 1; k >= 0; k--) rest[k] = w.cons(w.Rule, ruleTerm(spec.rules[k]), rest[k + 1]);
  // Q[j] is one of pre[k], for j < k.
  const memo = new Map();
  const isIn = (j, k) => {
    const key = j + ":" + k; let m = memo.get(key);
    if (m === undefined) { m = j === k - 1 ? w.app(L("inHere"), Q[j], pre[j]) : w.app(L("inThere"), Q[j], Q[k - 1], pre[k - 1], isIn(j, k - 1)); memo.set(key, m); }
    return m;
  };
  const never = (step, k, box, o) => {
    const at = [...head, pre[k], box, o];
    if (step.how === "ok") return w.app(L("never_ok"), ...at, fact(step.fact));
    if (step.how === "apart") return w.app(L("never_apart"), ...at, W, prop, fact(step.fact));
    let Bs = w.nil(w.boxType), allIn = w.app(L("allIn_nil"), pre[k]);
    for (const j of [...step.sel].reverse()) { allIn = w.app(L("allIn_cons"), Q[j], Bs, pre[k], isIn(j, k), allIn); Bs = w.cons(w.boxType, Q[j], Bs); }
    return w.app(L("never_cover"), ...at, W, w.box(step.M), Bs, prop, fact(step.meets), fact(step.covers), allIn);
  };
  let safe = w.app(L("safe_nil"), ...head, d, pre[n], never(g.steps[n], n, B, d));
  for (let k = n - 1; k >= 0; k--) {
    const r = spec.rules[k], o = w.nat(r.outcome);
    safe = w.app(L("safe_cons"), ...head, d, pre[k], w.conds(r.when), o, rest[k + 1], Q[k], fact(links.rules[k]), never(g.steps[k], k, Q[k], o), safe);
  }
  w.declare("thm", spec.name + ".g" + i + ".holds", ...w.applied(K + "linked_sound", [...head, d, rest[0], safe]));
  return w.text();
}

const T = "PrismLive.Tab.";

/** The name a Tab.lean fact's theorem is declared under. */
export const tabName = (key) => "Tab.k" + key;

// Tab.lean's data as kernel terms.
function tabTerms(w) {
  const L = (n) => w.C(T + n), Zone = L("Zone"), Diff = L("Diff"), Cond = L("Cond"), Rule = L("Rule");
  const diff = (e) => w.app(L("Diff.mk"), w.nat(e.a), w.nat(e.k), w.nat(e.b), w.nat(e.j));
  const zone = ([b, ds]) => w.prod(w.boxType, w.listType(Diff), w.box(b), w.list(Diff, ds.map(diff)));
  const zones = (zs) => w.list(Zone, zs.map(zone));
  const conds = (cs) => w.list(Cond, cs.map(([f, op, v, other]) => w.app(L("Cond.mk"), w.nat(f), w.nat(op), w.nat(v), w.C(other ? "Bool.true" : "Bool.false"))));
  const rule = (r) => w.app(L("Rule.mk"), conds(r.when), w.nat(r.outcome));
  return { L, Zone, Diff, Cond, Rule, diff, zone, zones, conds, rule };
}

/**
 * Facts of live/Tab.lean, each a theorem named by its address, in one suffix to be kept once accepted. The kernel
 * accepts a fact only by doing its evaluation; if any one is false the whole suffix is refused.
 */
export function tabFacts(library, facts) {
  const w = writer(library), z = tabTerms(w), tru = w.C("Bool.true"), fls = w.C("Bool.false");
  for (const f of facts) {
    let type, value;
    if (f.kind === "zones") {
      const args = [w.box(f.B), z.conds(f.cs), z.zones(f.Qs)];
      type = w.app(z.L("ZonesOf"), ...args);
      value = w.app(z.L("zonesOf_intro"), ...args, w.refl(w.Bool, tru), w.refl(w.listType(z.Zone), args[2]));
    } else if (f.kind === "notbad") {
      const args = [f.always ? tru : fls, w.nat(f.outcome), w.nat(f.o)];
      type = w.app(z.L("NotBad"), ...args); value = w.app(z.L("notBad_intro"), ...args, w.refl(w.Bool, fls));
    } else if (f.kind === "covers") {
      const args = [z.zone(f.q), z.zone(f.w), z.zones(f.bs)];
      type = w.app(z.L("Covers"), ...args);
      value = w.app(z.L("covers_intro"), ...args, w.refl(w.listType(z.Zone), w.nil(z.Zone)));
    } else throw new Error("not a kind of fact: " + f.kind);
    w.declare("thm", tabName(f.key), type, value);
  }
  return w.text();
}

/**
 * One guarantee assembled from resident facts: lemma applications only. links is live/zones.mjs's tabLinksOf(app),
 * and app's conditions are [field, op, value, other]. Every fact named must be resident.
 */
export function tabProof(library, spec, i, links) {
  const w = writer(library), z = tabTerms(w), L = z.L, g = links.guarantees[i], p = spec.properties[i], n = spec.rules.length;
  const fact = (key) => { if (!w.has(tabName(key))) throw new Error("the fact is not resident: " + key); return w.C(tabName(key)); };
  const B = w.box(links.B), a = w.C(p.always ? "Bool.true" : "Bool.false"), po = w.nat(p.outcome), d = w.nat(spec.otherwise);
  const head = [B, a, po, d];
  // Each rule's zones, as one list term, the term of each zone, and the list after each zone.
  const zs = links.zones.map((Qs) => {
    const each = Qs.map(z.zone), tails = [w.nil(z.Zone)];
    for (let m = each.length - 1; m >= 0; m--) tails.unshift(w.cons(z.Zone, each[m], tails[0]));
    return { list: tails[0], each, tails };
  });
  const whole = z.zone([links.B, []]);
  // pre[k]: the zones of the first k rules, the latest first: cat (zones of rule k - 1) pre[k - 1].
  const pre = [w.nil(z.Zone)]; for (let k = 0; k < n; k++) pre.push(w.app(L("cat"), zs[k].list, pre[k]));
  const rest = []; rest[n] = w.nil(z.Rule); for (let k = n - 1; k >= 0; k--) rest[k] = w.cons(z.Rule, z.rule(spec.rules[k]), rest[k + 1]);
  // Zone m of rule j is in that rule's list: inThere over the zones before it, then inHere.
  const inList = (j, m) => {
    const { each, tails } = zs[j];
    let h = w.app(L("inHere"), each[m], tails[m + 1]);
    for (let r = m - 1; r >= 0; r--) h = w.app(L("inThere"), each[m], each[r], tails[r + 1], h);
    return h;
  };
  // Zone m of rule j is one of pre[k], for j < k.
  const memo = new Map();
  const isIn = (j, m, k) => {
    const key = j + ":" + m + ":" + k; let h = memo.get(key);
    if (h === undefined) {
      h = j === k - 1 ? w.app(L("inLeft"), zs[j].each[m], zs[j].list, pre[k - 1], inList(j, m))
        : w.app(L("inRight"), zs[j].each[m], zs[k - 1].list, pre[k - 1], isIn(j, m, k - 1));
      memo.set(key, h);
    }
    return h;
  };
  const safes = g.safes.map((s, wi) => {
    const W = z.zone(g.ws[wi]);
    const never = (st, k, q, o) => {
      const at = [B, a, po, W, pre[k], q, o];
      if (st.how === "ok") return w.app(L("never_ok"), ...at, fact(st.fact));
      let bs = w.nil(z.Zone), allIn = w.app(L("allIn_nil"), pre[k]);
      for (let r = st.sel.length - 1; r >= 0; r--) {
        const [j, m] = st.sel[r], t = zs[j].each[m];
        allIn = w.app(L("allIn_cons"), t, bs, pre[k], isIn(j, m, k), allIn);
        bs = w.cons(z.Zone, t, bs);
      }
      return w.app(L("never_cover"), ...at, bs, fact(st.fact), allIn);
    };
    const neverAll = (steps, k, o) => {
      const { each, tails } = zs[k];
      let h = w.app(L("neverAll_nil"), B, a, po, W, pre[k], o);
      for (let m = each.length - 1; m >= 0; m--) h = w.app(L("neverAll_cons"), B, a, po, W, pre[k], each[m], tails[m + 1], o, never(steps[m], k, each[m], o), h);
      return h;
    };
    let safe = w.app(L("safe_nil"), ...head, W, pre[n], never(s.steps[n][0], n, whole, d));
    for (let k = n - 1; k >= 0; k--) {
      const r = spec.rules[k], o = w.nat(r.outcome);
      safe = w.app(L("safe_cons"), ...head, W, pre[k], z.conds(r.when), o, rest[k + 1], zs[k].list, fact(links.rules[k]), neverAll(s.steps[k], k, o), safe);
    }
    return { W, safe };
  });
  // SafeAll over the guarantee's zones, from the last to the first.
  let all = w.app(L("safeAll_nil"), ...head, rest[0]), tail = w.nil(z.Zone);
  for (let m = safes.length - 1; m >= 0; m--) { all = w.app(L("safeAll_cons"), ...head, safes[m].W, tail, rest[0], safes[m].safe, all); tail = w.cons(z.Zone, safes[m].W, tail); }
  w.declare("thm", spec.name + ".g" + i + ".holds", ...w.applied(T + "tab_sound", [B, a, z.conds(p.when), po, d, rest[0], z.zones(g.ws), fact(g.prop), all]));
  return w.text();
}
