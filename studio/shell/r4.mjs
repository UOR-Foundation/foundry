// Prism R4 in the studio: whether one model answer may be shown.
//
// The decision is the Prism R4 spec (r4/spec.json, afflom/me app/specs/r4/spec.json at 28dca52),
// evaluated with prism-code's own judge, first match decides. Foundry's kernel holds the same spec as
// a LexLean module whose guarantees Lean proves (app/src/PrismR4.lex.tex); this file holds no rule of
// its own, only the facts a turn reports.
//
// Foundry answers with its own language and reasoning only: its reader compiled with Prism or the
// pinned in-Prism LexLean-R4 .holo Studio. Its grant is empty, so a route to any other model is
// ungranted and R4 refuses it before a byte of the request leaves the tab.
import { judge } from "./prism/spec.mjs";

let specOnce = null, pinOnce = null;
const readJson = (file) => fetch(new URL(file, import.meta.url)).then((r) => { if (!r.ok) throw Object.assign(new Error("The Prism R4 decision could not be read"), { code: "r4Unavailable" }); return r.json(); });
export const r4Spec = () => (specOnce ??= readJson("./r4/spec.json"));
export const r4StudioPin = () => (pinOnce ??= readJson("./r4/lexlean-r4.json"));

/** Foundry grants no route: every route to another model is ungranted. */
export const GRANT = Object.freeze([]);

/** Verify LexLean-R4 .holo archive + parameter blob state against its pin. */
export const r4InprismFacts = (pin, ref, w) => ({
  engine: ref && pin && ref.kappa === pin.archiveKappa && ref.fingerprint === pin.fingerprint ? "match" : ref ? "mismatch" : "missing",
  weights: w === "match" || w === true ? "match" : w === "mismatch" || w === false ? "mismatch" : "missing",
});

/** The R4 request a turn makes ("compiled" for Foundry's reader, "inprism" for pinned LexLean-R4, "routed" outside). */
export function r4Request({ provider, model = "foundry:reader", engine = "match", weights, boundary = "allow" }) {
  if (provider !== "local") return { mode: "routed", engine: "missing", weights: "none", route: GRANT.includes(provider) ? "granted" : "ungranted", boundary };
  if (model === "r4:lexlean-r4") return { mode: "inprism", engine, weights: weights ?? "missing", route: "none", boundary };
  return { mode: "compiled", engine, weights: weights ?? "none", route: "none", boundary };
}

/** R4's outcome for one request: answer, receipt, ask or refuse, with the rule that decided it. */
export async function r4Decide(request) { return judge(await r4Spec(), request); }

/** The words a refused turn shows, by the rule that refused it. */
export function r4Refusal(decision, request) {
  if (request?.mode === "routed" || decision.rule === "REQ-007") return "Foundry answers only with its own language and reasoning, in this browser. A model outside it is not used.";
  if (decision.rule === "REQ-001") return request?.mode === "inprism" ? "LexLean-R4's verified .holo archive could not be checked against its pin, so its answer is not shown." : "Foundry's reader could not be checked against its pin, so its answer is not shown.";
  if (["REQ-002", "REQ-005", "REQ-008"].includes(decision.rule)) return "LexLean-R4's parameter blob in browser storage could not be verified against its pin, so its answer is not shown.";
  return "Prism R4 did not allow this answer to be shown.";
}
