# Lean's elaborator as WebAssembly: measurement spike

**Result: Lean 4.32.2's own elaborator runs as single-threaded 64-bit WebAssembly and gives native Lean's results on
the whole corpus.** It covers 6 modules and 355 declarations: Lean's frontend, `simp`, `omega`, `decide`, `split` and
`induction`.
- **Agreement:** every declaration has the same kind, type hash, proof-term hash and axioms as native Lean.
- **Second check:** every declaration was re-checked by a second, fresh kernel pass in WebAssembly, with 0 refused.
- **Where it ran:** Node 24 on this desktop, under WSL. No browser has run it yet.

Every number below is labelled **measured** (this spike, this desktop) or **estimated**.

**Go or no-go:**
- **Desktop browsers:** go.
- **Android:** go.
- **iPhone and Mac Safari:** no-go for this 64-bit build until Safari ships 64-bit WebAssembly. A 32-bit build fits in memory (measured upper bound below), so that route stays open.

The 360 MB data blocker in `ELABORATOR.md` does not apply to LexLean projects.

## WebAssembly against native Lean (measured)

Run on Node 24.19.0 under WSL, on one desktop.
- **The comparison:** `agree.py` compares per-declaration kind, type hash, value (proof-term) hash and axioms.
- **The timing table:** one module per process, from a cold start: process start, WebAssembly compile, imports, elaboration, then the second kernel pass.
- **Peak memory:** the process's peak resident memory, including that second import.

| Module | Declarations (theorems) | Agree | Elaborate, WASM / native | Second kernel pass, WASM / native | Wall time, WASM / native | Peak memory, WASM / native |
| --- | --- | --- | --- | --- | --- | --- |
| Spike.Tactics | 23 (16) | yes | 3.07 s / 0.64 s | 1.20 s / 0.53 s | 4.92 s / 1.67 s | 1.10 GB / 0.71 GB |
| Leap.Leap | 41 (39) | yes | 1.46 s / 0.39 s | 0.83 s / 0.53 s | 2.85 s / 1.01 s | 1.11 GB / 0.73 GB |
| PrismForgeKernel.InTabKernel | 70 (7) | yes | 1.74 s / 0.31 s | 0.78 s / 0.42 s | 3.14 s / 0.83 s | 1.11 GB / 0.72 GB |
| FoldLaws.Folds | 71 (59) | yes | 1.98 s / 0.53 s | 0.72 s / 0.49 s | 3.30 s / 1.12 s | 1.15 GB / 0.74 GB |
| FoldLaws.Kernels | 108 (107) | yes | 12.53 s / 7.22 s | 1.69 s / 0.88 s | 14.82 s / 8.24 s | 1.17 GB / 0.77 GB |
| FoldLaws.Main | 42 (40) | yes | 2.39 s / 0.72 s | 0.70 s / 0.46 s | 3.64 s / 1.27 s | 1.13 GB / 0.74 GB |

What this says:
- **Speed:** on proof-heavy work WebAssembly is 1.7 times native (`FoldLaws.Kernels`). On small modules it is 3 to 5 times, because importing Init dominates them. That import is the cost that per-declaration reuse and a resident library remove.
- **Memory:** 1.10 to 1.17 GB per module, with the library imported twice (elaboration, then the second kernel pass). That is far under 32-bit WebAssembly's 4 GB. A 32-bit build would use less: it has smaller pointers, and the elaborator alone needs no second import (estimated).
- **Not measured:** Chromium, a phone, the elaborator alone without the second kernel pass, cold-start parts (download, compile, import) separately, warm start and edit to verdict.

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
| UDP and TCP stubs | same, `runtime/uv/{tcp,udp}.cpp` | Five functions newer than Emscripten's stubs |
| A symbol table for `dlsym` | same, `library/ir_interpreter.cpp`, with `elab/gen-symtab.py` | The interpreter finds compiled code by name; WebAssembly cannot. See below |

