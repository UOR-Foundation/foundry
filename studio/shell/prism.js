// Proved rules for the apps Forge builds. An app that decides something (a tier, an eligibility, a
// grade) carries a Prism spec, prism/spec/1, beside its code. This module does what prism-code does
// with it, in the tab: checks it (prism/spec.mjs, prism-code's checker), renders its LexLean model
// (prism/render.mjs, prism-code's renderer), and asks Lean to prove every guarantee on the hosted
// verifier, the same call `prism_prove` makes. It also writes the app's rule module,
// src/lib/prism.ts: the spec as data and one small interpreter, replayed against every acceptance
// vector before it is written. What Lean proves is the rules; the module is tested against them.
import { SpecError, validateSpec, unreachableRules, counterexample, describeConditions, requestLimits, decodeRequest, respond } from "./prism/spec.mjs";
import { names, renderModel, renderProofs, acceptanceVectors, renderSpecDocument } from "./prism/render.mjs";
import { readSpecFile } from "./prism/spec-file.mjs";

/**
 * The seal of a spec: the UOR content address of its canonical bytes, which the app's model
 * carries, so a built app can be held to the JSON it was built from. Taken from the spec itself,
 * never from how prism/spec.json happens to be written, because the address is of the canonical
 * form either way.
 */
const sealOf = (spec) => readSpecFile(spec).specAddress;
import { TEMPLATE_EXAMPLE, appJson, conformanceText, featureText, idsToml, lexleanLockText, rustTestText, suiteOf } from "./prism/template.mjs";
import { toLexLean, draftOf } from "./live/lexlean.mjs";
import { checkObligations } from "./live/obligations.mjs";
import { tableKernel } from "./live/table.mjs";
import { PROMPT_RULES, facetLine, parsePromptTag, facetsOf } from "./prism/builder/route.mjs";
// The app's prompt parts, read and projected where the rules are (host.js rulesAfterTurn).
export { parsePromptTag, facetsOf };
import { KEY_PREFIX, REFUSAL, trustDescriptor, sameVerifier, attests, addresses, admit, headersOf, record as reuseRecord, theoremsOf, without } from "./prism/proof-reuse.mjs";

// prism-code's checker (prism/spec.mjs, byte for byte) keeps a spec to 24 rules, because its proofs are one
// linear_arithmetic theorem per guarantee over the whole first-match chain. Past that, Forge checks the
// guarantees itself, by local obligations (live/obligations.mjs), or the table when a rule is not a box,
// and never offers the rules for proof until LexLean can prove them locally (UOR-Foundation/PrismPM#605).
export const PROVE_RULES_MAX = 24;

// prism/render.mjs names bytes in hex through Node's Buffer; this is the one use it makes of it.
if (!globalThis.Buffer) globalThis.Buffer = { from: (bytes) => ({ toString: (encoding) => { if (encoding !== "hex") throw new Error("only hex"); return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""); } }) };

const enc = new TextEncoder();
const HOSTED = "https://mcp.uor.foundation/";
const PROTOCOL = "2026-07-28";
const PROFILE = "prism-app";

// ---- what the model is told
// The rules are written as one JSON spec (prism/spec/1), the app's only input. Forge renders the app's
// canonical LexLean module from it (shell/live/lexlean.mjs toLexLean), the same module from the same
// JSON, and Lean proves the guarantees. A model never writes LexLean for a decision app: it is the
// one step that is not deterministic, so it is kept to the smallest thing that says what the app does.
const PARKING = {
  name: "parking-fee", title: "Parking Fee", purpose: "Decide the fee tier from hours parked and vehicle.",
  fields: [{ name: "hours", kind: "number", min: 0, max: 24 }, { name: "vehicle", kind: "choice", values: ["car", "motorcycle", "truck"] }],
  outcomes: ["free", "standard", "premium"],
  rules: [{ when: [{ field: "hours", op: "=", value: 0 }], then: "free" }, { when: [{ field: "vehicle", op: "is", value: "truck" }], then: "premium" }, { when: [{ field: "hours", op: ">", value: 12 }], then: "premium" }],
  otherwise: "standard",
  properties: [{ kind: "never", when: [{ field: "hours", op: "=", value: 0 }], then: "premium" }],
  examples: [{ request: "0 truck", response: "free" }, { request: "13 car", response: "premium" }, { request: "2 car", response: "standard" }],
};
export const SPEC_EXAMPLE = JSON.stringify(PARKING);
/** The example's canonical module in the draft form, without its theorems: what the module reader is held to. */
export const MODULE_EXAMPLE = draftOf(toLexLean(PARKING)).replace(/\n\ntheorem\{[\s\S]*?\n\}(?=\n)/g, "").trim() + "\n";
export const SPEC_RULES = `# You write the app's spec as JSON, and nothing else
Every app here is one JSON spec: its inputs, its answers, its rules and its guarantees. Forge writes the app's LexLean module, its code and its screen from the spec, the same every time, and Lean proves the guarantees. You never write code, files or dependencies: Forge does not apply them. You never write LexLean. To build or change an app, write its spec; to change only one part, write a patch. If a request decides nothing, say in one sentence what the app could decide, and write that spec.
- Write one <dyad-spec> block holding the whole spec as one JSON object, and no other text inside it. Keys: "title"; "purpose" (one sentence); "fields" (1 to 8, in the order a request gives them; each {"name": a lower-case word, "kind": "number" with whole "min" and "max", or "choice" with "values", two to 32 lower-case words}); "outcomes" (the answer words, lower case; "invalid" is reserved); "rules" (1 to 24, in order, the first that matches decides; each {"when": [{"field", "op", "value"}], "then": an outcome}); "otherwise" (the outcome when no rule matches); "properties" (what must never or always happen, each a guarantee Lean proves for every request: {"kind": "never" or "always", "when": [...], "then": an outcome}); "examples" (a few requests with their answers: {"request": "the field values separated by spaces", "response"}).
- A condition's "op" is "is" or "is not" for a choice field, with one of its values; and "<", "<=", ">", ">=", "=" or "!=" for a number field, with a whole number or another number field as {"field": "<name>"}. All of a rule's conditions must hold. Numbers are whole, never fractions.
- Think about which rules and guarantees the app needs, not about syntax. State the guarantees the request implies: what must never be answered, and what must always be.
- To change one part (a word, an answer, one rule), or to set the screen's words or order, write a patch on the spec: <dyad-spec-patch>[{"op":"set","path":["rules",2,"then"],"value":"none"}]</dyad-spec-patch>. Ops are set, insert and remove; \`view\` ({"blocks":[...]}, each one of {"kind":"heading","text"}, {"kind":"text","text"}, {"kind":"input","field","label"}, {"kind":"answer","label"}, {"kind":"guarantees"}, {"kind":"rules"}, {"kind":"examples"}), \`purpose\` (one sentence) and \`meanings\` ({"<answer>": "what it tells the user"}, one key per answer; fields have no meanings) are set this way. When the user points at something on the screen, its paths are given with the request.
- To change the rules, write the whole spec again in a new <dyad-spec> block, starting from the current spec when one is given.
- An app that must keep what it is given between requests (a list that grows, entries that are kept) cannot be written yet. Say so in one sentence, and write the spec of what it could decide.
Example: <dyad-spec>${SPEC_EXAMPLE}</dyad-spec>` + PROMPT_RULES;

