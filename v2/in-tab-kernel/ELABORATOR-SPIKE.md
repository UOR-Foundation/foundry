# Lean's elaborator as WebAssembly: measurement spike

**Status: in progress.** Lean 4.32.2's whole elaborator (frontend, tactics, IR interpreter and kernel) now compiles,
links and initializes as single-threaded 64-bit WebAssembly. The first WebAssembly verdict is not yet measured:
WSL failed one relink before that run. Every number below is labelled **measured** (taken in this spike, on this
desktop) or **estimated**.

**Verdict so far:**
- **Desktop browsers:** go, on the evidence so far.
- **Android:** go, for the same reason.
- **iPhone:** no-go until Safari ships 64-bit WebAssembly, unless the 32-bit route below is built.

The 360 MB data blocker in `ELABORATOR.md` does not apply to LexLean projects.

## The five findings

1. **The library to load is Init, not all of Lean.**
   - **Why the runtime's `import Lean` doesn't count.** LexLean's runtime library does begin with `import Lean`, but as a *private* import of a `module`.
   - **What Lean's source says.** At v4.32.2, `importModulesCore` (`src/Lean/Environment.lean`) does not load a dependency's private imports when the importing file is itself a `module` (import level `exported`, set by `processHeader`). Every module LexLean renders is a `module`.
   - **Measured:**
     - Init's public `.olean` data is 97.7 MB.
     - The three runtime modules' public parts are 1.07 MB (Portable 431,160 bytes, Collections 303,440, Laws 334,312), rebuilt here at 4.32.2.
     - Std (109.6 MB) and Lean (124.4 MB) are not loaded.
   - **Not yet measured:** the WebAssembly run that confirms the loaded set.
2. **An `.olean` is a 64-bit heap image.**
   - **Why the format forces 64-bit.** Lean reads an `.olean` in place, as a compacted region whose pointers are 64-bit. Big numbers in it use GMP's layout, because the release links GMP (measured: `libleanrt.a` references `__gmpz`).
   - **What follows.** A 32-bit WebAssembly build cannot read the official files. The kernel prototype avoided this by reading an NDJSON export.
   - **What this spike does.** It builds 64-bit WebAssembly (`MEMORY64`) with GMP 6.3.0, so the official bytes load unchanged.
   - **Browser support:**
     - Chrome, Edge and Firefox support 64-bit WebAssembly memory, and Node 24 runs it.
     - Safari has it only in Technology Preview 251 and 252 (WebKit release notes, Aug and Sep 2026). Stable iOS Safari does not.
3. **Promises need a task manager.**
   - **The problem.** Lean 4.32.2's frontend uses `IO.Promise`, and `IO.Promise.new` panics when there is no task manager. Upstream's no-thread build therefore cannot run the elaborator.
   - **The patch.** The build keeps the task manager but never starts a thread (`upstream/make-coop-patch.py`): a waiter runs queued tasks itself until its task has a value. `lean_run_main` runs `main` on the calling thread.
   - **The safety property.** A wait that no queued task can satisfy is a panic, never a hang.
   - **Not yet measured:** the full corpus run, which will show whether any real wait hits that panic.
4. **Lean's C and C++ disagree on ten function signatures.**
   - **Why WebAssembly breaks.** The generated C, which is the caller, omits the world argument or a unit argument that the C++ definition still takes, or the two expect different return types. Native x86-64 tolerates this. `wasm-ld` replaces each such call with a trap.
   - **Two of them matter.** `lean_compacted_region_save` and `lean_compacted_region_free` are how an `.olean` is written and freed.
   - **The fix.** `upstream/make-abi-patch.py` changes the C++ side to match the C, and adds three stubs Emscripten lacked.
5. **`lean.h` assumes Emscripten means 32-bit.**
   - **What goes wrong.** Under `LEAN_EMSCRIPTEN` it splits every precomputed 64-bit name hash across two pointer slots. In 64-bit WebAssembly that corrupted every static `Name`, and initialization failed with `unknown parser category 'level'`.
   - **The fix.** The condition now tests pointer width.
   - **Where it stands.** Initialization passes.

## Patches to Lean 4.32.2, all of them

| Patch | File | Why |
| --- | --- | --- |
| Emscripten stub signatures | `upstream/lean-emscripten-stubs.patch` (from the kernel build) | Upstream's stubs no longer match their declarations |
| Cooperative tasks, no threads | `elab/upstream/make-coop-patch.py` (`runtime/object.cpp`, `runtime/thread.cpp`) | Promises need a task manager; a page without isolation has no threads |
| C++ matches the C it is called from | `elab/upstream/make-abi-patch.py` | WebAssembly traps on a signature mismatch |
| Scalar literals by pointer width | same, `include/lean/lean.h` | 64-bit WebAssembly is not 32-bit |
| One code module | same, `runtime/compact.cpp` | WebAssembly has no shared-library list |

`build-wasm.sh` writes the combined diff to `elab/upstream/lean-wasm-elaborator.patch` on every build. None of the
patches changes a native build's behaviour.

## Measurements

