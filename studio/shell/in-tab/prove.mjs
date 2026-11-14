// Proves an app's guarantees with one kernel that holds the proved checker's library: live/Linked.lean's way. Every
// evaluation is a fact judged once and kept by its address; every guarantee is assembled from facts and judged.
// The same code runs in the tab's worker (web/worker.mjs) and under Node (live/linked.mjs).
//
//   prover(call, libraryText) -> { prove(app, links?), keep(facts, tally), library, resident }
//   call(entry, text) -> { exit, ms, axioms, output }: the kernel's `check_keep` and `check_suffix` on a suffix;
//                        exit 0 is accepted, and nothing else is.
//   prove(app) -> { guarantees: [{ accepted, kernelMs, axioms } per guarantee], accepted, refused: [index...],
//                   facts, factsNew, factsReused, newByKind, factMs, glueMs, writeMs, totalMs }
// The statement judged for guarantee i is written here from `app`, and is
//   <app.name>.g<i>.holds : ∀ x, inBox bounds x = true → breaks rules otherwise guarantee x = false
import { readLibrary, extendLibrary, linkFacts, linkedProof } from "./emit.mjs";
import { linksOf } from "./certs.mjs";

export function prover(call, libraryText) {
  const library = readLibrary(libraryText);
  const resident = new Set();   // the addresses of the facts the kernel holds
  const round = (x) => Math.round(x * 10) / 10;

  // Has the kernel judge the facts not yet resident, in one suffix, and keeps them. False if it refuses: then none
  // of them is resident.
  function keep(facts, tally) {
    const fresh = facts.filter((f) => !resident.has(f.key));
    tally.factsReused += facts.length - fresh.length;
    if (!fresh.length) return true;
    let t = performance.now(); const text = linkFacts(library, fresh); tally.writeMs += performance.now() - t;
    const v = call("check_keep", text); tally.factMs += v.ms; tally.said = v.output;
    if (v.exit !== 0) return false;
    t = performance.now(); extendLibrary(library, text); tally.writeMs += performance.now() - t;
    for (const f of fresh) { resident.add(f.key); tally.newByKind[f.kind] = (tally.newByKind[f.kind] ?? 0) + 1; }
    tally.factsNew += fresh.length;
    return true;
  }

  // The facts that hold whatever the guarantees say go first, in one suffix; then, guarantee by guarantee, the
  // coverings it needs, and its assembly. A guarantee whose coverings are refused is refused.
  function prove(app, given) {
    let t = performance.now(); const links = given ?? linksOf(app);
    const r = { guarantees: [], accepted: 0, refused: [], facts: links.facts.size, factsNew: 0, factsReused: 0, newByKind: {}, factMs: 0, glueMs: 0, glueBytes: 0, writeMs: performance.now() - t };
    const refuse = (i, why) => { r.refused.push(i); r.guarantees[i] = { accepted: false, why }; };
    if (!keep([...links.facts.values()].filter((f) => f.kind !== "covers"), r)) app.properties.forEach((_, i) => refuse(i, "a fact about the rules or the guarantees was refused: " + r.said));
    else links.guarantees.forEach((g, i) => {
      if (!keep(g.steps.filter((s) => s.how === "cover").map((s) => links.facts.get(s.covers)), r)) return refuse(i, "a covering it needs was refused");
      let text;
      t = performance.now(); try { text = linkedProof(library, app, i, links); } catch (e) { return refuse(i, e.message); } r.writeMs += performance.now() - t;
      const v = call("check_suffix", text); r.glueMs += v.ms; r.glueBytes += text.length;
      if (v.exit !== 0) return refuse(i, v.output);
      r.accepted++; r.guarantees[i] = { accepted: true, kernelMs: round(v.ms), axioms: v.axioms[app.name + ".g" + i + ".holds"] ?? null };
    });
    delete r.said;
    r.totalMs = round(r.factMs + r.glueMs + r.writeMs); r.factMs = round(r.factMs); r.glueMs = round(r.glueMs); r.writeMs = round(r.writeMs);
    return r;
  }
  return { prove, keep, library, resident };
}