// ---- the one thing a model may write
// Every model, on the device or in the cloud, writes the app's JSON spec and nothing else. LexLean a
// model writes is never read: the module is Forge's own rendering of the spec, so the same JSON is the
// same app on every device, and the app's seal is the address of that JSON.
/** Whether a model's turn carries LexLean, closed or still open. */
export const wroteLexLean = (text) => String(text || "").includes("<prism-lexlean>");
/** A model's turn without the LexLean it wrote. */
export const withoutLexLean = (text) => String(text || "").replace(/<prism-lexlean>[\s\S]*?(<\/prism-lexlean>|$)/g, "");
export const LEXLEAN_REFUSED = "**LexLean not applied.** An app is written as its JSON spec, and Forge writes the LexLean module from it; a module a model writes is not used.";

/**
 * What a model is shown of a decision app: its current spec, as the JSON it writes, or that there is
 * none. Never the LexLean module, which Forge renders from the spec.
 */
export function specContext(specText) {
  let spec = null;
  try { spec = specText ? JSON.parse(specText) : null; } catch {}
  if (!spec) return "This app has no spec yet. Write it from my request.";
  return "The app's current spec:\n<dyad-spec>" + JSON.stringify(spec).replaceAll("<", "\\u003c") + "</dyad-spec>";
}

/** What a model is shown of the app: its current module, in the draft form it writes, or that there is none. */
export function moduleContext(source) {
  if (!source) return "This app has no LexLean module yet. Write it from my request.";
  return "The app's current LexLean module:\n<prism-lexlean>\n" + draftOf(source.replace(/\n\ntheorem\{[\s\S]*?\n\}(?=\n)/g, "")).trim() + "\n</prism-lexlean>";
}
export const CODE_REFUSED = "**Code not applied.** The app's code and screen are drawn from its LexLean module; files a model writes are not used.";

// ---- the device. The on-device model holds about 3,000 tokens and writes at most 900, so it is asked
// for the one thing it can write well, the rules, and Forge draws the screen from them (screenSource).
const DEVICE_RULES = `You write the rules of a small decision app as JSON. Reply with one <dyad-spec> block and nothing else.
Keys: "title"; "purpose" (one sentence); "fields" (1 to 8; each {"name": a lower-case word, "kind": "number" with "min" and "max", or "choice" with "values"}); "outcomes" (the answer words); "rules" (in order, the first that matches decides; each {"when": [{"field", "op", "value"}], "then"}); "otherwise"; "properties" (what must never or always happen; each {"kind": "never" or "always", "when": [...], "then"}); "examples" (each {"request": "the field values separated by spaces", "response"}).
"op" is "is" or "is not" for a choice field, and "<", "<=", ">", ">=" or "=" for a number field. Numbers are whole.
Example:
<dyad-spec>{"title":"Parking fee tier","purpose":"Decide the fee tier from hours parked and vehicle.","fields":[{"name":"hours","kind":"number","min":0,"max":24},{"name":"vehicle","kind":"choice","values":["car","motorcycle","truck"]}],"outcomes":["free","standard","premium"],"rules":[{"when":[{"field":"hours","op":"=","value":0}],"then":"free"},{"when":[{"field":"vehicle","op":"is","value":"truck"}],"then":"premium"}],"otherwise":"standard","properties":[{"kind":"never","when":[{"field":"hours","op":"=","value":0}],"then":"premium"}],"examples":[{"request":"0 truck","response":"free"},{"request":"3 car","response":"standard"}]}</dyad-spec>`;
export function deviceRequest(prompt, currentSpec) {
  const ask = currentSpec ? `The app's rules now:\n${JSON.stringify(JSON.parse(currentSpec))}\n\nWrite the whole new rules for this change: ${prompt}` : prompt;
  // /no_think: the rules model is a Qwen3, which otherwise reasons aloud until its 900 tokens are gone.
  return [{ role: "system", content: DEVICE_RULES + "\nWrite each rule once. Write at most 4 examples. /no_think" }, { role: "user", content: ask + " /no_think" }];
}
// What the device wrote, without a reasoning block the model may still open.
export const withoutThinking = (text) => (text || "").replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();

// The screen Forge writes when the rules check and no page uses them yet: a form with one input per
// field, answered by decide(). It reads everything from the rules module, so it never goes stale.
export function screenSource() {
  return `// Written by Prism AI Foundry: a form for the app's rules. The answer comes from decide(), the rules Lean proves.
import { useState } from "react";
import { decide, FIELDS, SPEC } from "@/lib/prism";

export default function Index() {
  const [values, setValues] = useState(() => Object.fromEntries(FIELDS.map((f) => [f.name, f.kind === "choice" ? f.values[0] : String(f.min ?? 0)])));
  const answer = decide(values);
  const set = (name, value) => setValues((v) => ({ ...v, [name]: value }));
  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{SPEC.title}</h1>
          <p className="text-sm text-muted-foreground">{SPEC.purpose}</p>
        </div>
        {FIELDS.map((f) => (
          <label key={f.name} className="block space-y-1.5">
            <span className="text-sm font-medium">{f.means || f.name}</span>
            {f.kind === "choice" ? (
              <select className="w-full rounded-md border bg-background px-3 py-2" value={values[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                {f.values.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            ) : (
              <input className="w-full rounded-md border bg-background px-3 py-2" type="number" inputMode="numeric" step={1} min={f.min} max={f.max} value={values[f.name]} onChange={(e) => set(f.name, e.target.value)} />
            )}
          </label>
        ))}
        <div className="rounded-lg border p-4 space-y-1">
          <div className="text-sm text-muted-foreground">Answer</div>
          <div className="text-2xl font-semibold">{answer}</div>
          {SPEC.meanings && SPEC.meanings[answer] ? <div className="text-sm text-muted-foreground">{SPEC.meanings[answer]}</div> : null}
        </div>
      </div>
    </main>
  );
}
`;
}

