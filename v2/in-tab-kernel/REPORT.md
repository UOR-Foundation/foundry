# Lean 4.32.1's own kernel in WebAssembly: Phase 1

Lean 4.32.1's C++ kernel now builds as single-threaded WebAssembly and gives the verdict native Lean gives on all 14
inputs the earlier experiments used (7 accepted, 7 refused). The module is 2.22 MB (418 KB gzip). With the pinned
library resident, a whole project is judged in 42 to 136 ms.

The first table of timings is under Node 22.22.1 in WSL on one desktop. The second is one Chromium tab on the same
desktop. No Firefox, Safari or phone has run it.

## What was built

- **The kernel is Lean's.** `src/kernel`, `src/runtime` and `src/util` at commit `f054605a` (tag v4.32.1), compiled
  with Emscripten 6.0.13. No threads, so no cross-origin isolation headers are needed.
- **Only the kernel's slice of Lean is linked.** The driver (`driver/Checker.lean`) imports `Lean.Environment` and
  lean4export's reader. Its import closure is 777 modules (601 Init, 138 Std, 36 Lean), not the elaborator.
  `gen-c.sh` regenerates their C with Lean 4.32.1's own compiler from the pinned source.
- **The replay is Lean's.** It is `Lean.Environment.replay` with its imports trimmed. Every declaration goes to
  `Kernel.Environment.addDeclCore`, which is `lean_add_decl`.

## Changes to Lean, all of them

| Change | Where | Why |
| --- | --- | --- |
| No `-pthread`, no `LEAN_MULTI_THREAD` | build flags | Upstream's Emscripten settings hard-code threads |
| Two stub signatures corrected | `upstream/lean-emscripten-stubs.patch` | The `LEAN_EMSCRIPTEN` stubs no longer match their declarations, so the build does not compile |
| `Lean.reduceBool` / `reduceNat` refuse | `wasm/no_interpreter.cpp` | They run compiled code through the IR interpreter, which is not linked. The hook throws, so it can only refuse |
| Kernel refusals name their kind and constant, not the terms | `driver/Checker.lean` | Printing terms needs the elaborator's printer |

libuv v1.48.0 is linked for `runtime/io.cpp`, built as Lean's own recipe builds it (`build-libuv.sh`).

The linker reports two signature mismatches, `lean_io_create_tempfile` and `lean_io_create_tempdir`. The checker
never calls them; a call would trap.

## Agreement

`node agree.mjs`: 14 inputs, 0 disagreements between the arena's official checker with all of Lean
(`../serverless-prove/evidence/lean-kernel.json`), this driver native, this driver as WebAssembly judging the whole
file, and as WebAssembly with the library resident.

The refused inputs are the earlier experiments' planted faults: a proof by `sorry`, false and altered statements,
altered definitions and a missing type. nanoda was not re-run here; the earlier report records that it matched the
official checker on the same 14.

An axiom outside the allowed list is not among these inputs. The kernel accepts any declared axiom; refusing one is
the verdict's job, from the axiom report below.

## Measurements (Node, desktop)

| What | Result |
| --- | --- |
| Module | 2,224,621 bytes; 417,809 gzip. `sha256:bb0ce35a…` |
| Time to ready (instantiate and initialize) | 14 to 57 ms |
| Whole file, every declaration (about 5,250) | 6.7 to 8.8 s; 92 MB. Native: 6.5 to 8.9 s |
| Library made resident (25.7 MB, 5,041 declarations) | 1.35 to 1.96 s, once per worker; 77 MB |
| Project over the resident library (about 180 declarations sent to the kernel) | median 42 to 136 ms, worst 151 ms; 77 MB |

## In a browser tab (Chromium 156, desktop)

`web/bench.html` in a module worker, served with no isolation headers (`crossOriginIsolated` false, no
`SharedArrayBuffer`) and with the worker's network closed (`connect-src 'none'`). Summary in `evidence/browser.json`.

| What | Result |
| --- | --- |
| Verdicts | 14 of 14 agree with native Lean |
| Open: hash three files, initialize, make the library resident | 2.1 to 2.6 s, of which the library is 1.9 to 2.3 s; 77 MB |
| Project over the resident library, median of 7 | 58 to 163 ms; worst single run 223 ms |
| One project from nothing, every declaration | 10.4 s; 92 MB |
| Altered bundle, altered library, altered kernel | each refused before the kernel ran |

The worker re-derives the SHA-256 of the loader, the kernel and the library before using any of them, and of each
bundle before the kernel reads it. The loader is given the checked bytes through `instantiateWasm`; left alone it
fetches the module from beside itself, which the closed network refused.

A run with a phone's viewport and user agent on the same CPU gave the same verdicts and similar times. It says nothing
about a phone's speed or memory.

**Resident library.** The library is entered with the kernel's own `addDeclWithoutChecking`; inductive types are
still checked. That is sound only for bytes this same kernel has judged whole, so the library's address must be
recorded together with the kernel's when the library is checked at build time. The spec's reuse rule states this.

## Axioms and the library binding

Both were open after Phase 1 and are now built into the prototype.

- **Axioms.** The kernel admits any declared axiom, so after it accepts a suffix the driver reports, for each theorem
  the suffix adds, every axiom it rests on, read from the kernel's own environment (`axiomsOf`). On the two test
  projects the report equals what LexLean's attestation observed, for all 7 theorems the attestation lists
  (`evidence/axioms.json`, `axioms-agree.py`). The worker returns the report; FA-86's verdict takes it as the observed
  axiom set. What each library constant rests on is kept between checks, so the report does not walk the library
  again.
