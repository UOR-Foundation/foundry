// The LexLean gate: an app's canonical LexLean module is its source, and the live preview projects from
// it. The module reads back to the bytes it was written from; what it reads decides as the rules do on
// every request; a module still being written projects without taking anything away; and the local
// obligations agree with the decision table's check of every guarantee on every request.
//
//   node tools/live_lexlean.mjs --check
//
// Claims (level build: validated here against the decision table, live/table.mjs, and the interpreter,
// prism.js's prismAnswer, as oracles):
//   round trip   the Verdant Resonance module (tools/fixtures/live/verdant.lex.tex) re-writes to the same
//                bytes, and the RSVP fixture written as LexLean reads back to the same logic
//   agreement    the logic read from the module decides as the interpreter does on sampled requests
//   streaming    no prefix of the module throws; nothing drawn while it streams is taken away; the last
//                prefix projects as the whole module
//   obligations  their verdict equals the table's check of every guarantee on every request, on the
//                module and on 30 edited copies; every counterexample they name breaks the guarantee by
//                the interpreter; a rule with != is refused (outside the fragment)
//   turn         a chat turn's module is read as the source; a module that does not read is refused
//   budget       read and obligations together under 25 ms (median of 20 warm runs, this machine)
// Measured, not asserted (level open): obligations re-used across one edit.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prism = await import(new URL("../shell/prism.js", import.meta.url));
const live = await import(new URL("../shell/live/project.mjs", import.meta.url));
const lex = await import(new URL("../shell/live/lexlean.mjs", import.meta.url));
const { checkObligations } = await import(new URL("../shell/live/obligations.mjs", import.meta.url));
const { tableKernel } = await import(new URL("../shell/live/table.mjs", import.meta.url));
const K = tableKernel();
const { prismAnswer } = new Function(prism.INTERPRETER + "\nreturn { prismAnswer };")();