// A small model may stop before the closing tag: the block runs to the end of the answer then.
const TAG = /<dyad-spec>([\s\S]*?)(?:<\/dyad-spec>|$)/;
export function parseSpecTag(text) {
  const m = TAG.exec(text || "");
  if (!m) return null;
  let body = m[1].trim();
  const fence = body.match(/^```[\w-]*\n([\s\S]*?)\n```$/);
  if (fence) body = fence[1];
  try { return { spec: JSON.parse(body) }; } catch (e) {
    const repaired = repairJson(body);
    if (repaired !== null) {
      // An answer cut short leaves its last example half written: only whole examples are kept.
      if (Array.isArray(repaired.examples)) repaired.examples = repaired.examples.filter((e) => e && typeof e.request === "string" && typeof e.response === "string");
      return { spec: repaired, repaired: true };
    }
    return { error: "The rules are not valid JSON: " + e.message };
  }
}
// The slips a small model makes in JSON: text after the closing brace, closing brackets it never wrote,
// commas before a closer. Repair only restores syntax; the checker still judges every rule, and the
// user still approves the card, so a repaired spec is never proved unseen.
export function repairJson(text) {
  // A quote glued to a closer, `}"]`, as BitNet writes it: the tokenizer's `}"` taken for `}`.
  text = text.replace(/([}\]])"(?=\s*[\]},])/g, "$1");
  // A doubled comma, and an operator glued to its key, `"op">=","value"`, as Bonsai writes them.
  text = text.replace(/,(\s*,)+/g, ",").replace(/"op"\s*(>=|<=|!=|>|<|=)\s*"\s*,/g, '"op":"$1",');
  const start = text.indexOf("{");
  if (start < 0) return null;
  const stack = [];
  const cuts = []; // a comma between complete items, with the closers still open there
  let inString = false, escaped = false, end = -1, out = "";
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    out += ch;
    if (inString) { if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === '"') inString = false; continue; }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") { if (stack.pop() !== ch) return null; if (!stack.length) { end = i; break; } }
    else if (ch === ",") cuts.push({ at: out.length - 1, closers: stack.slice().reverse().join("") });
  }
  const attempt = (s) => { try { return JSON.parse(s.replace(/,\s*([}\]])/g, "$1")); } catch { return null; } };
  if (end >= 0) return attempt(out);
  // Cut short (the model's token limit): close what is open, else go back to the last complete item.
  let tail = out + (inString ? '"' : "");
  tail = tail.replace(/[,:\s]+$/, "") + stack.slice().reverse().join("");
  const whole = attempt(tail);
  if (whole) return whole;
  for (let k = cuts.length - 1; k >= 0; k--) { const got = attempt(out.slice(0, cuts[k].at) + cuts[k].closers); if (got) return got; }
  return null;
}
// What the chat shows of an answer. The module is the app's source, not something to read in the chat:
// while it streams it shows as one line counting its declarations, and after the turn the card stands in
// its place (in the last module's place, when a repair wrote it again); a patch shows as nothing, its result
// is on the card. The answer itself (the model's text) is kept whole for reading the module and patches.
const MODULE_ENDS = ["</prism-lexlean>", "\\end{prism-lexlean}", "\\end{lexlean}"];
export function shownText(text, card = null) {
  // The model's reasoning (shown as <think>…) names the tag in passing: it is shown as it is.
  const t = text || "", think = /^<think>[\s\S]*?(<\/think>|$)/.exec(t);
  if (think) return think[0] + (think[1] ? shownText(t.slice(think[0].length), card) : "");
  let out = "", rest = t;
  for (;;) {
    const at = rest.indexOf("<prism-lexlean>");
    if (at < 0) { out += rest; break; }
    out += rest.slice(0, at);
    const body = rest.slice(at);
    let end = -1;
    const close = body.indexOf("</prism-lexlean>");
    if (close >= 0) end = close + 16;
    else for (const m of MODULE_ENDS.slice(1)) { const k = body.lastIndexOf(m); if (k >= 0) end = Math.max(end, k + m.length); }
    const block = end >= 0 ? body.slice(0, end) : body;
    // An app written in the app notation is lines, not declarations: Forge writes the module from them.
    const lines = /^<prism-lexlean>\s*app\s/.test(block) && !block.includes("\\begin{") ? block.replace(/<\/?prism-lexlean>/g, "").split("\n").filter((l) => l.trim()).length : 0;
    const n = lines || (block.match(/\b(definition|structure)\{/g) || []).length;
    out += end >= 0 ? `\u0000${lines ? "L" : ""}${n}\u0000` : lines ? `\n\n_Writing the app: ${n} line${n === 1 ? "" : "s"} so far…_\n\n` : `\n\n_Writing the app's LexLean module: ${n} declaration${n === 1 ? "" : "s"} so far…_\n\n`;
    if (end < 0) break;
    rest = body.slice(end);
  }
  const marks = [...out.matchAll(/\u0000(L?)(\d+)\u0000/g)];
  marks.forEach((m, i) => { out = out.replace(m[0], i === marks.length - 1 ? (card ? "\n\n" + card + "\n\n" : m[1] ? `\n\n_The app, written in ${m[2]} line${m[2] === "1" ? "" : "s"}. Forge is writing its LexLean module from them._\n\n` : `\n\n_The app's LexLean module: ${m[2]} declarations._\n\n`) : ""); });
  // The spec is the app's source, not something to read in the chat: one line while it streams, and the
  // card (or one line) in its place once it is whole.
  out = out.replace(/<dyad-spec>[\s\S]*?<\/dyad-spec>/g, card ? "\n\n" + card + "\n\n" : "\n\n_The app's spec, written as JSON._\n\n").replace(/<dyad-spec>[\s\S]*$/, "\n\n_Writing the app's spec…_\n\n");
  // The app's prompt parts are shown through the card's full-model line, not as JSON.
  out = out.replace(/<dyad-spec-patch>[\s\S]*?(<\/dyad-spec-patch>|$)/g, "").replace(/<prism-prompt>[\s\S]*?(<\/prism-prompt>|$)/g, "").replace(/\n{3,}/g, "\n\n");
  // A tag still arriving (`<pri…`) is not shown until it is whole.
  const tail = /<[a-z-]*$/.exec(out);
  return tail && ("<prism-lexlean>".startsWith(tail[0]) || "<dyad-spec-patch>".startsWith(tail[0]) || "<dyad-spec>".startsWith(tail[0]) || "<prism-prompt>".startsWith(tail[0])) ? out.slice(0, tail.index) : out;
}
// The card stands in its own paragraphs, whatever the model wrote around the tag or the module.
export const withCard = (text, card) => {
  const t = text || "";
  return /<prism-lexlean>|<dyad-spec>/.test(t) ? shownText(t, card) : t.replace(TAG, card ? "\n\n" + card + "\n\n" : "");
};
export const isApproval = (prompt) => /^\s*\/?(yes,?\s*)?approve(d)?(\s+(the\s+)?(rules|guarantees|spec))?\s*[.!]?\s*$/i.test(prompt || "");
// "publish" builds the proved app with the Prism SDK and puts it live; no model is asked.
export const isPublish = (prompt) => /^\s*\/?(yes,?\s*)?(publish|ship)(\s+(it|the\s+app|now))?\s*[.!]?\s*$/i.test(prompt || "");

// ---- the app's rule module: these two functions are shipped verbatim (their source text) in
// src/lib/prism.ts, and replayed against every acceptance vector before they are.
function prismAnswer(spec, request) {
  const line = String(request);
  if (new TextEncoder().encode(line).length > Math.min(512, Math.max(64, 24 * spec.fields.length + 16))) return "invalid";
  const parts = line.split(" ");
  if (parts.length !== spec.fields.length) return "invalid";
  const values = {};
  for (let i = 0; i < spec.fields.length; i++) {
    const field = spec.fields[i], part = parts[i];
    if (field.kind === "choice") {
      if (!field.values.includes(part)) return "invalid";
      values[field.name] = part;
    } else {
      if (!/^(0|[1-9][0-9]*)$/.test(part) || part.length > 18) return "invalid";
      const n = BigInt(part);
      if (field.min !== undefined && n < BigInt(field.min)) return "invalid";
      if (field.max !== undefined && n > BigInt(field.max)) return "invalid";
      values[field.name] = n;
    }
  }
  const operand = (value) => (typeof value === "object" ? values[value.field] : BigInt(value));
  const holds = (c) => {
    const left = values[c.field];
    switch (c.op) {
      case "is": return left === c.value;
      case "is not": return left !== c.value;
      case "<": return left < operand(c.value);
      case "<=": return left <= operand(c.value);
      case ">": return left > operand(c.value);
      case ">=": return left >= operand(c.value);
      case "=": return left === operand(c.value);
      case "!=": return left !== operand(c.value);
      default: return false;
    }
  };
  for (const rule of spec.rules) if (rule.when.every(holds)) return rule.then;
  return spec.otherwise;
}
function prismDecide(spec, values) {
  return prismAnswer(spec, spec.fields.map((f) => String(values && values[f.name] !== undefined && values[f.name] !== null ? values[f.name] : "")).join(" "));
}

// The same two functions, as the live frame runs them (shell/live/frame.js): one interpreter wherever an
// answer is shown.
export { prismAnswer, prismDecide };
export const INTERPRETER_PARTS = Object.freeze([prismAnswer.toString(), prismDecide.toString()]);
export const INTERPRETER = INTERPRETER_PARTS.join("\n") + "\n";

function moduleSource(spec, vectors) {
  return `// Generated by Prism AI Foundry from prism/spec.json. Do not edit: change the rules in the chat.
// Lean proves the guarantees about these rules. This module answers with the same rules; Forge
// replayed all ${vectors} acceptance vectors through it before writing it.
export const SPEC = ${JSON.stringify(spec, null, 2)};
${INTERPRETER_PARTS[0]}
${INTERPRETER_PARTS[1]}
export const FIELDS = SPEC.fields;
export const OUTCOMES = SPEC.outcomes;
/** The answer for one set of field values: an outcome word, or "invalid". */
export function decide(values) { return prismDecide(SPEC, values); }
/** The answer for one request line, the field values separated by spaces. */
export function answer(request) { return prismAnswer(SPEC, request); }
`;
}

// ---- the check: what prism_spec runs on a drafted spec, then the module against every vector
// Answer words and field names are lower-case words in a Prism spec. A model that capitalizes an answer
// (grades A to F) or writes debt_ratio or low_fee means the same thing, so each is respelled wherever it is
// named; no rule changes. An answer or a choice is a Prism word (letters, digits, hyphens): low_fee is low-fee.
function lowerAnswers(input) {
  const respelled = new Map();
  const low = (w) => {
    if (typeof w !== "string") return w;
    const word = w.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (word !== w.toLowerCase()) respelled.set(w, word);
    return word;
  };
  const spec = structuredClone(input || {});
  if (Array.isArray(spec.outcomes)) spec.outcomes = spec.outcomes.map(low);
  spec.otherwise = low(spec.otherwise);
  for (const r of Array.isArray(spec.rules) ? spec.rules : []) if (r) r.then = low(r.then);
  for (const p of Array.isArray(spec.properties) ? spec.properties : []) if (p) p.then = low(p.then);
  for (const e of Array.isArray(spec.examples) ? spec.examples : []) if (e) e.response = low(e.response);
  // A meaning keyed by the answer's LexLean name (measured: GLM wrote `answerA` for answer `a`) is that
  // answer's meaning; only a key that names no answer either way is left for the checker to refuse.
  const answerWord = (k) => { const m = /^answer([A-Z][\w]*)$/.exec(k); return m ? m[1].replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase() : null; };
  if (spec.meanings && typeof spec.meanings === "object") spec.meanings = Object.fromEntries(Object.entries(spec.meanings).map(([k, v]) => [Array.isArray(spec.outcomes) && !spec.outcomes.includes(low(k)) && spec.outcomes.includes(answerWord(k)) ? answerWord(k) : low(k), v]));
  // A choice is respelled the same way, in its field, in every condition on that field, and in every
  // example request that names it.
  const choices = new Map();
  for (const f of Array.isArray(spec.fields) ? spec.fields : []) {
    if (!f || f.kind !== "choice" || !Array.isArray(f.values)) continue;
    f.values = f.values.map((v) => { const w = low(v); if (w !== v) choices.set(v, w); return w; });
    for (const r of [...(Array.isArray(spec.rules) ? spec.rules : []), ...(Array.isArray(spec.properties) ? spec.properties : [])]) for (const c of (r && Array.isArray(r.when) ? r.when : [])) if (c && c.field === f.name && typeof c.value === "string") c.value = low(c.value);
  }
  if (choices.size) for (const e of Array.isArray(spec.examples) ? spec.examples : []) if (e && typeof e.request === "string") e.request = e.request.split(" ").map((t) => choices.get(t) ?? t).join(" ");
  // A field name is one lower-case word: `debt_ratio` becomes `debtratio` wherever a condition names it.
  const renamed = new Map();
  for (const f of Array.isArray(spec.fields) ? spec.fields : []) {
    if (!f || typeof f.name !== "string") continue;
    const word = f.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (word && word !== f.name) { renamed.set(f.name, word); f.name = word; }
  }
  if (renamed.size) {
    const fix = (c) => { if (!c) return; if (renamed.has(c.field)) c.field = renamed.get(c.field); if (c.value && typeof c.value === "object" && renamed.has(c.value.field)) c.value.field = renamed.get(c.value.field); };
    for (const r of [...(Array.isArray(spec.rules) ? spec.rules : []), ...(Array.isArray(spec.properties) ? spec.properties : [])]) for (const c of (r && Array.isArray(r.when) ? r.when : [])) fix(c);
  }
  return { spec, respelled };
}

/** A spec over prism-code's rule limit, checked by Forge: obligations first, the table for every request. */
function checkLarge(input, notes) {
  const pad = (i) => String(i + 1).padStart(3, "0");
  const spec = { examples: [], limits: [], ...input, rules: input.rules.map((r, i) => ({ id: `REQ-${pad(i)}`, ...r })), properties: (input.properties || []).map((p, i) => ({ id: `INV-${pad(i)}`, ...p })) };
  const issues = [];
  const ob = checkObligations(spec);
  let how;
  if (ob.ok && ob.holds) how = `${ob.total} local obligations, each keyed by what it depends on`;
  else {
    // A break the obligations report, or rules they do not cover, is settled exactly, request by request.
    const K = tableKernel(), table = K.build(spec);
    if (table.reason) return { ok: false, issues: [`More than ${PROVE_RULES_MAX} rules, and ${table.reason}, so Forge cannot check every request.`] };
    how = `every one of its ${table.size.toLocaleString()} requests`;
    K.check(spec, table).forEach((c, i) => { if (!c.ok) issues.push(`${spec.properties[i].id} does not hold: \`${c.request}\` answers ${c.outcome}.`); });
  }
  const vectors = acceptanceVectors(spec);
  let failed = 0;
  for (const v of vectors) {
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(v.bytes); } catch { if (v.response !== "invalid") failed++; continue; }
    if (prismAnswer(spec, text) !== v.response) failed++;
  }
  if (failed) issues.push(`The rule module disagrees with ${failed} of ${vectors.length} acceptance vectors. This is a Forge bug.`);
  notes.push(`${spec.rules.length} rules, more than prism-code's ${PROVE_RULES_MAX}: every guarantee was checked by ${how}. Lean proves at most ${PROVE_RULES_MAX} rules until LexLean proves them locally (UOR-Foundation/PrismPM#605).`);
  return { ok: issues.length === 0, spec, issues, notes, vectors: vectors.length, module: issues.length ? null : moduleSource(spec, vectors.length) };
}

