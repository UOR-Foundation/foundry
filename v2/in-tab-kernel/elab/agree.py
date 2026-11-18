"""Native and WebAssembly agree when, for every module, both elaborated it, the second kernel pass refused nothing,
and every declaration has the same kind, type hash, value hash and axioms. Timings are reported, never compared.
Usage: python3 agree.py native.jsonl wasm.jsonl
"""
import json
import sys


def load(path):
    out = {}
    for line in open(path):
        line = line.strip()
        if line.startswith("{"):
            j = json.loads(line)
            out[j["module"]] = j
    return out


native, wasm = load(sys.argv[1]), load(sys.argv[2])
bad = 0
for mod in sorted(set(native) | set(wasm)):
    a, b = native.get(mod), wasm.get(mod)
    if a is None or b is None:
        print(f"{mod}: missing in {'native' if a is None else 'wasm'}")
        bad += 1
        continue
    da = {d["name"]: d for d in a.get("decls", [])}
    db = {d["name"]: d for d in b.get("decls", [])}
    diff = [n for n in sorted(set(da) | set(db)) if da.get(n) != db.get(n)]
    ok = a["elaborated"] and b["elaborated"] and a.get("replayRefused") is None and b.get("replayRefused") is None and not diff
    bad += not ok
    theorems = sum(1 for d in da.values() if d["kind"] == "theorem")
    print(f"{mod}: {'agree' if ok else 'DISAGREE'}; {len(da)} declarations, {theorems} theorems; "
          f"elab native {a.get('elabMs')} ms, wasm {b.get('elabMs')} ms; replay native {a.get('replayMs')} ms, wasm {b.get('replayMs')} ms")
    for n in diff[:5]:
        print(f"  {n}: native {da.get(n)} wasm {db.get(n)}")
print(f"{bad} disagreements")
sys.exit(1 if bad else 0)
