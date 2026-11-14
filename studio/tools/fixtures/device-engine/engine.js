// Test fixture, served in place of shell/q/core/engine.js (see loader.js beside it). The answer, a hold
// and the record of what was asked are the page's `__deviceFixture`, which a suite sets with an init script:
//   { answer: "text" | (prompt) => "text", hold: Promise | null, asked: [] }
const ENGINE = "sha256:" + "e".repeat(64);
const fixture = () => (globalThis.__deviceFixture ??= { asked: [] });
export async function engineKappa() { return ENGINE; }
export async function createEngine(entry) {
  // A token is four characters, as the studio's meter counts them; ids index the pieces seen so far.
  const pieces = [], index = new Map();
  const id = (piece) => { if (!index.has(piece)) { index.set(piece, pieces.length); pieces.push(piece); } return index.get(piece); };
  const enc = { encode: (text) => (String(text).match(/[\s\S]{1,4}/g) || []).map(id) };
  const dec = { decode: (ids) => [...ids].map((i) => pieces[i]).join("") };
  return {
    bosId: null,
    tokenize: (text) => enc.encode(text),
    async generate(ids, { maxNew = 256, onToken, signal } = {}) {
      const f = fixture();
      const prompt = dec.decode(ids);
      // The studio measures a model once it is resident ("Say ready."): that is no turn of the chat,
      // so it is neither recorded nor held.
      const probe = prompt === "user: Say ready.";
      if (!probe) (f.asked ??= []).push(prompt);
      // A held answer waits for its release, or for the turn's stop, as the engine stops between steps.
      if (f.hold && !probe) await Promise.race([f.hold, new Promise((r) => signal?.addEventListener("abort", r, { once: true }))]);
      if (signal?.aborted) return { text: "", ids: [...ids], outIds: [] };
      const answer = probe ? "Ready." : String(typeof f.answer === "function" ? f.answer(prompt) : f.answer ?? "Answered.");
      const words = answer.match(/\S+\s*|\s+/g) || [];
      let text = "";
      for (const w of words) {
        if (signal?.aborted) break;
        text += w;
        onToken?.({ text, stats: { tokps: 100 } });
        await new Promise((r) => setTimeout(r, 0));
      }
      const outIds = enc.encode(text).slice(0, maxNew);
      return { text, ids: [...ids, ...outIds], outIds };
    },
    async buildReceipt({ promptText, turnIds, outIds, paramsPatch } = {}) {
      const text = dec.decode(outIds || []);
      return { id: `fixture-${Date.now()}`, text, promptText, ctxIds: [], turnIds, outIds, params: paramsPatch || {}, body: { "prov:used": { "holo:engine": ENGINE, "holo:model": `fixture:${entry.fam}` } } };
    },
  };
}