export function checkSpec(raw) {
  const issues = [], notes = [];
  const lowered = lowerAnswers(raw);
  let input = lowered.spec;
  if (Array.isArray(input.rules) && input.rules.length > PROVE_RULES_MAX) return checkLarge(input, notes);
  const words = [...lowered.respelled].filter(([a, b]) => b && a !== b);
  if (words.length) notes.push("Forge respelled " + words.map(([a, b]) => `\`${a}\` as \`${b}\``).join(", ") + ", the form Prism words take.");
  // `limits` is a list; a model that writes one sentence means a list of one.
  if (typeof input.limits === "string") { input.limits = [input.limits]; notes.push("Forge made `limits` a list."); }
  // A model may write the otherwise answer as the last rule ({"otherwise": "standard"}); it means the otherwise.
  if (Array.isArray(input.rules)) {
    const stray = input.rules.filter((r) => r && !r.when && typeof r.otherwise === "string");
    if (stray.length) { input.rules = input.rules.filter((r) => !stray.includes(r)); if (!input.otherwise) input.otherwise = stray[stray.length - 1].otherwise; notes.push("Forge read the rule `otherwise` as the answer when no rule matches."); }
  }
  // An example is the model's own word for what the rules answer. One that is not a request, or that the
  // rules answer differently, is set aside and named on the card, so the user sees the disagreement.
  try {
    const bare = validateSpec({ ...input, examples: [] });
    const kept = [];
    for (const e of Array.isArray(input.examples) ? input.examples : []) {
      const request = e && typeof e.request === "string" ? e.request : "";
      if (!decodeRequest(bare, request)) { notes.push(`Set aside example \`${request}\`: it is not a request (${bare.fields.map((f) => f.name).join(" ")}).`); continue; }
      const answer = respond(bare, new TextEncoder().encode(request));
      if (answer !== e.response) { notes.push(`Set aside example \`${request}\` → ${e.response}: these rules answer ${answer}.`); continue; }
      kept.push(e);
    }
    input = { ...input, examples: kept };
  } catch (e) { if (!(e instanceof SpecError)) throw e; }
  let spec;
  try { spec = validateSpec(input); } catch (e) { if (e instanceof SpecError) return { ok: false, issues: [e.message] }; throw e; }
  // A rule no request reaches never decides anything, so dropping it changes no answer; prism-code refuses
  // such a spec, so Forge drops them and says so. unreachableRules names one only after trying every request.
  const dead = unreachableRules(validateSpec({ ...spec, properties: [], examples: [] }));
  if (dead.length) {
    const deadSet = new Set(dead);
    try { spec = validateSpec({ ...input, rules: spec.rules.filter((r) => !deadSet.has(r.id)).map(({ id, says, ...r }) => r) }); }
    catch (e) { if (e instanceof SpecError) return { ok: false, issues: [e.message] }; throw e; }
    notes.push(`Dropped ${dead.length} rule${dead.length === 1 ? "" : "s"} no request reaches: an earlier rule always decides first.`);
  }
  for (const p of spec.properties) {
    const found = counterexample(spec, p);
    if (found.request !== null) issues.push(`${p.id} does not hold: \`${found.request}\` answers ${found.outcome}${found.rule ? ` by ${found.rule}` : " by otherwise"}.`);
  }
  const vectors = acceptanceVectors(spec);
  let failed = 0;
  for (const v of vectors) {
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(v.bytes); } catch { if (v.response !== "invalid") failed++; continue; }
    if (prismAnswer(spec, text) !== v.response) failed++;
  }
  if (failed) issues.push(`The rule module disagrees with ${failed} of ${vectors.length} acceptance vectors. This is a Forge bug.`);
  return { ok: issues.length === 0, spec, issues, notes, vectors: vectors.length, module: issues.length ? null : moduleSource(spec, vectors.length) };
}

