#!/usr/bin/env bash
# GMP and libuv as 64-bit WebAssembly (MEMORY64). 64-bit because an .olean is a compacted heap image with 64-bit
# pointers and Lean's release reads it in place; GMP because the release stores big numbers in GMP's layout. Each is
# built from its upstream release, checked by hash, with generic C (no assembly) and no threads.
#   bash build-deps.sh
set -euo pipefail
work=${ELAB:-$HOME/tlk/elab}
# shellcheck disable=SC1091
source "$HOME/tlk/emsdk/emsdk_env.sh" > /dev/null 2>&1
mkdir -p "$work/deps" && cd "$work/deps"
flags="-O2 -sMEMORY64=1 -fwasm-exceptions"

# GMP 6.3.0, the GNU release tarball.
gmp_sha=a3c2b80201b89e68616f4ad30bc66aee4927c3ce50e33929ca819d5c43538898
[ -f gmp-6.3.0.tar.xz ] || curl -fsSLO https://ftp.gnu.org/gnu/gmp/gmp-6.3.0.tar.xz
echo "$gmp_sha  gmp-6.3.0.tar.xz" | sha256sum -c -
if [ ! -f gmp/lib/libgmp.a ]; then
  rm -rf gmp-6.3.0 && tar xf gmp-6.3.0.tar.xz && cd gmp-6.3.0
  emconfigure ./configure --host=none --build="$(./config.guess)" --disable-assembly --enable-static --disable-shared \
    --prefix="$work/deps/gmp" CFLAGS="$flags" CC_FOR_BUILD=gcc > configure.log 2>&1 || { tail -30 configure.log; exit 1; }
  grep -E '^#define GMP_LIMB_BITS|^#define _LONG_LONG_LIMB' gmp.h
  emmake make -j"${JOBS:-6}" > make.log 2>&1 || { tail -30 make.log; exit 1; }
  emmake make install > /dev/null
  cd ..
fi
grep -E 'GMP_LIMB_BITS' gmp/include/gmp.h | head -2

# libuv v1.48.0 with Lean's one patch, as ../build-libuv.sh, now 64-bit.
if [ ! -f libuv/build/libuv.a ]; then
  [ -d libuv ] || git clone -q --depth 1 --branch v1.48.0 https://github.com/libuv/libuv
  cd libuv && git reset -q --hard HEAD
  python3 - <<'EOF'
import pathlib
p = pathlib.Path("CMakeLists.txt")
t = p.read_text()
anchor = 'if(CMAKE_SYSTEM_NAME STREQUAL "Linux")\n  list(APPEND uv_defines _GNU_SOURCE _POSIX_C_SOURCE=200112)'
assert t.count(anchor) == 1
p.write_text(t.replace(anchor, 'if(CMAKE_SYSTEM_NAME STREQUAL "Emscripten")\n  list(APPEND uv_sources\n       src/unix/no-proctitle.c)\nendif()\n\n' + anchor))
EOF
  emcmake cmake -B build -DCMAKE_BUILD_TYPE=Release -DLIBUV_BUILD_TESTS=OFF -DLIBUV_BUILD_SHARED=OFF \
    -DCMAKE_POSITION_INDEPENDENT_CODE=OFF "-DCMAKE_C_FLAGS=$flags" > build.log 2>&1
  emmake make -C build -j"${JOBS:-6}" uv_a >> build.log 2>&1 || { tail -30 build.log; exit 1; }
  cd ..
fi
ls -l gmp/lib/libgmp.a libuv/build/libuv.a
