// Prism R4 in the studio: whether one model answer may be shown.
//
// The decision is the Prism R4 spec (r4/spec.json, afflom/me app/specs/r4/spec.json at 28dca52),
// evaluated with prism-code's own judge, first match decides. Foundry's kernel holds the same spec as
// a LexLean module whose guarantees Lean proves (app/src/PrismR4.lex.tex); this file holds no rule of
// its own, only the facts a turn reports.
//
// Foundry answers with its own language and reasoning only: the model in Prism (the device model,
// whose weights are read back by their verified address) and nothing routed. Its grant is empty, so
// a route to any other model is ungranted and R4 refuses it before a byte of the request leaves the tab.
import { judge } from "./prism/spec.mjs";

let specOnce = null;
export function r4Spec() {
  specOnce ??= fetch(new URL("./r4/spec.json", import.meta.url)).then((r) => {
    if (!r.ok) throw Object.assign(new Error("The Prism R4 decision could not be read"), { code: "r4Unavailable" });
    return r.json();
  });
  return specOnce;
}

/** Foundry grants no route: every route to another model is ungranted. */
export const GRANT = Object.freeze([]);

/**
 * The R4 request a turn makes, from what the studio knows of it. `provider` is the chat's route
 * ("local" for the device model). For the device model, `weightsVerified` says whether its weights
 * were read back by their content address, every block re-derived (the loader's image address), and
 * `engineAddress` is the address of the engine's own bytes; before the model has answered, both are
 * left out and only the route is decided.
 */
export function r4Request({ provider, weightsVerified, engineAddress, boundary = "allow" }) {
  if (provider !== "local") return { mode: "routed", engine: "missing", weights: "none", route: GRANT.includes(provider) ? "granted" : "ungranted", boundary };
  const before = weightsVerified === undefined && engineAddress === undefined;
  return {
    mode: "inprism",
    engine: before || /^(did:holo:)?sha256:[0-9a-f]{64}$/.test(engineAddress ?? "") ? "match" : "missing",
    weights: before || weightsVerified === true ? "match" : "missing",
    route: "none",
    boundary,
  };
}

/** R4's outcome for one request: answer, receipt, ask or refuse, with the rule that decided it. */
export async function r4Decide(request) {
  const spec = await r4Spec();
  return judge(spec, request);
}

/** The words a refused turn shows, by the rule that refused it. */
export function r4Refusal(decision, request) {
  if (request?.mode === "routed" || decision.rule === "REQ-007") return "Foundry answers only with its own language and reasoning, in this browser. A model outside it is not used.";
  if (decision.rule === "REQ-005" || decision.rule === "REQ-008" || decision.rule === "REQ-002") return "The on-device model's weights could not be read back by their address, so its answer is not shown.";
  if (decision.rule === "REQ-001") return "The on-device engine's bytes could not be checked, so its answer is not shown.";
  return "Prism R4 did not allow this answer to be shown.";
}