let failed = 0;
const claim = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " -- " + detail : ""}`); if (!ok) failed++; };
const source = fs.readFileSync(path.join(root, "tools/fixtures/live/verdant.lex.tex"), "utf8");
const spec = lex.readLexLean(source);
const logicOf = (s) => live.project(s).logic;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const semantic = (l) => ({ fields: l.fields, rules: l.rules.map((r) => ({ when: r.when, then: r.then })), otherwise: l.otherwise, properties: (l.properties || []).map((p) => ({ kind: p.kind, when: p.when, then: p.then })) });

// round trip
claim("round trip: Verdant re-writes to the same bytes", lex.toLexLean(spec) === source, `${source.split("\n").length} lines`);
const rsvp = JSON.parse(fs.readFileSync(path.join(root, "tools/fixtures/live/rsvp.json"), "utf8"));
const hostSource = fs.readFileSync(path.join(root, "shell/host.js"), "utf8");
let rsvpBack = null, rsvpError = "", rsvpText = "";
try { rsvpText = lex.toLexLean(rsvp); rsvpBack = lex.readLexLean(rsvpText); } catch (e) { rsvpError = e.message; }
// A comparison of two fields may read back with its sides swapped (a > b as b < a), so the logic is
// compared by what it decides, on every request of the table, and by its re-written bytes.
let rsvpSame = !!rsvpBack;
if (rsvpBack) {
  const a = logicOf(rsvp), b = logicOf(rsvpBack), t = K.build(a);
  for (let r = 0; r < t.size && rsvpSame; r++) { const l = K.requestOf(t, r); if (prismAnswer(a, l) !== prismAnswer(b, l)) rsvpSame = false; }
  rsvpSame = rsvpSame && lex.toLexLean(rsvpBack) === rsvpText && same(a.properties.map((p) => [p.kind, p.then]), b.properties.map((p) => [p.kind, p.then]));
}
claim("round trip: the RSVP fixture as LexLean decides the same on every request", rsvpSame, rsvpError || `${K.build(logicOf(rsvp)).size} requests; re-written bytes equal`);
claim("obligations: a rule comparing two fields is left to the table", !!rsvpBack && checkObligations(rsvpBack).ok === false);

// every operator, each side of every comparison: written, read back, and decided the same on every request
const ops = {
  name: "every-operator", title: "Every operator", purpose: "Exercise every condition the reader reads.",
  fields: [{ name: "a", kind: "number", min: 0, max: 9 }, { name: "b", kind: "number", min: 2, max: 7 }, { name: "c", kind: "choice", values: ["x", "y", "z"] }],
  outcomes: ["lt", "le", "gt", "ge", "eq", "ne", "is", "isnot", "flt", "fle", "feq", "fne", "none"],
  rules: [
    { when: [{ field: "a", op: "<", value: 3 }, { field: "c", op: "is", value: "x" }], then: "lt" },
    { when: [{ field: "a", op: "<=", value: 4 }, { field: "c", op: "is", value: "y" }], then: "le" },
    { when: [{ field: "a", op: ">", value: 6 }, { field: "c", op: "is", value: "x" }], then: "gt" },
    { when: [{ field: "a", op: ">=", value: 7 }, { field: "c", op: "is", value: "y" }], then: "ge" },
    { when: [{ field: "a", op: "=", value: 5 }], then: "eq" },
    { when: [{ field: "b", op: "!=", value: 4 }, { field: "c", op: "is", value: "z" }, { field: "a", op: "<", value: 2 }], then: "ne" },
    { when: [{ field: "c", op: "is", value: "z" }, { field: "a", op: ">", value: 7 }], then: "is" },
    { when: [{ field: "c", op: "is not", value: "x" }, { field: "a", op: "=", value: 0 }], then: "isnot" },
    { when: [{ field: "a", op: "<", value: { field: "b" } }, { field: "c", op: "is", value: "x" }], then: "flt" },
    { when: [{ field: "a", op: "<=", value: { field: "b" } }, { field: "c", op: "is", value: "y" }], then: "fle" },
    { when: [{ field: "a", op: "=", value: { field: "b" } }], then: "feq" },
    { when: [{ field: "a", op: "!=", value: { field: "b" } }, { field: "c", op: "is", value: "z" }], then: "fne" },
  ],
  otherwise: "none", properties: [], examples: [],
};
let opsSame = false, opsError = "";
try {
  const back = lex.readLexLean(lex.toLexLean(ops)), a = logicOf(ops), b = logicOf(back), t = K.build(a);
  opsSame = true;
  for (let r = 0; r < t.size && opsSame; r++) { const l = K.requestOf(t, r); if (prismAnswer(a, l) !== prismAnswer(b, l)) { opsSame = false; opsError = `\`${l}\` answers ${prismAnswer(b, l)}, not ${prismAnswer(a, l)}`; } }
} catch (e) { opsError = e.message; }
claim("round trip: every operator decides the same on every request", opsSame, opsError || "12 rules, 13 outcomes, 180 requests");

// agreement, on requests sampled with a fixed seed and biased to the edges of every condition
let seed = 20261111;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const line = (s) => s.fields.map((f) => {
  if (f.kind === "choice") return f.values[Math.floor(rand() * f.values.length)];
  const edges = [...s.rules, ...s.properties].flatMap((r) => r.when).filter((c) => c.field === f.name && typeof c.value === "number").flatMap((c) => [c.value - 1, c.value, c.value + 1]).filter((v) => v >= (f.min ?? 0) && v <= f.max);
  return String(rand() < 0.5 && edges.length ? edges[Math.floor(rand() * edges.length)] : (f.min ?? 0) + Math.floor(rand() * (f.max - (f.min ?? 0) + 1)));
}).join(" ");
const logic = logicOf(spec);
let agree = 0;
for (let i = 0; i < 20000; i++) { const l = line(spec); if (prismAnswer(logic, l) === prismAnswer({ fields: spec.fields, rules: spec.rules, otherwise: spec.otherwise }, l)) agree++; }
claim("agreement: the read logic decides as the interpreter does", agree === 20000, `${agree} of 20000`);

