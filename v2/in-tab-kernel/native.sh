#!/usr/bin/env bash
# Builds the driver natively with the pinned toolchain, in WSL: the reference the WebAssembly build must agree with.
#   bash v2/in-tab-kernel/native.sh
set -euo pipefail
export PATH=$HOME/.elan/bin:$PATH
here=$(cd "$(dirname "$0")" && pwd)
work=${TLK:-$HOME/tlk}/driver
mkdir -p "$work"
cp "$here/driver/Checker.lean" "$here/driver/lakefile.toml" "$work/"
echo "leanprover/lean4:v4.32.2" > "$work/lean-toolchain"
cd "$work"
lake update
echo "leanprover/lean4:v4.32.2" > lean-toolchain
# lake update adopts lean4export's toolchain file; both are set to v4.32.2, the version LexLean 0.4.3 pins.
echo "leanprover/lean4:v4.32.2" > .lake/packages/lean4export/lean-toolchain
lake build
ls -l .lake/build/bin/checker
