#!/usr/bin/env bash
# Lean 4.32.1's kernel as single-threaded WebAssembly: the runtime, util and kernel C++ at the pinned commit, the C of
# the driver's import closure (gen-c.sh), and wasm/entry.cpp. No threads, so no cross-origin isolation is needed.
#   bash build-wasm.sh       (after native.sh and gen-c.sh; needs $TLK/emsdk activated at the pinned version)
# Differences from upstream's Emscripten settings (src/CMakeLists.txt): no -pthread and no LEAN_MULTI_THREAD; no
# GMP and no mimalloc (Lean's own bignums and small-object allocator, as upstream's 32-bit builds use); no libuv
# event loop (runtime/uv compiles to its LEAN_EMSCRIPTEN stubs; libuv itself is linked for io.cpp, build-libuv.sh).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
work=${TLK:-$HOME/tlk}
src=$work/lean4/src
obj=$work/obj
dist=$work/dist
opt=${OPT:--O2}
# shellcheck disable=SC1091
source "$work/emsdk/emsdk_env.sh" > /dev/null 2>&1
emcc --version | head -1
# Two LEAN_EMSCRIPTEN stubs at the pinned commit no longer match their declarations (upstream/).
git -C "$work/lean4" apply --check "$here/upstream/lean-emscripten-stubs.patch" 2> /dev/null && git -C "$work/lean4" apply "$here/upstream/lean-emscripten-stubs.patch"
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
#define LEAN_VERSION_PATCH 1
#define LEAN_VERSION_IS_RELEASE 1
#define LEAN_SPECIAL_VERSION_DESC ""
#define LEAN_VERSION_STRING "4.32.1"
#define LEAN_PLATFORM_TARGET "wasm32-unknown-emscripten"
#define LEAN_MANUAL_ROOT "https://lean-lang.org/doc/reference/4.32.1/"
EOF
echo "#define LEAN_GITHASH \"$(git -C "$work/lean4" rev-parse HEAD)\"" > "$work/gen-include/githash.h"

common="$opt -DNDEBUG -DLEAN_EMSCRIPTEN -DLEAN_EXPORTING -fwasm-exceptions -ffp-contract=off -I$work/gen-include -I$src/include -I$src -I$work/libuv/include"
export common obj

cc_one() { f=$1; o=$obj/c/$(basename "$f" .c).o; [ "$o" -nt "$f" ] || emcc -c $common -Dmain=lake_generated_main -Wno-everything "$f" -o "$o"; }
cxx_one() { f=$1; o=$obj/cpp/$(echo "$f" | sed "s|$2/||; s|/|_|g; s|\.cpp$|.o|"); [ "$o" -nt "$f" ] || em++ -c -std=c++20 $common -DLEAN_BUILD_TYPE=\"Release\" -Wno-everything "$f" -o "$o"; }
export -f cc_one cxx_one

ls "$work"/c/*.c | xargs -P "${JOBS:-10}" -I{} bash -c 'cc_one "$@"' _ {}
# The source lists of runtime/, util/ and kernel/CMakeLists.txt, whole.
{ ls "$src"/runtime/*.cpp "$src"/runtime/uv/*.cpp "$src"/kernel/*.cpp; ls "$src"/util/*.cpp | grep -v -E '/(ffi|shell)\.cpp$'; } \
  | xargs -P "${JOBS:-10}" -I{} bash -c 'cxx_one "$@"' _ {} "$src"
em++ -c -std=c++20 $common -Wno-everything "$here/wasm/entry.cpp" -o "$obj/entry.o"
em++ -c -std=c++20 $common -Wno-everything "$here/wasm/no_interpreter.cpp" -o "$obj/no_interpreter.o"

em++ $opt -fwasm-exceptions "$obj"/c/*.o "$obj"/cpp/*.o "$obj/entry.o" "$obj/no_interpreter.o" "$work/libuv/build/libuv.a" -o "$dist/lean-kernel.mjs" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=67108864 -sMAXIMUM_MEMORY=2147483648 -sSTACK_SIZE=33554432 \
  -sFORCE_FILESYSTEM=1 -sEXPORTED_RUNTIME_METHODS=FS,ccall,cwrap,HEAPU8,wasmMemory -sEXPORTED_FUNCTIONS=_check_whole,_load_library,_check_suffix,_check_keep,_checker_ready,_malloc,_free \
  -sEXIT_RUNTIME=0 -sINVOKE_RUN=0 ${LINK_EXTRA:-}
ls -l "$dist"
gzip -9 -c "$dist/lean-kernel.wasm" | wc -c
sha256sum "$dist/lean-kernel.wasm"
