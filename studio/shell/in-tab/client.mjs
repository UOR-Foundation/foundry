// Proving a rules app in this tab: Lean's kernel in a worker judges proofs the worker writes from the spec, and the
// Forge kernel guest decides the verdict from what the tab derived (InTabKernel.verdictCode). No server takes part.
//
// It is behind a switch. With the switch off, or whenever this does not end in the guest's word `proved`, the
// caller asks the hosted verifier as before.
//
//   inTabProofOn()                       -> whether the switch is on
//   proveInTab(spec, { guest, worker })  -> { ok: true, record, seconds } | { ok: false, why }
// `guest` is the Forge kernel guest (or a promise of it): { dispatch(bytes) -> bytes }.
// `worker` is how a worker is started and its files fetched; the defaults are the shell's own.
import { appOfSpec, statementAddress } from "./spec-app.mjs";
import { verdictWithGuest, verdictAddressWords, verdictAxiomSet } from "../in-tab-verdict-codec.mjs";

/** The record a proof made here leaves. It carries no attestation: none was asked for. */
export const SCHEMA = "prism/in-tab-verification/1";
/** The axioms a proof assembled by Linked.lean rests on. The guest refuses any other set. */
export const AXIOMS = ["propext", "Quot.sound"];
const SWITCH = "forge.proof";

/** On when the page's address says `?proof=tab`, or this browser was told so before. `?proof=hosted` turns it off. */
export function inTabProofOn(location = globalThis.location, storage = globalThis.localStorage) {
  try {
    const asked = new URLSearchParams(location?.search ?? "").get("proof");
    if (asked === "tab" || asked === "hosted") storage?.setItem(SWITCH, asked);
    return (asked ?? storage?.getItem(SWITCH)) === "tab";
  } catch { return false; }
}

const here = (file) => new URL("./" + file, import.meta.url);
const shellWorker = {
  start: () => new Worker(here("worker.mjs"), { type: "module" }),
  bytes: async (file) => { const r = await fetch(here(file)); if (!r.ok) throw new Error(file + " answered " + r.status); return r.arrayBuffer(); },
};

// One worker for the page: its kernel keeps the facts it has judged, so an edited app costs what the edit changed.
let session = null;
async function open({ start, bytes }, readLibrary = false) {
  const worker = start();
  let nextId = 0;
  const ask = (message) => new Promise((resolve, reject) => {
    const id = message.op === "open" ? undefined : ++nextId;
    const on = ({ data }) => { if (id === undefined ? data.op === "open" : data.id === id) { worker.removeEventListener("message", on); resolve(data); } };
    worker.addEventListener("message", on);
    worker.addEventListener("error", (e) => reject(new Error("the proof worker failed: " + (e.message || "it did not start"))), { once: true });
    worker.postMessage({ ...message, id });
  });
  const manifest = JSON.parse(new TextDecoder().decode(await bytes("manifest.json")));
  const [glue, wasm] = await Promise.all([bytes(manifest.glue.file), bytes(manifest.wasm.file)]);
  const kernel = () => ({ op: "open", manifest, glue: glue.slice(0), wasm: wasm.slice(0) });
  // A later visit has the kernel's memory kept by address, and needs no library. A first visit reads it.
  let opened = readLibrary ? { ok: false, need: "library" } : await ask(kernel());
  // After an open that read the library, the worker keeps the kernel's image and says so. A worker ended before
  // that leaves the store half written, and the next visit reads the library again.
  let kept = Promise.resolve();
  if (!opened.ok && opened.need === "library") {
    kept = new Promise((resolve) => { const on = ({ data }) => { if (data.op === "kept") { worker.removeEventListener("message", on); resolve(); } }; worker.addEventListener("message", on); });
    opened = await ask({ ...kernel(), library: await bytes(manifest.library.file) });
  }
  if (!opened.ok) { worker.terminate(); throw new Error(opened.refusal || "the kernel did not open"); }
  const close = async () => { await Promise.race([kept, new Promise((resolve) => setTimeout(resolve, 15000))]); worker.terminate(); };
  return { ask, manifest, via: opened.via, close };
}

export async function proveInTab(spec, { guest, worker = shellWorker, now = () => Date.now() } = {}) {
  const t0 = now(), no = (why) => ({ ok: false, why });
  const read = appOfSpec(spec);
  if (!read.ok) return no(read.why);
  let s, proof;
  try {
    s = await (session ||= open(worker));
    proof = await s.ask({ op: "prove", app: read.app });
    if (proof.need === "library") {
      // The kernel came from its image and the library's bytes were not kept beside it: open again, reading it.
      await s.close();
      s = await (session = open(worker, true));
      proof = await s.ask({ op: "prove", app: read.app });
    }
  } catch (e) { session = null; return no(String((e && e.message) || e)); }
  if (proof.refusal || !proof.evidence) return no(proof.refusal || "the proof worker did not answer");
  const accepted = proof.refused.length === 0 && proof.accepted === spec.properties.length;
  const observed = [...new Set(proof.guarantees.flatMap((g) => g.axioms || []))].sort();
  // What the tab derived, whole: the guest compares each pair. The page reads the pinned addresses from the shell's
  // manifest and derives the statement from the spec; the worker derived the rest from the bytes it was handed.
  let verdict;
  try {
    const word = (address) => verdictAddressWords(address.startsWith("sha256:") ? address : "sha256:" + address);
    verdict = await verdictWithGuest(guest, {
      version: 1, hasBytes: 1,
      libraryPinned: word(s.manifest.library.sha256), libraryDerived: word(proof.evidence.library),
      // The proof is written here, not fetched: there is one address for it, the worker's.
      bundleNamed: word(proof.evidence.bundle), bundleDerived: word(proof.evidence.bundle),
      kernelPinned: word(s.manifest.wasm.sha256), kernelDerived: word(proof.evidence.kernel),
      specStatement: word(statementAddress(read.app)), checkedStatement: word(proof.evidence.statement),
      axiomsDeclared: verdictAxiomSet(AXIOMS), axiomsObserved: verdictAxiomSet(observed),
      leanRan: 1, leanAccepted: accepted ? 1 : 0, secondRan: 0, secondAccepted: 0,
    });
  } catch (e) { return no("the verdict could not be asked: " + String((e && e.message) || e)); }
  if (!verdict.ok) return no("the kernel guest gave no verdict (" + verdict.code + ")");
  if (verdict.verdict !== "proved") {
    const which = proof.refused.map((i) => spec.properties[i]?.id).filter(Boolean);
    return no("the kernel guest said " + verdict.verdict + (which.length ? ": Lean's kernel refused " + which.join(", ") : ""));
  }
  const seconds = Math.round((now() - t0) / 100) / 10;
  return { ok: true, seconds, record: {
    schema: SCHEMA, verdict: verdict.verdict, verified_at: new Date(now()).toISOString(),
    lean: s.manifest.lean, kernel: "sha256:" + proof.evidence.kernel, library: "sha256:" + proof.evidence.library,
    statement: proof.evidence.statement, bundle: "sha256:" + proof.evidence.bundle, axioms: observed,
    properties: spec.properties.map((p) => p.id), facts: proof.facts, factsJudged: proof.factsNew, opened: s.via, seconds,
  } };
}

/** Ends the page's proof worker, and with it the facts its kernel holds. */
export function closeInTabProof() { const s = session; session = null; return s ? s.then((x) => x.close(), () => {}) : Promise.resolve(); }
