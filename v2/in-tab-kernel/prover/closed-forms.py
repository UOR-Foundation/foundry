"""How many of a project's arithmetic theorems does Lean also accept with a proof that needs no proof search?

  python3 closed-forms.py <lean> <LEAN_PATH> <module root> <module.lean> [...]

Each theorem LexLean renders as `simp only [...]; split; omega` is tried, one at a time and in this order, with:
  rfl        the two sides are the same after unfolding: a closed term, `Eq.refl`, which a tab can write
  cases-rfl  the same after splitting each record parameter into its fields
  decide     Lean evaluates a decision procedure for the statement: closed, but needs the instance written out
The first that Lean accepts is recorded; `search` means none did, so the theorem needs omega or simp.
Nothing here is a proof used anywhere: it measures what an elaborator-free prover would have to cover.
"""
import json, os, re, subprocess, sys, tempfile

lean, lean_path, root = sys.argv[1:4]
TRIES = [("rfl", "by intros; rfl"), ("cases-rfl", "by intros; (repeat' cases ‹_›); all_goals rfl"), ("decide", "by decide")]
env = dict(os.environ, LEAN_PATH=lean_path)
report = {}
for path in sys.argv[4:]:
    text = open(path, encoding="utf-8").read()
    # A rendered theorem: `public theorem name ... := by` then indented tactic lines.
    pattern = re.compile(r"(public theorem (\w+)[^\n]*?:= )by\n((?:[ \t]+[^\n]*\n)+)")
    theorems = [(m.group(2), m.span(), m.group(1), m.group(3)) for m in pattern.finditer(text)]
    rows = {}
    for name, (start, end), head, body in theorems:
        if "omega" not in body and "simp only" not in body:
            rows[name] = "as-written:" + ("rfl" if "rfl" in body else "decide" if "decide" in body else "other")
            continue
        rows[name] = "search"
        for label, proof in TRIES:
            trial = text[:start] + head + proof + "\n" + text[end:]
            with tempfile.NamedTemporaryFile("w", suffix=".lean", delete=False, encoding="utf-8") as f:
                f.write(trial); tmp = f.name
            try:
                out = subprocess.run([lean, "-R", root, tmp], capture_output=True, text=True, env=env, timeout=120)
                # Only this theorem's own failure counts: other theorems still carry their real proofs.
                if out.returncode == 0: rows[name] = label; break
            except subprocess.TimeoutExpired:
                pass
            finally:
                os.unlink(tmp)
    report[os.path.basename(path)] = rows
    counts = {}
    for v in rows.values(): counts[v] = counts.get(v, 0) + 1
    print(os.path.basename(path), counts)
json.dump(report, open(os.environ.get("OUT", os.devnull), "w"), indent=1)