// ---- the proof: the LexLean project prism-code sends, proved on the hosted verifier
async function shellText(path) {
  const r = await fetch(new URL(path, import.meta.url));
  if (!r.ok) throw new Error(path + " answered " + r.status);
  return (await r.text()).replace(/\r\n/g, "\n");
}
export async function projectFiles(spec, axioms = {}) {
  const n = names(spec);
  const files = [
    { path: "src/Foundation/Bytes.lex.tex", content: await shellText("./prism/lex/Foundation/Bytes.lex.tex") },
    { path: "src/Foundation/View/Text/V1/Model.lex.tex", content: await shellText("./prism/lex/Foundation/View/Text/V1/Model.lex.tex") },
    { path: `src/${n.module}.lex.tex`, content: renderModel(spec, { axioms, specAddress: sealOf(spec) }) },
  ];
  const proofs = renderProofs(spec, { axioms });
  if (proofs) files.push({ path: `src/${n.proofs}.lex.tex`, content: proofs });
  return files;
}

let rpcId = 0;
const meta = (tasks) => ({
  "io.modelcontextprotocol/protocolVersion": PROTOCOL,
  "io.modelcontextprotocol/clientInfo": { name: "hologram-forge", version: "1" },
  "io.modelcontextprotocol/clientCapabilities": tasks ? { extensions: { "io.modelcontextprotocol/tasks": {} } } : {},
});
function answerOf(text) {
  try { return JSON.parse(text); } catch {}
  let found = null;
  for (const line of text.split("\n")) if (line.startsWith("data:")) { const e = JSON.parse(line.slice(5)); if ("id" in e) found = e; }
  return found;
}
async function rpc(method, name, params) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": PROTOCOL, "mcp-method": method };
  if (name) headers["mcp-name"] = name;
  const body = JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params });
  for (let attempt = 0; ; attempt++) {
    let status = 0, text = "";
    try { const r = await fetch(HOSTED, { method: "POST", headers, body }); status = r.status; text = await r.text(); }
    catch (e) { if (attempt < 2) { await new Promise((r) => setTimeout(r, 10000)); continue; } throw new Error("the verifier did not answer"); }
    if ([502, 503, 504].includes(status) && attempt < 2) { await new Promise((r) => setTimeout(r, 10000)); continue; }
    const answer = answerOf(text);
    if (!answer) throw new Error(`the verifier answered ${method} with HTTP ${status} and no message`);
    if (answer.error) throw new Error(`the verifier refused ${method}: ${answer.error.message || JSON.stringify(answer.error)}`);
    return answer.result;
  }
}
const callTool = (tool, args, tasks = false) => rpc("tools/call", tool, { name: tool, arguments: args, _meta: meta(tasks) });

