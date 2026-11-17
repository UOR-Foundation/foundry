#!/usr/bin/env bash
# Generates the C of every Lean module the checker links, with Lean 4.32.2's own compiler from the pinned source.
# The release ships no C for Init, Std and Lean, so each module in the driver's import closure is compiled again
# from src/ at the pinned commit; its imports resolve to the release's own .olean files.
#   bash gen-c.sh            (after native.sh; needs $TLK/lean4 at the pinned commit)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
work=${TLK:-$HOME/tlk}
lean=$HOME/.elan/toolchains/leanprover--lean4---v4.32.2/bin/lean
src=$work/lean4/src
out=$work/c
pin=f3b06c705e6c85f5314019d5d3baab0fec5b580c
[ "$(git -C "$work/lean4" rev-parse HEAD)" = "$pin" ] || { echo "lean4 is not at $pin"; exit 1; }
mkdir -p "$out"
python3 "$here/closure.py" "$src" "$here/driver" "$work/driver/.lake/packages/lean4export" > "$work/closure.txt"
one() {
  m=$1; lean=$2; src=$3; out=$4
  [ -s "$out/$m.c" ] && return 0
  setup=$out/$m.setup.json
  echo "{\"name\": \"$m\", \"isModule\": true, \"plugins\": [], \"dynlibs\": [], \"options\": {}, \"importArts\": {}}" > "$setup"
  if ! "$lean" "$src/$(echo "$m" | tr . /).lean" -c "$out/$m.c.partial" --setup "$setup" > "$out/$m.log" 2>&1; then
    echo "FAILED $m"; tail -3 "$out/$m.log"; return 1
  fi
  mv "$out/$m.c.partial" "$out/$m.c"; rm -f "$setup" "$out/$m.log"
}
export -f one
grep -E '^(Init|Std|Lean)(\.|$)' "$work/closure.txt" | xargs -P "${JOBS:-8}" -I{} bash -c 'one "$@"' _ {} "$lean" "$src" "$out"
# The driver and the export reader: the C lake wrote when native.sh built them with the same toolchain.
cp "$work/driver/.lake/build/ir/Checker.c" "$out/Checker.c"
cp "$work/driver/.lake/packages/lean4export/.lake/build/ir/Export/Parse.c" "$out/Export.Parse.c"
ls "$out"/*.c | wc -l
wc -l < "$work/closure.txt"
du -sh "$out"