- **Binding.** `bind-library.mjs` has the WebAssembly kernel judge the whole library, 5,038 declarations, and records
  the kernel's, the loader's and the library's address together (`evidence/library-binding.json`). `make-dist.mjs`
  refuses to make a dist without a binding for exactly those three, and the worker refuses to open without one. When
  the kernel was rebuilt, the stale binding was refused until the library was judged again.

With both in place, one Chromium 156 tab on the same desktop: open 1.33 s (library 1.21 s), 77 MB; a project over
the resident library, axioms included, median 35 to 89 ms, worst single run 125 ms; 14 of 14 verdicts agree; the
four address faults, an unbound library among them, are refused. The module is now 2.23 MB, 419 KB gzip
(`sha256:c1300379…`); the sizes and hash earlier in this report are of the build before these two changes.

## The prover (GitHub Actions)

A new app's proof terms come from an untrusted prover, `prover/prove.sh`, which `.github/workflows/in-tab-proof.yml`
runs after verifying the app in the locked SDK image. The tab believes nothing it writes: it re-derives the suffix's
address and the kernel judges every declaration.

- **What it does.** It elaborates the project's rendered Lean modules with Lean 4.32.1, exports them after the
  library's roots, checks that the pinned library export is a byte prefix, and keeps the rest as `suffix.ndjson`.
- **Measured locally (WSL), two projects.** 21 and 32 s each. Both suffixes are byte for byte the ones the earlier
  experiment captured from the SDK image, and the native kernel accepted both over the resident library.
- **It needs a library pack.** `lexlean verify` publishes the runtime library without its `.olean.server` and
  `.olean.private` parts, and a module cannot be imported without them. `prover/make-pack.sh` packs them from a
  staging capture: 7.4 MB, the same bytes from two projects' captures (`sha256:69718022…`). LexLean publishing these
  itself is upstream request 2 of `../serverless-prove/UPSTREAM.md`.
- **Not run.** The workflow has not run on GitHub; it is started by hand and nothing calls it. No pack, kernel or
  library is published anywhere.

## The spec

`app/src/InTabKernel.lex.tex`: the verdict, the axiom rule, address binding, reuse, the two words and the fallback, 15
theorems. `app/src/InTabKernelProtocol.lex.tex` is its wire, and `ForgeKernel.dispatch` answers `verdict` requests
with it, so the app's own guest decides the verdict (capability FA-86). Lean proved both modules on the hosted
verifier. The guest has not been built from them locally: `prismpm verify` timed out in the SDK image, and CI's
`just vv` is the authority. The record is `verification/in-tab-kernel-verdict.md`.

## Not established

- Firefox, Safari, and any phone. Memory of 77 to 92 MB has not been tried in iOS Safari.
- The prover's workflow on a GitHub runner, and how the studio fetches its artifact. Today the studio still calls
  the hosted verifier, which returns an attestation and no kernel terms.
- First-visit download: the library is 4.07 MB gzip, the module 0.42 MB.
- The 1.4 to 2.0 s library load on a phone. Most of it is reading 25.7 MB of NDJSON.
- Lean 4.32.1's kernel has a known soundness bug (lean4#14576, fixed in 4.33.1). This build has it too.

## Reproduce (WSL)

```bash
bash v2/in-tab-kernel/native.sh
```

```bash
bash v2/in-tab-kernel/gen-c.sh
```

```bash
bash v2/in-tab-kernel/build-libuv.sh
```

```bash
bash v2/in-tab-kernel/build-wasm.sh
```

`gen-c.sh` needs Lean's source at the pinned commit in `$TLK/lean4` and `build-wasm.sh` needs Emscripten 6.0.13 in
`$TLK/emsdk` (`TLK` defaults to `~/tlk`). The inputs come from the serverless-prove experiment's uncommitted `dist/`
(`stage-inputs.sh`).

## Lean 4.32.2 (soundness release)

Lean 4.32.2 fixes a nested-inductive kernel soundness issue, leanprover/lean4#14576, and LexLean 0.4.3 pins it, so the kernel moves with it. The scripts here now build at tag v4.32.2, commit `f3b06c705e6c85f5314019d5d3baab0fec5b580c`. Nothing else in the recipe changed. The Emscripten stubs patch, libuv v1.48.0, Emscripten 6.0.13 and the flags are as before.

- The module is 2,235,146 bytes, 427,404 with `gzip -9`. Its UOR κ-label (BLAKE3) is `blake3:2f254140590074724ca1a8033080e0ae0834a018e06481ad7ccf7de9b80f175a`.
- The loader is 62,389 bytes, κ-label `blake3:ec13d669b62c9a0223a937e04c3df18235fa67878ca53ba926f75904fe9c4610`.
- The official checker (`../serverless-prove/official`) was rebuilt with the v4.32.2 toolchain. `evidence/native.json` and `evidence/wasm.json` are this build's.

`node agree.mjs` covers the 14 inputs. Lean's official kernel, this driver native, and this driver as WebAssembly (whole, and with the library resident) give 7 accepted, 7 refused, 0 disagreements. With the library resident, a project is judged in a median of 48 to 93 ms, worst 105 ms, 77 MB, under Node in WSL.

**Not yet at 4.32.2:**
- **Inputs:** the 14 inputs and the resident library are the earlier experiments' exports, made with Lean 4.32.1's lean4export. This run therefore holds the 4.32.2 kernel to the same verdicts on the same bytes; it does not re-export them.
- **The studio bundle:** `studio/shell/kernel/lean/` is the library with the `PrismLive` roots, plus `kernel.holo`. It is rebuilt from the model, compiled by LexLean 0.4.3 in the SDK image, and waits for that image.
