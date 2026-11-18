#!/usr/bin/env bash
# The C of every Init, Std and Lean module, by Lean 4.32.2's own compiler from the pinned source. The release ships
# IR and .olean files but no C, so each module is compiled again; its imports resolve to the release's .olean files.
# Linking from an archive keeps only the import closure of the driver.
#   bash gen-c.sh            (needs $ELAB/lean4 at the pinned commit; JOBS caps memory, about 1.5 GB each)
set -euo pipefail
work=${ELAB:-$HOME/tlk/elab}
lean=$HOME/.elan/toolchains/leanprover--lean4---v4.32.2/bin/lean
src=$work/lean4/src
out=$work/c
pin=f3b06c705e6c85f5314019d5d3baab0fec5b580c
[ "$(git -C "$work/lean4" rev-parse HEAD)" = "$pin" ] || { echo "lean4 is not at $pin"; exit 1; }
mkdir -p "$out"
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
( cd "$src" && { ls Init.lean Std.lean Lean.lean; find Init Std Lean -name '*.lean'; } ) | sed 's/\.lean$//; s|/|.|g' | sort > "$work/modules.txt"
wc -l < "$work/modules.txt"
start=$(date +%s)
xargs -P "${JOBS:-5}" -I{} bash -c 'one "$@"' _ {} "$lean" "$src" "$out" < "$work/modules.txt"
echo "seconds $(( $(date +%s) - start ))"
ls "$out"/*.c | wc -l
du -sh "$out"