// streaming: every declaration boundary, and every 97th character
const finalKeys = new Set(live.project(spec).nodes.map((n) => n.key));
let errors = 0, stray = new Set(), frames = 0, last = null, firstControls = -1;
const cuts = new Set([...source.matchAll(/\n}\n|\}\n\n/g)].map((m) => m.index + m[0].length));
for (let i = 97; i < source.length; i += 97) cuts.add(i);
cuts.add(source.length);
for (const i of [...cuts].sort((a, b) => a - b)) {
  try {
    const part = lex.readLexLeanPartial(source.slice(0, i));
    if (!part.spec) continue;
    const p = live.project(part.spec);
    if (p.root !== last) { frames++; last = p.root; }
    if (firstControls < 0 && p.nodes.some((n) => n.kind === "input")) firstControls = i;
    for (const n of p.nodes) if (!finalKeys.has(n.key)) stray.add(n.key);
  } catch (e) { errors++; }
}
claim("streaming: no prefix throws", errors === 0, `${cuts.size} prefixes`);
claim("streaming: nothing drawn is taken away", stray.size === 0, stray.size ? [...stray].slice(0, 5).join(", ") : `${frames} distinct screens; controls at character ${firstControls} of ${source.length}`);
claim("streaming: the last prefix is the module", live.project(lex.readLexLeanPartial(source).spec).root === live.project(spec).root);

// obligations against the table's every-request check
const tableHolds = (s) => { const l = logicOf(s); const t = K.build(l); if (t.reason) return null; return K.check(l, t).every((c) => c.ok); };
const base = checkObligations(spec);
claim("obligations: Verdant agrees with the table", base.ok && base.holds === tableHolds(spec), `${base.total} obligations; the table checks ${K.build(logic).size.toLocaleString()} requests`);
let disagree = 0, witnessesOk = 0, broken = 0;
const reuse = [];
for (let i = 0; i < 30; i++) {
  const m = structuredClone(spec);
  const r = m.rules[Math.floor(rand() * m.rules.length)];
  const kind = rand();
  if (kind < 0.6) { const cs = r.when.filter((c) => typeof c.value === "number"); if (cs.length) { const c = cs[Math.floor(rand() * cs.length)]; const f = m.fields.find((x) => x.name === c.field); c.value = Math.max(f.min ?? 0, Math.min(f.max, c.value + [-5, -2, 2, 6][Math.floor(rand() * 4)])); } }
  else r.then = m.outcomes[Math.floor(rand() * m.outcomes.length)];
  const o = checkObligations(m), t = tableHolds(m);
  reuse.push(o.hits / o.total);
  if (o.holds !== t) disagree++;
  if (!o.holds) {
    broken++;
    const l = o.witness.map((v, k) => (m.fields[k].kind === "choice" ? m.fields[k].values[v] : String(v))).join(" ");
    const p = m.properties.find((q) => q.id === o.broken);
    const out = prismAnswer({ fields: m.fields, rules: m.rules, otherwise: m.otherwise }, l);
    const req = Object.fromEntries(m.fields.map((f, k) => [f.name, l.split(" ")[k]]));
    const meets = p.when.every((c) => { const f = m.fields.find((x) => x.name === c.field); const v = f.kind === "choice" ? req[c.field] : Number(req[c.field]); return { is: v === c.value, "is not": v !== c.value, "=": v === c.value, "!=": v !== c.value, "<": v < c.value, "<=": v <= c.value, ">": v > c.value, ">=": v >= c.value }[c.op]; });
    if (meets && (p.kind === "always" ? out !== p.then : out === p.then)) witnessesOk++;
  }
}
claim("obligations: 30 edited copies agree with the table", disagree === 0, `${disagree} disagreements; ${broken} broke a guarantee`);
claim("obligations: every counterexample breaks its guarantee", witnessesOk === broken, `${witnessesOk} of ${broken} confirmed by the interpreter`);
const neq = structuredClone(spec); neq.rules[0].when.push({ field: "biome", op: "is not", value: "meadow" });
claim("obligations: a rule with != is outside the fragment", checkObligations(neq).ok === false);
reuse.sort((a, b) => a - b);
console.log(`open measured: obligations re-used across one edit, median ${(reuse[reuse.length >> 1] * 100).toFixed(1)}%, minimum ${(reuse[0] * 100).toFixed(1)}%`);