/** Ask Lean to prove the spec's guarantees. Resolves { ok, record, seconds } or { ok: false, error }. */
export async function prove(spec, { onWait = () => {}, beforeSubmit = () => {}, store = null } = {}) {
  const result = await proveFiles(async (axioms) => { const files = await projectFiles(spec, axioms); return { files, entrypoints: files.map((f) => f.path) }; }, { onWait, beforeSubmit, store, before: () => { if (spec.rules.length > PROVE_RULES_MAX) throw new Error(`These ${spec.rules.length} rules are checked on every request, but Lean proves at most ${PROVE_RULES_MAX} rules today: its proofs are one theorem per guarantee over the whole rule chain. Proving more waits for local proofs in LexLean (UOR-Foundation/PrismPM#605).`); } });
  if (result.ok) { const { seconds, ...rest } = result.record; result.record = { ...rest, properties: spec.properties.map((p) => p.id), seconds }; }
  return result;
}
/**
 * Proves LexLean files on the hosted verifier: every theorem through Lean and leanchecker, each with
 * its exact axioms. `filesFor(axioms)` gives { files, entrypoints } for the axiom sets Lean has named
 * so far (declaration name -> "[a, b]"); a wrong set is corrected from what Lean observed and proved
 * again. With `store` ({ get(key), put(key, value) }), a theorem whose address holds an admitted record
 * (prism/proof-reuse.mjs) is taken out of the files and not proved again; when every theorem is, Lean
 * does not run. Resolves { ok, record, seconds, axioms } or { ok: false, error }.
 */
