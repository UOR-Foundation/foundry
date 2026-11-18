#!/usr/bin/env bash
# Lean 4.32.2's elaborator, kernel and IR interpreter as single-threaded 64-bit WebAssembly, with the spike's driver.
# What is linked: runtime, util, kernel, library, initialize (Lean's own C++ at the pinned commit), the C of Init, Std
# and Lean (gen-c.sh, linked from an archive so only the driver's import closure stays), the driver's C, GMP, libuv.
# Differences from upstream's Emscripten settings (src/CMakeLists.txt), each recorded in ELABORATOR-SPIKE.md:
#   MEMORY64, so the release's .olean files load unchanged; no -pthread; LEAN_MULTI_THREAD kept for the task manager,
#   with LEAN_COOP_TASKS (upstream/make-coop-patch.py) so it never starts a thread; no mimalloc, Lean's own allocator.
#   bash build-wasm.sh       (after gen-c.sh, build-deps.sh, and the driver built natively with lake)
#   TARGET=node (default) reads the real file system (NODERAWFS); TARGET=web builds the page's module.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
work=${ELAB:-$HOME/tlk/elab}
src=$work/lean4/src
target=${TARGET:-node}
obj=$work/obj
dist=$work/dist-$target
opt=${OPT:--O2}
# shellcheck disable=SC1091
source "$HOME/tlk/emsdk/emsdk_env.sh" > /dev/null 2>&1
emcc --version | head -1

# The pinned source, patched: the Emscripten stubs (../upstream) and the cooperative task manager (upstream/).
git -C "$work/lean4" checkout -q -- src
git -C "$work/lean4" apply "$here/../upstream/lean-emscripten-stubs.patch"
python3 "$here/upstream/make-coop-patch.py" "$src/runtime/object.cpp"
python3 "$here/upstream/make-abi-patch.py" "$src"
git -C "$work/lean4" diff > "$here/upstream/lean-wasm-elaborator.patch"
git -C "$work/lean4" diff --stat | tail -1

mkdir -p "$obj/c" "$obj/cpp" "$dist" "$work/gen-include/lean"
cat > "$work/gen-include/lean/config.h" <<'EOF'
#pragma once
#include <lean/version.h>
#define LEAN_SMALL_ALLOCATOR
#define LEAN_IS_STAGE0 0
EOF
cat > "$work/gen-include/lean/version.h" <<'EOF'
#pragma once
#define LEAN_VERSION_MAJOR 4
#define LEAN_VERSION_MINOR 32
#define LEAN_VERSION_PATCH 2
#define LEAN_VERSION_IS_RELEASE 1
#define LEAN_SPECIAL_VERSION_DESC ""
#define LEAN_VERSION_STRING "4.32.2"
#define LEAN_PLATFORM_TARGET "wasm64-unknown-emscripten"
#define LEAN_MANUAL_ROOT "https://lean-lang.org/doc/reference/4.32.2/"
EOF
echo "#define LEAN_GITHASH \"$(git -C "$work/lean4" rev-parse HEAD)\"" > "$work/gen-include/githash.h"

common="$opt -sMEMORY64=1 -DNDEBUG -DLEAN_EMSCRIPTEN -DLEAN_MULTI_THREAD -DLEAN_COOP_TASKS -DLEAN_USE_GMP -DLEAN_EXPORTING -fwasm-exceptions -ffp-contract=off -I$work/gen-include -I$src/include -I$src -I$work/deps/gmp/include -I$work/deps/libuv/include"
export common obj

cc_one() { f=$1; o=$obj/c/$(basename "$f" .c).o; [ "$o" -nt "$f" ] || emcc -c $common -Wno-everything "$f" -o "$o"; }
cxx_one() { f=$1; o=$obj/cpp/$(echo "$f" | sed "s|$2/||; s|/|_|g; s|\.cpp$|.o|"); [ "$o" -nt "$f" ] || em++ -c -std=c++20 $common -DLEAN_BUILD_TYPE=\"Release\" -Wno-everything "$f" -o "$o"; }
export -f cc_one cxx_one

ls "$work"/c/*.c | xargs -P "${JOBS:-6}" -I{} bash -c 'cc_one "$@"' _ {}
rm -f "$obj/libmods.a"; ls "$obj"/c/*.o | xargs emar rcs "$obj/libmods.a"
{ ls "$src"/runtime/*.cpp "$src"/runtime/uv/*.cpp "$src"/kernel/*.cpp "$src"/library/*.cpp "$src"/library/constructions/*.cpp "$src"/initialize/*.cpp
  ls "$src"/util/*.cpp | grep -v -E '/shell\.cpp$'; } | xargs -P "${JOBS:-6}" -I{} bash -c 'cxx_one "$@"' _ {} "$src"
emcc -c $common -Wno-everything "$work/driver/.lake/build/ir/Elab.c" -o "$obj/Elab.o"
emcc -c $common -Wno-everything "$here/wasm-entry.c" -o "$obj/wasm-entry.o"
# dlsym's stand-in: every module initializer the archive defines (gen-symtab.py).
emnm --defined-only -g "$obj/libmods.a" 2> /dev/null | awk '$2=="T"{print $3}' > "$obj/defsyms.txt"
python3 "$here/gen-symtab.py" "$obj/defsyms.txt" "$work/c" "$work/externs.txt" "$work/dlsym-native.log" "$obj/symtab.c"
emcc -c $common -Wno-everything "$obj/symtab.c" -o "$obj/symtab.o"

[ "$target" = web ] && EXPORTS=",_elab_ready,_elab_request"
if [ "$target" = node ]; then ext=js; fs="-sNODERAWFS=1 -sENVIRONMENT=node -sEXIT_RUNTIME=1 --pre-js $here/node-env.js"; else
  # The worker keeps one Lean for the life of the tab: wasm-entry.c initializes it once and serves requests.
  ext=mjs; fs="$obj/wasm-entry.o -sFORCE_FILESYSTEM=1 -sENVIRONMENT=web,worker -sMODULARIZE=1 -sEXPORT_ES6=1 -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 -sEXPORTED_RUNTIME_METHODS=FS,ENV,ccall"; fi
em++ $opt -sMEMORY64=1 -fwasm-exceptions "$obj/Elab.o" "$obj/symtab.o" "$obj"/cpp/*.o "$obj/libmods.a" \
  "$work/deps/gmp/lib/libgmp.a" "$work/deps/libuv/build/libuv.a" -o "$dist/lean-elab.$ext" \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=268435456 -sMAXIMUM_MEMORY=8589934592 -sSTACK_SIZE=67108864 -sEXPORTED_FUNCTIONS=_main,_malloc,_free${EXPORTS:-} $fs ${LINK_EXTRA:-}
ls -l "$dist"
gzip -9 -c "$dist/lean-elab.wasm" | wc -c