// turn
const turn = lex.specFromTurn("Here is the app.\n<prism-lexlean>\n" + source + "</prism-lexlean>\nDone.");
claim("turn: the module is read as the source", !!turn && turn.name === "VerdantResonance" && turn.source === source && same(semantic(logicOf(turn.spec)), semantic(logic)));
const bad = lex.specFromTurn("<prism-lexlean>" + source.replace("else (answerWindWhisper)", "else (answerNope)") + "</prism-lexlean>");
claim("turn: a module that does not read is refused", !!bad && !!bad.error, bad && bad.error);
claim("turn: the module being written projects as a draft", !!lex.partialFromTurn("<prism-lexlean>" + source.slice(0, Math.floor(source.length / 2))));

// the model writes LexLean: declarations only, the theorems are derived
const SPEC_RULES = prism.SPEC_RULES || "";
const example = /<prism-lexlean>([\s\S]*?)<\/prism-lexlean>/.exec(SPEC_RULES);
let exampleReads = false;
try { exampleReads = !!example && lex.readLexLean(example[1]).rules.length > 0 && !/theorem\{/.test(example[1]); } catch (e) {}
claim("prompt: the model is asked for <prism-lexlean>, and the prompt's example reads", SPEC_RULES.includes("<prism-lexlean>") && !SPEC_RULES.includes("<prism-spec>{") && exampleReads);
const bare = source.replace(/\n\ntheorem\{[\s\S]*?\n\}(?=\n)/g, "");
let bareSpec = null;
try { bareSpec = lex.readLexLean(bare); } catch (e) {}
claim("source: declarations without theorems read, and the canonical source derives them", !!bareSpec && bareSpec.properties.length === spec.properties.length && lex.canonicalSource?.(bareSpec)?.source === source, `${bare.length.toLocaleString()} characters without theorems, ${source.length.toLocaleString()} with`);
const turnBare = lex.specFromTurn("<prism-lexlean>" + bare + "</prism-lexlean>");
claim("source: a turn's module is stored canonically", !!turnBare && turnBare.source === source);

// every app has a canonical LexLean source, whatever wrote its spec
const rsvpSource = lex.canonicalSource?.(rsvp);
let rsvpSourceSame = false;
if (rsvpSource) { const a = logicOf(rsvp), b = logicOf(lex.readLexLean(rsvpSource.source)), t = K.build(a); rsvpSourceSame = true; for (let r = 0; r < t.size && rsvpSourceSame; r++) { const l = K.requestOf(t, r); if (prismAnswer(a, l) !== prismAnswer(b, l)) rsvpSourceSame = false; } }
claim("every app: a spec's canonical source decides as the spec does", !!rsvpSource && /^[A-Z]\w*$/.test(rsvpSource.name) && rsvpSourceSame, rsvpSource ? `prism/${rsvpSource.name}.lex.tex` : "no canonicalSource");

// over prism-code's 24 rules: checked by obligations, never offered for proof
const big = prism.checkSpec(spec);
claim("cap: an app over 24 rules is checked by its obligations", big.ok === true && !!big.module && (big.notes || []).some((n) => /obligations/.test(n)), big.ok ? (big.notes || []).join(" ") : (big.issues || []).join(" "));
const bigBroken = structuredClone(spec); bigBroken.rules[1].when.find((c) => c.field === "proximity").value = 60;
const bb = prism.checkSpec(bigBroken);
claim("cap: a broken app over 24 rules is refused with its counterexample", bb.ok === false && (bb.issues || []).some((i) => /does not hold/.test(i)), (bb.issues || []).join(" "));
let proveWord = "";
try { await prism.prove(spec); } catch (e) { proveWord = e.message; }
claim("cap: proving an app over 24 rules is refused, and says why", /24 rules/.test(proveWord) && /605/.test(proveWord), proveWord);

// What real models got wrong (Haiku and Sonnet on Foundry's prompt, four apps each): the reader names the
// mistake so the model can fix it, and reads what is unambiguous. Each case is the prompt's own example,
// changed the way a model changed its module.
const ex = example ? example[1] : "";
const refusal = (text) => { try { lex.readLexLean(text.trim() + "\n"); return ""; } catch (e) { return e.message; } };
const exSpec = example ? lex.readLexLean(ex.trim() + "\n") : null;
const sameAsExample = (text) => { try { const s = lex.readLexLean(text.trim() + "\n"); return same(semantic(logicOf(s)), semantic(logicOf(exSpec))) && JSON.stringify(s.properties) === JSON.stringify(exSpec.properties); } catch (e) { return false; } };
const extra = refusal(ex.replace("<? 3))", "<? 3)))"));
claim("errors: one \")\" too many is named, with where", /^inBounds: one "\)" too many, after/.test(extra), extra);
const missing = refusal(ex.replace("(answerStandard))))", "(answerStandard)))"));
claim("errors: a \")\" missing is named", /^judge: 1 "\)" missing/.test(missing), missing);
const several = refusal(ex.replaceAll("<? 3))", "<? 3)))"));
claim("errors: every unbalanced declaration is named at once", /^2 declarations have unbalanced parentheses: inBounds: .*; breaksInv001: /.test(several), several);
const misnamed = refusal(ex.replaceAll("vehicleTruck", "typeTruck"));
claim("errors: a value named after anything but its field is told its name", /typeTruck .*vehicleTruck$/.test(misnamed), misnamed);
claim("reads: `x <? N` bounds a number as `x <=? N - 1`", sameAsExample(ex.replaceAll("(project request hours) <=? 24)", "(project request hours) <? 25)")));
claim("reads: a guarantee may name inBounds and its rule, and leave its outer pair off", sameAsExample(ex.replace(/(name: breaksInv001,[\s\S]*?body: )[^\n]*/, "$1((inBounds request) && (rule1 request)) && ((judge request) =? (answerPremium))")));

// one repair turn, with the reader's words
const brokenTurn = "Here are the rules.\n<prism-lexlean>\n" + ex.replace("<? 3))", "<? 3)))").trim() + "\n</prism-lexlean>";
const fixed = "<prism-lexlean>\n" + ex.trim() + "\n</prism-lexlean>";
const asked = [];
const afterRepair = await lex.withRepair(brokenTurn, async (p) => { asked.push(p); return fixed; });
const repairedSpec = lex.specFromTurn(afterRepair);
claim("repair: a module that does not read is asked for once, with the reader's words, and the answer is read", asked.length === 1 && asked[0].includes('inBounds: one ")" too many') && !!repairedSpec && !repairedSpec.error && repairedSpec.name === "ParkingFee", asked[0] ? asked[0].split("\n")[0] : "never asked");
const untouched = [];
const good = await lex.withRepair(fixed, async (p) => { untouched.push(p); return ""; });
claim("repair: a module that reads is never sent back", untouched.length === 0 && good === fixed);
const twice = [];
const still = lex.specFromTurn(await lex.withRepair(brokenTurn, async (p) => { twice.push(p); return brokenTurn; }));
claim("repair: one attempt only; a repair that still does not read is shown with its error", twice.length === 1 && !!still && !!still.error, still && still.error);
claim("repair: the host asks on both paid routes", (hostSource.match(/await repaired\((body|warmBody)\);/g) || []).length === 2 && hostSource.includes("lexlean.withRepair("));

// budget
const runs = [];
checkObligations(spec);
for (let i = 0; i < 20; i++) { const t = performance.now(); checkObligations(lex.readLexLean(source)); runs.push(performance.now() - t); }
runs.sort((a, b) => a - b);
claim("budget: read and obligations under 25 ms", runs[10] < 25, `median ${runs[10].toFixed(1)} ms, p95 ${runs[19].toFixed(1)} ms`);

if (failed) { console.log(`\n${failed} LexLean claim(s) failed`); process.exit(1); }
console.log("\nthe live preview projects from the canonical LexLean module");