export async function proveFiles(filesFor, { onWait = () => {}, before = () => {}, beforeSubmit = () => {}, store = null } = {}) {
  before();
  const t0 = Date.now();
  const axioms = {};
  let submitted = false;
  // Reuse only saves time: if deciding it fails (the verifier does not answer a lookup), prove everything.
  const reuse = store ? await reusable(filesFor, safely(store)).catch(() => null) : null;
  if (reuse) Object.assign(axioms, reuse.axioms);
  if (reuse && reuse.theorems.length && reuse.reused.size === reuse.theorems.length) {
    // Every theorem was proved before, on these exact bytes: no Lean run. The files are asked for once
    // more so the caller holds the module under the axiom sets Lean observed.
    await filesFor(axioms);
    // A rolling deployment or revocation during lookup cannot commit a cached verdict.
    if (!sameVerifier(reuse.identity, await verifier().catch(() => null))) return proveFiles(filesFor, { onWait, before, beforeSubmit });
    beforeSubmit();
    const latest = [...reuse.reused.values()].sort((a, b) => String(b.verified_at).localeCompare(String(a.verified_at)))[0];
    const seconds = Math.round((Date.now() - t0) / 1000);
    return { ok: true, seconds, axioms: { ...axioms }, record: { schema: "prism/hosted-verification/2", server: HOSTED, profile: PROFILE, draft: null, entrypoints: [], verified_at: latest.verified_at, attestation_id: latest.attestation_id, attestations: [...new Set([...reuse.reused.values()].map((r) => r.attestation_id))], semantic_id: null, source_id: null, modules: [], theorems: reuse.summary(), proved: 0, reused: reuse.reused.size, seconds } };
  }
  for (let round = 1; round <= 6; round++) {
    const asked = await filesFor(axioms);
    const entrypoints = asked.entrypoints;
    const files = reuse && reuse.reused.size ? without(asked.files, entrypoints, new Set(reuse.reused.keys())) : asked.files;
    if (!submitted) { beforeSubmit(); submitted = true; }
    const written = await callTool("lexlean_draft_write", { profile: PROFILE, files });
    const draft = written && written.structuredContent && written.structuredContent.draft;
    if (!draft || written.isError) return { ok: false, error: "the verifier did not take the draft" };
    let task = await callTool("lexlean_verify", { project: draft, files: entrypoints }, true);
    if (!task || !task.taskId) return { ok: false, error: "the verifier did not start the proof" };
    const taskId = task.taskId;
    while (task.status === "working") {
      if (Date.now() - t0 > 15 * 60 * 1000) return { ok: false, error: "the proof did not end in 15 minutes" };
      await new Promise((r) => setTimeout(r, Math.max(1000, Math.min(task.pollIntervalMs || 5000, 10000))));
      task = await rpc("tasks/get", taskId, { taskId, _meta: meta(true) });
      onWait(Math.round((Date.now() - t0) / 1000));
    }
    if (task.status !== "completed") return { ok: false, error: `the proof ended ${task.status}` };
    const state = task.result && task.result.structuredContent && task.result.structuredContent.state;
    let body = null;
    try { body = JSON.parse((task.result.content && task.result.content[0] && task.result.content[0].text) || "null"); } catch {}
    if (state === "failed") {
      const diagnostics = (body && body.diagnostics) || [];
      // An axiom set the renderer guessed wrong: Lean names the set it observed, as prism-code corrects it.
      const fixes = diagnostics.map((d) => /`([^`]+)` violates its (?:exact|none) axiom policy: observed (\[[^\]]*\])/.exec(d.message || "")).filter(Boolean);
      if (fixes.length && fixes.length === diagnostics.length) { for (const m of fixes) axioms[m[1].split(".").pop()] = m[2]; continue; }
      return { ok: false, error: (diagnostics[0] && diagnostics[0].message) || "Lean refused the proof", diagnostics };
    }
    if (state !== "verified" || !body || !body.attestation_id) return { ok: false, error: "the verifier answered without an attestation" };
    const proved = new Set(body.modules || []);
    const modules = entrypoints.map((p) => p.replace(/^src\//, "").replace(/\.lex\.tex$/, "").split("/").join("."));
    const absent = modules.filter((m) => !proved.has(m));
    if (absent.length) return { ok: false, error: "the verifier did not verify " + absent.join(", ") };
    const verifiedAt = new Date().toISOString();
    if (reuse && reuse.identity?.trust) {
      const authorFiles = files.filter((f) => entrypoints.includes(f.path));
      const records = await Promise.all(reuse.theorems.filter((t) => !reuse.reused.has(t.id)).map((t) => reuseRecord({ theorem: t, address: reuse.address[t.id], verifier: reuse.identity, axioms, authorFiles, draft, attestationId: body.attestation_id, verifiedAt })));
      // A completed proof is filed only under the toolchain that actually attested it.
      // The current gateway's bare found response cannot establish that binding.
      const evidence = await attestation(body.attestation_id).catch(() => null);
      const current = await verifier().catch(() => null);
      const bound = sameVerifier(reuse.identity, current) && records.every((r) => attests(evidence, r.attestation_id, r.trust, r.files.map((f) => f.sha256)));
      if (reuse.reused.size && !bound) return proveFiles(filesFor, { onWait, before, beforeSubmit });
      if (bound) for (const record of records) await reuse.store.put(record.address, record);
    }
    const seconds = Math.round((Date.now() - t0) / 1000);
    const reused = reuse ? reuse.reused : new Map();
    return { ok: true, seconds, axioms: { ...axioms }, record: { schema: "prism/hosted-verification/2", server: HOSTED, profile: PROFILE, draft, entrypoints, verified_at: verifiedAt, attestation_id: body.attestation_id, attestations: [...new Set([body.attestation_id, ...[...reused.values()].map((r) => r.attestation_id)])], semantic_id: body.semantic_id || null, source_id: body.source_id || null, modules: [...proved], theorems: reuse ? reuse.summary() : [], proved: reuse ? reuse.theorems.length - reused.size : null, reused: reused.size, seconds } };
  }
  return { ok: false, error: "the axiom sets did not settle" };
}

// ---- reuse: theorems Lean proved before on the same bytes (prism/proof-reuse.mjs)
// The verifier's identity is part of every address: a proof made by another profile is not reused.
async function verifier() {
  const answer = await callTool("lexlean_profiles", { profile: PROFILE });
  if (!answer || answer.isError) throw new Error("the verifier did not name its profile");
  const s = answer.structuredContent || {};
  const profile = s.id ? s : (Array.isArray(s.profiles) && s.profiles.length === 1 ? s.profiles[0] : null);
  if (!profile || (profile.name && profile.name !== PROFILE) || typeof profile.id !== "string" || !/^[0-9a-f]{64}$/.test(profile.id)) throw new Error("the verifier did not name its profile");
  return { server: HOSTED, profile: PROFILE, profileId: profile.id, trust: trustDescriptor(profile.proof_reuse) };
}
async function attestation(id) {
  const answer = await callTool("lexlean_attestation", { by: "id", value: id });
  return answer && !answer.isError ? answer.structuredContent : null;
}
// A store that fails reads as empty and drops writes: reuse saves time, it never decides a verdict.
const safely = (store) => ({
  get: async (key) => { try { return (await store.get(KEY_PREFIX + key)) ?? null; } catch { return null; } },
  put: async (key, value) => { try { await store.put(KEY_PREFIX + key, value); } catch {} },
});
/**
 * Which theorems of the files `filesFor({})` gives were proved before. A theorem still to be proved that
 * names a reused one needs it in the file, so that one is proved again too. Sends no source: the
 * verifier is asked for its current trust descriptor and each exact attestation.
 */
async function reusable(filesFor, store) {
  const { files, entrypoints } = await filesFor({});
  const authors = files.filter((f) => entrypoints.includes(f.path));
  const theorems = theoremsOf(authors);
  const reused = new Map(), refusals = {}, axioms = {};
  const summary = () => theorems.map((t) => ({ theorem: t.id, address: address[t.id] || null, reused: reused.has(t.id), attestation_id: reused.get(t.id)?.attestation_id ?? null, refusal: refusals[t.id] ?? null }));
  let address = {}, identity = null;
  if (!theorems.length) return { theorems, reused, axioms, summary, store, address, identity };
  identity = await verifier();
  if (!identity.trust) {
    for (const t of theorems) refusals[t.id] = REFUSAL.trustUnavailable;
    return { theorems, reused, axioms, summary, store, address, identity };
  }
  address = await addresses({ files, entrypoints, verifier: identity });
  const headers = headersOf(authors);
  const asked = new Map();
  const found = (id) => {
    if (!asked.has(id)) asked.set(id, attestation(id));
    return asked.get(id);
  };
  for (const t of theorems) {
    const entry = await store.get(address[t.id]);
    const decision = await admit({ entry, theorem: t, address: address[t.id], verifier: identity, headers, found });
    if (decision.admitted) reused.set(t.id, entry); else refusals[t.id] = decision.refusal;
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of theorems) if (!reused.has(t.id)) for (const d of t.reached) {
      const id = `${d.path}#${d.name}`;
      if (d.kind === "theorem" && reused.has(id)) { reused.delete(id); refusals[id] = REFUSAL.needed; changed = true; }
    }
  }
  for (const entry of reused.values()) Object.assign(axioms, entry.axioms);
  return { theorems, reused, axioms, summary, store, address, identity };
}