| What | Result | Kind |
| --- | --- | --- |
| C of Init, Std and Lean regenerated with Lean 4.32.2 (2,270 modules) | 602 s with 4 jobs; 541 MB of C; identical to `stage0` C on the module compared | measured |
| Elaborator module, linked | about 64.9 MB `.wasm`; 12.8 MB `gzip -9` | measured (size before the last three patches; gzip after) |
| Library data per LexLean project | 97.7 MB Init + 1.07 MB runtime, public parts | measured sizes; load set from Lean's source |
| Native baseline, 6 modules, 362 declarations | all elaborated; all re-checked by a second kernel pass; 0 refused | measured |
| Native elaboration per module | Tactics 0.48 s, Leap 0.98 s, InTabKernel 0.90 s, Folds 1.25 s, Kernels 10.9 s, Main 1.65 s | measured, WSL, while builds ran |
| WebAssembly verdicts, timings, memory | pending | not measured |
| Cold start, warm start, edit to verdict, declarations per second, Chromium, phone limit | pending | not measured |

The corpus:
- **`Spike.Tactics`:** written for this spike; uses `simp`, `omega`, `decide`, `split` and `induction`.
- **`Leap.Leap`:** a leap-year rule model, `elab/leap/src/Leap.lex.tex`.
- **`PrismForgeKernel.InTabKernel`:** this repository's `app/src/InTabKernel.lex.tex`.
- **`FoldLaws.{Folds,Kernels,Main}`:** LexLean's `examples/fold-laws` at main `6330c8de`.

Each LexLean model was rendered by `lexlean build`, compiled from LexLean main for this spike.

## What decides the remaining go or no-go

- **Agreement:** the WebAssembly per-declaration hashes and axioms must equal native on the corpus (`elab/agree.py`).
- **Memory:** the heap must hold about 100 MB of Init plus the elaborator's working set. Estimated 300 to 600 MB per tab; a phone tab is at risk above about 1 GB.
- **Speed:** WebAssembly is usually 1.5 to 3 times slower than native (estimated). That puts `FoldLaws.Kernels` at 16 to 33 s cold, which is why per-declaration reuse matters.
- **Phones:**
  - Android Chrome: covered by the 64-bit build.
  - iPhone, two routes:
    - Wait for Safari to ship 64-bit WebAssembly.
    - Build 32-bit WebAssembly with Init's `.olean` files produced by that 32-bit build itself, addressed by κ and bound to the official sources.

## A 32-bit build, for Safari

Safari ships 64-bit WebAssembly only in Technology Preview, on Mac and iPhone alike. A 32-bit build is feasible
(estimated). It would not read the official `.olean` bytes, so its library must be produced by the 32-bit build
itself.

**Peak heap under 4 GB (estimated, not measured in WebAssembly).**
- **Measured, natively, one module:** 0.72 GB peak resident for `Spike.Tactics`. That includes the 226 MB native binary and the mapped Init files.
- **Measured, natively, all six modules in one process:** 4.76 GB. This number overstates one module's need, for two reasons:
  - Each import stays mapped.
  - The driver's second kernel pass imports everything again.
- **Estimate for one module in 32-bit WebAssembly:** 300 to 700 MB, with 32-bit pointers shrinking both the heap and the library image.
  - All three test modules should fit under 4 GB.
  - An iPhone tab's practical limit is lower than 4 GB, about 1 to 1.5 GB (estimated). The test modules should still fit; the WebAssembly run will settle it.

**What would block 32-bit, and what doesn't:**

| Part | Blocks? | Why |
| --- | --- | --- |
| The official `.olean` files | yes, as bytes | 64-bit pointers, read in place. The 32-bit build must elaborate Init itself (about 600 modules, once per toolchain, estimated tens of minutes under Node) and address the result by κ, bound to the official source and toolchain |
| GMP | no | A 32-bit GMP has 32-bit limbs; that is consistent when the same build writes the `.olean` files. Lean's own big numbers also work without GMP |
| Lean's generated C | no (estimated) | It is written for both widths: offsets are `sizeof(void*)` based, and `LEAN_SCALAR_PTR_LITERAL` has a 32-bit form. Lean's `stage0` C is the same kind of code and is built for 32-bit targets upstream |
| Lean's runtime | no (estimated) | Upstream's own Emscripten build was 32-bit; the kernel prototype here is 32-bit and agrees with native on 14 of 14 inputs |
| Trust | no | The 32-bit Init is accepted only if its per-declaration hashes and axioms equal the native release's (`agree.py`), so nothing is trusted because it was rebuilt |

**Recommendation.**
- Keep 64-bit for desktop and Android, where it loads the official bytes.
- Build 32-bit as the second target for Safari, with its own Init addressed by κ.
- Decide after the WebAssembly memory measurement.

## Reproduce (WSL, no Docker)

```bash
bash v2/in-tab-kernel/elab/gen-c.sh
```

```bash
bash v2/in-tab-kernel/elab/build-deps.sh
```

```bash
bash v2/in-tab-kernel/elab/build-wasm.sh
```

The driver (`elab/driver`) is built natively with `lake build` at Lean 4.32.2 first; its C is linked into the module.
