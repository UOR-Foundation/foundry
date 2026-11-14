#!/usr/bin/env bash
# The proved checker of studio/proof/PrismLive as a library the in-tab kernel can hold, and Verdant's proof as a
# suffix of it.
#   bash live/build.sh        (WSL; needs lean4export built by ../native.sh's toolchain, and the 4.32.1 toolchain)
#
#   $TLK/live/library.ndjson   regionCheck_sound, certCheck_sound, linked_sound and tab_sound with all they rest on
#   $TLK/live/verdant.ndjson   what VerdantR.all_hold adds: its rules, its guarantees, and the two theorems
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
work=${TLK:-$HOME/tlk}/live
export PATH=$HOME/.elan/toolchains/leanprover--lean4---v4.32.1/bin:$PATH
exporter=${EXPORTER:-$HOME/itp/ext/lean4export/.lake/build/bin/lean4export}
rm -rf "$work"; mkdir -p "$work"
cp -r "$here/../../../studio/proof/." "$work/proof"
cd "$work/proof"
time lake build 2>&1 | tail -3
export LEAN_PATH="$work/proof/.lake/build/lib/lean:$(lean --print-prefix)/lib/lean"
# The per-guarantee theorem that takes its obligations as named (Certified.lean). It is built beside the proved
# checker here and is not one of studio/proof's own roots.
sed 's/\r$//' "$here/Certified.lean" > PrismLive/Certified.lean
lean PrismLive/Certified.lean -o .lake/build/lib/lean/PrismLive/Certified.olean
# The theorem that assembles a guarantee from named facts, evaluating nothing (Linked.lean), built the same way.
sed 's/\r$//' "$here/Linked.lean" > PrismLive/Linked.lean
lean PrismLive/Linked.lean -o .lake/build/lib/lean/PrismLive/Linked.olean
# Every rule a spec can state, as zones (Tab.lean), built the same way.
sed 's/\r$//' "$here/Tab.lean" > PrismLive/Tab.lean
lean PrismLive/Tab.lean -o .lake/build/lib/lean/PrismLive/Tab.olean
printf 'import PrismLive.VerdantRegions\nimport PrismLive.Certified\nimport PrismLive.Linked\nimport PrismLive.Tab\n' > All.lean
lean All.lean -o .lake/build/lib/lean/All.olean
certified="PrismLive.Kernel.certCheck_sound PrismLive.Kernel.allKnown_nil PrismLive.Kernel.allKnown_cons"
for n in linked_sound safe_nil safe_cons never_ok never_apart never_cover allIn_nil allIn_cons inHere inThere \
    ruleBox_intro propBox_intro notBad_intro apart_intro meets_intro coveredBy_intro; do
  certified="$certified PrismLive.Kernel.$n"
done
for n in tab_sound safeAll_nil safeAll_cons safe_nil safe_cons neverAll_nil neverAll_cons never_ok never_cover \
    allIn_nil allIn_cons inHere inThere inLeft inRight zonesOf_intro notBad_intro covers_intro Cond.mk Rule.mk Diff.mk; do
  certified="$certified PrismLive.Tab.$n"
done
# The library's roots: the soundness theorem, then every constant Verdant's proof names that is not Verdant's own,
# so an app's suffix holds the app and nothing else.
"$exporter" All -- PrismLive.Kernel.regionCheck_sound $certified > "$work/core.ndjson"
"$exporter" All -- PrismLive.Kernel.regionCheck_sound $certified VerdantR.all_hold > "$work/first.ndjson"
python3 - "$work" <<'PY'
import json, sys
work = sys.argv[1]
core = open(work + "/core.ndjson").read().splitlines()
first = open(work + "/first.ndjson").read().splitlines()
assert first[:len(core)] == core, "the core export is not a prefix"
names = {}
extra = []
for line in first:
    o = json.loads(line)
    if "str" in o and "in" in o: names[o["in"]] = (names.get(o["str"]["pre"], "") + "." + o["str"]["str"]).lstrip(".")
    if "num" in o and "in" in o: names[o["in"]] = (names.get(o["num"]["pre"], "") + "." + str(o["num"]["i"])).lstrip(".")
def declared(o):
    for kind in ("axiom", "def", "thm", "opaque", "quot", "inductive"):
        if kind in o:
            d = o[kind]
            if kind == "inductive": return [names[t["name"]] for t in d.get("types", [])]
            return [names[d["name"]]]
    return []
for line in first[len(core):]:
    for n in declared(json.loads(line)):
        if not n.startswith("VerdantR"): extra.append(n)
open(work + "/extra-roots.txt", "w").write("\n".join(extra))
print("constants Verdant's proof names beyond the theorem's own closure:", extra)
PY
mapfile -t extra < "$work/extra-roots.txt"
"$exporter" All -- PrismLive.Kernel.regionCheck_sound $certified "${extra[@]}" > "$work/library.ndjson"
"$exporter" All -- PrismLive.Kernel.regionCheck_sound $certified "${extra[@]}" VerdantR.all_hold > "$work/whole.ndjson"
size=$(stat -c %s "$work/library.ndjson")
cmp -s -n "$size" "$work/library.ndjson" "$work/whole.ndjson" || { echo "the library is not a prefix of Verdant's export"; exit 1; }
tail -c +"$((size + 1))" "$work/whole.ndjson" > "$work/verdant.ndjson"
ls -l "$work"/library.ndjson "$work"/verdant.ndjson
gzip -9 -c "$work/library.ndjson" | wc -c
sha256sum "$work/library.ndjson" "$work/verdant.ndjson"