**The symbol table.** With `interpreter.prefer_native`, Lean's interpreter asks `dlsym` for every compiled
declaration it is about to run. Natively, on this corpus, it asked for 3,063 distinct names: Init's macros, syntax,
unexpanders and the externs they call (measured, with an `LD_PRELOAD` logger).

A miss has two outcomes:
- **An ordinary declaration:** the interpreter runs its IR instead.
- **An `extern`:** it has no IR, so a miss is an error.

The table therefore holds two sets, each with its own C prototype, read from the generated C:
- **Every extern of Init, Std and Lean,** 1,908 names. These are computed by `driver/SymList.lean` from Lean's own environment and mangling, and they make the table correct.
- **The names the native run found,** which make it fast.

Open: a project that uses an Init macro outside the corpus finds no native code and needs that macro's IR. At the
`exported` import level that IR is not loaded, so the module is refused. It is never accepted wrongly. Closing this
means deriving the table from Lean's environment: every declaration that an import-time attribute or `evalConst` can
run. Not done.

`build-wasm.sh` writes the combined diff to `elab/upstream/lean-wasm-elaborator.patch` on every build. None of the
patches changes a native build's behaviour.

## Measurements

| What | Result | Kind |
| --- | --- | --- |
| C of Init, Std and Lean regenerated with Lean 4.32.2 (2,270 modules) | 602 s with 4 jobs; 541 MB of C; identical to `stage0` C on the module compared | measured |
| Elaborator module, linked | about 65 MB `.wasm`; about 12.8 MB `gzip -9` | measured on builds during the spike; the final build's size is in `evidence/` once recorded |
| Library data per LexLean project | 97.7 MB Init + 1.07 MB runtime, public parts | measured sizes; load set from Lean's source |
| Native baseline, 6 modules, 362 declarations | all elaborated; all re-checked by a second kernel pass; 0 refused | measured |
| Native elaboration per module | Tactics 0.48 s, Leap 0.98 s, InTabKernel 0.90 s, Folds 1.25 s, Kernels 10.9 s, Main 1.65 s | measured, WSL, while builds ran |
| WebAssembly verdicts, timings, memory | 0 disagreements over 355 declarations; see the table above | measured, Node 24 |
| Cold start parts, warm start, edit to verdict, declarations per second, Chromium, phone limit | pending | not measured |

The corpus:
- **`Spike.Tactics`:** written for this spike; uses `simp`, `omega`, `decide`, `split` and `induction`.
- **`Leap.Leap`:** a leap-year rule model, `elab/leap/src/Leap.lex.tex`.
- **`PrismForgeKernel.InTabKernel`:** this repository's `app/src/InTabKernel.lex.tex`.
- **`FoldLaws.{Folds,Kernels,Main}`:** LexLean's `examples/fold-laws` at main `6330c8de`.

Each LexLean model was rendered by `lexlean build`, compiled from LexLean main for this spike.

## What is still open

- **Browsers:** the same build in headless Chromium, and under a phone-sized memory limit.
- **Latency:** a resident library, so that an edit pays only for its changed declarations and not for importing Init. Measure warm start and edit to verdict.
- **The symbol table:** derived from Lean's environment, as above.
- **Phones:**
  - Android Chrome is covered by the 64-bit build.
  - iPhone needs Safari to ship 64-bit WebAssembly, or the 32-bit build below.

## A 32-bit build, for Safari

Safari ships 64-bit WebAssembly only in Technology Preview, on Mac and iPhone alike. A 32-bit build is feasible
(estimated). It would not read the official `.olean` bytes, so its library must be produced by the 32-bit build
itself.

**Peak memory under 4 GB: yes, by a wide margin (measured upper bound).**
- **Measured, 64-bit WebAssembly:** each corpus module peaks at 1.10 to 1.17 GB of process memory. That includes Node, the compiled module, and two imports of the library.
- **Estimated, 32-bit:** less, with half-size pointers and no second import in the elaborator alone.
- **The tighter limit is an iPhone tab,** about 1 to 1.5 GB (estimated).

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
- Memory no longer argues against 32-bit; the work does. It needs a 32-bit Init produced and checked against native, and a second build to maintain.

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