// ---- the build: the commit prism-code makes on a repository created from UOR-Foundation/template
// prism-code builds an app on GitHub Actions by writing it into a template instance (journey/engine.mjs
// writeTemplateApp, after journey/project.mjs writeApp); the template's pages and bootstrap workflows then
// build the holo in the SDK image and Lean checks every theorem. This is the same commit, made in the tab:
// the writers are prism-code's (prism/template.mjs, prism/render.mjs), the steps around them are ported,
// and tools/prism_template.mjs --check holds the result to prism-code's own, byte for byte.
// `tree` lists the instance's paths; `read(path)` gives the text of one. The result is what to write and
// what to delete; nothing is sent from here.
const RENAMED = ["lexlean.toml", "lakefile.toml", "lake-manifest.json", "prismpm.toml"];
export async function templateCommit({ spec, axioms = {}, attestation = null, repository, tree, read, load = shellText }) {
  const n = names(spec);
  // writeApp: the project files, renamed from prism-code's text-request template.
  const project = {};
  for (const file of RENAMED) {
    let text = (await load("./prism/text-request/" + file)).split("prism-text-request").join(`prism-${spec.name}`).split("PrismTextRequest").join(n.prefix).split("src/TextRequest.lex.tex").join(`src/${n.module}.lex.tex`);
    if (file === "prismpm.toml") text = text.replace('project = "TextRequest"', `project = "${n.module}"`);
    project[file] = text;
  }
  const model = renderModel(spec, { axioms, specAddress: sealOf(spec) });
  const proofs = renderProofs(spec, { axioms });
  const sources = [`src/${n.module}.lex.tex`, ...(proofs ? [`src/${n.proofs}.lex.tex`] : [])];
  // writeTemplateApp: the app under app/, and every file the gate and the page read.
  const out = new Map();
  out.set(`app/src/${n.module}.lex.tex`, model);
  if (proofs) out.set(`app/src/${n.proofs}.lex.tex`, proofs);
  for (const file of ["lakefile.toml", "lake-manifest.json", "prismpm.toml"]) out.set(`app/${file}`, project[file]);
  out.set("app/lexlean.toml", project["lexlean.toml"].replace(/^entrypoints = \[[^\]]*\]$/m, `entrypoints = [${sources.map((p) => JSON.stringify(p)).join(", ")}]`));
  const appFile = async (p) => (out.has(`app/${p}`) ? out.get(`app/${p}`) : read(`app/${p}`));
  const files = {};
  for (const p of ["lexlean.toml", "lake-manifest.json", "lakefile.toml", "lean-toolchain"]) files[p] = await appFile(p);
  out.set("app/lexlean.lock", lexleanLockText(await read("app/lexlean.lock"), files));
  out.set("model/ids.toml", idsToml(spec, await read("model/ids.toml")));
  out.set(`features/suites/${suiteOf(spec)}.feature`, featureText(spec));
  out.set(`crates/conformance/tests/${suiteOf(spec)}.rs`, rustTestText(spec));
  out.set("CONFORMANCE.md", conformanceText(spec, await read("CONFORMANCE.md")));
  const status = { properties: Object.fromEntries(spec.properties.map((p) => [p.id, "proved"])), proved: { attestation } };
  out.set(`openspec/specs/${spec.name}/spec.md`, renderSpecDocument(spec, status));
  out.set("site/app.json", appJson(spec, await read("site/app.json"), { repository, attestation }));
  // The template's example goes, and every model directly under app/src that is not this app's.
  const remove = tree.filter((p) => !out.has(p) && (TEMPLATE_EXAMPLE.includes(p) || /^app\/src\/[^/]+\.lex\.tex$/.test(p)));
  return { files: [...out].map(([path, content]) => ({ path, content })), remove };
}

// ---- what the chat shows
const said = (p) => `It ${p.kind === "never" ? "never" : "always"} answers ${p.then} when ${describeConditions(p.when)}.`;
const PHASE_WORD = { drafting: "not checked", checked: "checked, not yet proved", proving: "Lean is proving", proved: "proved by Lean", published: "proved by Lean, published" };
export function card(state) {
  const spec = state.spec;
  if (!spec) return `**Rules** · not checked\n\n${state.issues.map((i) => "- " + i).join("\n")}\n\nAsk me to fix the rules.`;
  const lines = [`**Rules: ${spec.title}** · ${state.phase === "published" && state.publicationCurrent === false ? "proved by Lean; wording changed since publication" : PHASE_WORD[state.phase] || state.phase}`, "", spec.purpose, ""];
  if (spec.properties.length) {
    lines.push(state.phase === "proved" || state.phase === "published" ? "Guarantees, proved by Lean for every request:" : "Guarantees Lean will prove for every request:");
    spec.properties.forEach((p, i) => lines.push(`${i + 1}. ${said(p)}${p.why ? ` *${p.why}*` : ""}`));
    lines.push("");
  } else lines.push("No guarantees are stated, so Lean has nothing to prove about these rules.", "");
  lines.push("Rules, the first that matches decides:");
  for (const r of spec.rules) lines.push(`- When ${describeConditions(r.when)}: **${r.then}**${r.why ? ` *${r.why}*` : ""}`);
  lines.push(`- Otherwise: **${spec.otherwise}**${spec.otherwiseWhy ? ` *${spec.otherwiseWhy}*` : ""}`, "");
  lines.push(`Request: \`${spec.fields.map((f) => f.name).join(" ")}\` · answers: ${spec.outcomes.join(", ")}, or invalid`);
  if (spec.examples.length) lines.push("", `Examples: ${spec.examples.map((e) => `\`${e.request}\` → ${e.response}`).join(" · ")}`);
  const facets = facetLine(state.facets);
  if (facets) lines.push("", facets);
  if (state.notes && state.notes.length) lines.push("", ...state.notes.map((n) => "*" + n + "*"));
  if (state.issues && state.issues.length) lines.push("", "Not checked:", ...state.issues.map((i) => "- " + i), "", "Ask me to fix the rules.");
  else if (state.phase === "checked" && spec.rules.length > PROVE_RULES_MAX) lines.push("", `Checked on every request: ${(state.notes || []).find((n) => /checked by/.test(n)) || ""}`, "", `Reply **approve** to have Lean's kernel prove the guarantees in this tab. Publishing waits: the published repository proves its model again with the Prism SDK, which proves at most ${PROVE_RULES_MAX} rules today (UOR-Foundation/PrismPM#605).`);
  else if (state.phase === "checked") lines.push("", `Checked: consistent, ${spec.examples.length} examples pass, ${state.vectors} acceptance vectors replayed through the app's rule module.`, "", "Reply **approve** to have Lean's kernel prove the guarantees in this tab. Nothing is sent to a server.");
  return lines.join("\n");
}
export function provingMessage(spec) {
  return `Proving ${spec.properties.length} guarantee${spec.properties.length === 1 ? "" : "s"} in this tab with Lean's kernel. Nothing is sent to a server.`;
}
/** Why rules over the SDK's limit are proved here but not published yet. */
export function publishTooLarge(spec) {
  return `These ${spec.rules.length} rules are proved in this tab, but the published repository proves its model again with the Prism SDK, which proves at most ${PROVE_RULES_MAX} rules today (UOR-Foundation/PrismPM#605). Publishing waits for that.`;
}
export function proofMessage(spec, result) {
  const n = spec.properties.length, count = `${n} of ${n} guarantee${n === 1 ? "" : "s"}`;
  // A proof made in the tab (in-tab/client.mjs): Lean's kernel judged it here and the kernel guest gave the word.
  if (result.ok) return `**Proved in this tab by Lean's kernel.** ${count} hold for every request, in ${result.seconds} s. Lean ${result.record.lean.version}'s kernel ${result.record.factsJudged === result.record.facts ? `judged all ${result.record.facts} facts the proof rests on` : `judged ${result.record.factsJudged} of the ${result.record.facts} facts the proof rests on; the rest it had judged before`}. No server took part. Publishing builds the app on GitHub, where its repository proves the model again with the Prism SDK.`;
  return `**Not proved.** ${result.error}. The rules are back to checked: ask me to change them, or reply **approve** to try again.`;
}
export { requestLimits };
