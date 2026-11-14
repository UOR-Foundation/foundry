// An app's data read from the Lean file the gate writes from a fixture (studio/proof/PrismLive/VerdantRegions.lean):
// rules, guarantees, bounds and the outcome when no rule matches, as live/emit.mjs takes them.
export function appOf(lean, name) {
  const block = (def) => { const m = new RegExp(`def ${def} : [^\\n]* := \\[([\\s\\S]*?)\\]\\n\\n`).exec(lean); if (!m) throw new Error("no " + def); return m[1]; };
  const conds = (s) => [...s.matchAll(/⟨(\d+), (\d+), (\d+)⟩/g)].map((m) => m.slice(1).map(Number));
  const rules = [...block("rules").matchAll(/⟨\[(.*?)\], (\d+)⟩/g)].map((m) => ({ when: conds(m[1]), outcome: Number(m[2]) }));
  const properties = [...block("props").matchAll(/⟨(true|false), \[(.*?)\], (\d+)⟩/g)].map((m) => ({ always: m[1] === "true", when: conds(m[2]), outcome: Number(m[3]) }));
  const bounds = [.../def B : Box := \[(.*)\]/.exec(lean)[1].matchAll(/\((\d+), (\d+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  return { name, bounds, rules, properties, otherwise: Number(/def d : Nat := (\d+)/.exec(lean)[1]) };
}
