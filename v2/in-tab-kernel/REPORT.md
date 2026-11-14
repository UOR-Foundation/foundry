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

## Proving an app with no server and no elaborator

What the hosted verifier does for an app built in Foundry can be done in the tab for the apps Foundry builds, by
Lean's own kernel. The probe is in `live/`; nothing in the studio uses it, and no browser has run it yet.

**How.** An app is a first-match rule table over bounded fields, with guarantees. The repository already holds a
checker for exactly that, `regionCheck`, and a Lean proof that it is sound for every app: `regionCheck_sound` in
`studio/proof/PrismLive/Regions.lean`. So an app's proof is always the same two steps:

1. `checked : regionCheck B rules props d = true := Eq.refl true`. The kernel accepts this only by evaluating the
   checker on the app's own rules to `true`.
2. `all_hold := regionCheck_sound B rules props d checked`: every guarantee holds on every request in the bounds.

Neither step needs a tactic, so neither needs an elaborator. `live/emit.mjs` writes the app's rules as kernel terms
and those two fixed proofs, as a suffix of a library that holds the checker and its proof.

**Measured** (WebAssembly kernel under Node on one loaded desktop; `evidence/live.json`):

| | Result |
| --- | --- |
| The library: `regionCheck_sound` and all it rests on | 6.57 MB, 1.05 MB gzip, 1,898 declarations |
| Judged whole by the kernel, once | 1.8 to 2.7 s, 64 MB |
| Made resident | 0.5 to 0.9 s |
| Writing an app's proof, no Lean | 1 to 5 ms; 4.5 KB for parking, 22 KB for Verdant |
| Parking: 3 rules, 1 guarantee | accepted in 18 ms median, 64 MB |
| Parking with a guarantee its rules break | refused |
| Parking with its rules edited to break the guarantee | refused |
| Verdant: 35 rules, 15 guarantees | accepted in 2.6 s median, 191 MB |

- **The proofs Lean wrote for the same two apps** (`by decide +kernel`) are judged in the same time, and rest on the
  same axioms: `propext` and `Quot.sound`.
- **For scale**: the native kernel took 8.6 to 11.2 s on Verdant on the same loaded machine, Lean's elaborator 25 s,
  and the studio tells a user the hosted verifier takes "usually two to four minutes".
- **Verdant is past the hosted path's limit**: the studio offers at most 24 rules for proof today.

**What this does not establish.**

- **Speed on a large app.** Verdant takes seconds and 191 MB when the kernel evaluates every guarantee in one term.
  `proofsOf` writes one suffix per guarantee instead, each whole in itself; `regionCheck_sound` holds for a list of
  one. All 15 are accepted, each in 0.15 to 1.2 s, at 111 MB, in a run where the whole proof took 5.6 s: the work is
  the same in total (7.0 s), but a guarantee's verdict then depends only on the rules, the bounds and itself, so it
  can be shown as it lands and kept by address. A guarantee of a large app is still not instant: the kernel evaluates
  the checker by unfolding definitions, and the checker was written to be proved, not to be evaluated quickly.
- **What the app runs.** The theorem is about `PrismLive.Kernel.judge` on the data written here. That the data is
  what the app's rule module decides with is not proved; the hosted path proves its guarantees about the
  LexLean-rendered module instead. The two are not tied together here.
- **Coverage.** `regionCheck` refuses a rule that compares two fields, and treats `!=` in a guarantee as not
  narrowing. An app outside that still needs another proof.
- **The definitions' unfolding hints** are written as a fixed value. They steer the kernel's speed, not its verdict.

### Where a large app's time goes, and what an address removes

Measured on Verdant with native Lean (`live/variants.sh`, `live/obligations.mjs`; `evidence/live.json`).

- **Reshaping the checker did not help.** Computing each rule's box once, or giving the boxes as literals, changed
  nothing: the kernel already shares that work. A one-pass checker that carries the uncovered region was far worse,
  32 to 92 s against 1.6 s, because that region fragments. The checker's algorithm stays.
- **Most of what it evaluates is redundant.** The proof today makes 312 obligations and 5,485 box subtractions. 278
  obligations have an empty region, so there is nothing to cover. The other 34 are distinct, and only 98 subtractions
  are of a box that touches its region; a box that does not touch a region cannot cover any of it.
- **What is left is the real work.** The kernel judges those 34 obligations in 0.65 to 0.85 s, against 1.6 to 2.2 s
  for the checker as it is: two to three times less, not fifty, because the subtractions that remain are the ones
  that cut a region into pieces.

So the gain from an address is in not doing an obligation twice: 34 obligations of about 20 ms each, each named by
its region and the boxes that touch it, as `studio/shell/live/obligations.mjs` already names them.

### The theorem that takes its obligations as named

`live/Certified.lean` proves it: `certCheck_sound`. For one guarantee, the proof says which earlier rules to subtract
at each rule, and may point at a fact already proved. Neither is trusted. A rule named that is not earlier is
dropped, which can only make the check harder to pass; a fact is used only if it is exactly this obligation's region
and boxes, and every fact is a hypothesis of the theorem, to be discharged by a proof of its own
(`allKnown_cons`). It rests on `propext` and `Quot.sound`, as `regionCheck_sound` does, and leaves that file as it
is: it is built beside it, in the probe.

Verdant, one guarantee at a time, both ways in one run (WebAssembly kernel under Node; `evidence/live.json`):

| | `regionCheck_sound` | `certCheck_sound` |
| --- | --- | --- |
| Each guarantee, median | 96 to 977 ms | 61 to 394 ms |
| All 15 | 5.1 s | 2.5 s |
| Memory | 111 MB | 77 MB |
| Verdicts | 15 of 15 accepted | 15 of 15 accepted |

- **A guarantee the rules break is refused**, and so is a true one whose proof leaves out a rule it needs.
- **Parking** is accepted in 12 ms. The library is 7.2 MB, 1.15 MB gzip, with all three theorems.
- **A guarantee with nothing to cover still costs about 60 ms** on Verdant: the kernel walks all 35 rules to find
  that each region is empty.

### Keeping an obligation, and why that was not enough

The driver now has `check_keep`: an accepted suffix stays resident, so a later proof can name its theorems. Nothing
refused is kept. `live/reuse.mjs` makes each obligation a theorem named by the address of its region and boxes,
keeps it, and has the guarantee point at it.

It works and it does not help. All 34 obligations are judged once, in 612 ms, and are reused after an edit;
the 15 guarantees still cost 1.9 s with every fact resident. Timing the pieces says why: the kernel takes
milliseconds over each small evaluation (a rule's box 7 ms, a rule's bounds check 2 ms, picking the named rules
3 to 6 ms), and `certCheck` has it redo all of them for every guarantee.

### A proof that evaluates nothing

`live/Linked.lean` proves `linked_sound`. Every evaluation is a fact of its own, a statement about plain data that
names neither the app nor the guarantee: a rule's conditions and their box, a guarantee's conditions and their box,
that an outcome does not break a kind of guarantee, that two boxes share nothing, what two boxes meet in, that boxes
cover a region. A fact is proved once, by the kernel doing the evaluation, kept, and named by the address of what it
states. A guarantee is then assembled from named facts by applying lemmas, from the last rule to the first; the
kernel checks that the pieces fit and evaluates nothing. It rests on `propext` and `Quot.sound`.

Verdant, 35 rules and 15 guarantees, one kernel for the whole run (`live/linked.mjs`, one run, Node;
`evidence/live.json`):

| | Facts judged | Kernel, facts | Kernel, assembling | Writing (JS) | Total |
| --- | --- | --- | --- | --- | --- |
| First proof | 422 | 972 ms | 256 ms | 428 ms | 1.66 s |
| The same again | 0 | 0 | 209 ms | 146 ms | 354 ms |
| Rule 34 edited | 18 | 79 ms | 139 ms | 93 ms | 311 ms |
| Rule 33 edited | 9 | 18 ms | 151 ms | 92 ms | 261 ms |
| Rule 32 edited | 10 | 14 ms | 155 ms | 108 ms | 276 ms |
| Rule 30 edited | 10 | 16 ms | 142 ms | 81 ms | 238 ms |
| Rule 29 edited | 10 | 17 ms | 145 ms | 96 ms | 259 ms |

- **An edit costs what it changed.** 9 to 18 facts of 422 are new after moving one number in one rule; the
  rest are named, not redone. Against `certCheck_sound`, an edit goes from about 2 s to about 0.3 s, and the first
  proof from 2.5 s to 1.7 s. Memory is 64 MB.
- **All 15 guarantees are accepted** each time, and an edit that breaks a guarantee is refused
  (1 of the 6 tried).
- **What is left is fixed cost.** Assembling is about 10 ms a guarantee, and writing the terms in JavaScript is as
  much again; neither depends on what changed. A guarantee's proof is 40 KB.
- **Faults, none accepted:** a covering that is false; a proof that leaves out a rule it needs; a breaking answer
  said to be harmless; a step answered by a true fact about another answer; a fact the kernel never judged; a
  guarantee the rules break.
- **A true fact named in place of another true fact is accepted** (seen in `reuse.mjs`). The kernel finds the two statements equal by
  doing both evaluations. Nothing false gets through that way; it is slower, not unsound.
- **Kept facts are never dropped.** 490 were resident at the end of the run. A long session grows.

### The same, in a browser tab

The worker has it as `prove`: the page hands over the app as data, the worker writes each statement and its proof
(`live/prove.mjs`, the code Node runs), and the kernel judges. No server and no elaborator take part; the worker's
network is closed. `web/live.html` through Playwright, one run each, one desktop (`evidence/live-browser.json`):

| Verdant, 15 guarantees | Edge 157 (Chromium) | Firefox 153 | WebKit 26.5 | WebKit as an iPhone 15 |
| --- | --- | --- | --- | --- |
| Open, reading the library | 485 ms | 1540 ms | 537 ms | 528 ms |
| First proof | 1.09 s | 3.64 s | 1.21 s | 1.14 s |
| The same again | 174 ms | 486 ms | 170 ms | 202 ms |
| One rule edited (5 edits) | 156 to 229 ms | 538 to 763 ms | 190 to 264 ms | 182 to 262 ms |
| Later visit: open from the image | 228 ms | 205 ms | 405 ms | 459 ms |
| Later visit: first proof | 1.12 s | 3.82 s | 1.34 s | 1.19 s |
| Parking, 1 guarantee | 13 ms | 54 ms | 14 ms | 15 ms |

- **Every engine accepts all 15 guarantees**, on `propext` and `Quot.sound`, refuses the guarantee the rules break,
  and refuses the one edit of six that breaks a guarantee. Memory is 64 MB. No page is cross-origin isolated.
- **The download is 1.57 MB**: the kernel 0.42 MB and the library 1.15 MB, gzip.
- **A later visit judges the facts again.** The kernel's image is kept by address, and the library's bytes beside
  it for the proof's tables (150 to 300 ms to read into tables); the facts are not kept across visits.
- **The first proof includes those tables**, read once per worker.
- **A kernel that holds facts no longer judges a plain library suffix**: the file has moved on. `check` says so.
- **The phone column is WebKit on this desktop's CPU** with a phone's viewport and user agent. It is not a phone.

## Work done once per address

Hologram's rule, applied to checking: work is named by the address of what it reads, and done once. The worker keeps
two things in the origin's private file system (IndexedDB where the engine has none).

- **A verdict**, under the addresses of the kernel, the library and the suffix. The same proof is not judged twice,
  in this visit or a later one.
- **The kernel's memory with the library resident**, under the kernel's and the library's. A later open restores it
  and neither fetches nor reads the library.

A read is believed only if what it holds names the addresses it was asked for and, for the image, re-derives to the
address recorded beside it. Anything else is a miss, and a miss does the work in full: `InTabKernel.reuseAdmits`, and
its two theorems in `InTabKernelProofs`.

One desktop, kernel `52fa2174…`, 7 runs (`evidence/browser.json`, `evidence/engines.json`). The engines were run
through Playwright while other builds loaded the machine, Chromium in the app's browser pane; compare within a
column, not across.

| | Chromium 156 | Firefox 153 | WebKit 26.5 |
| --- | --- | --- | --- |
| Open by reading the library | 1.54 s | 11.6 s | 3.0 s |
| Open from the kept image | 0.30 s | 0.37 s | 0.70 s |
| Project judged by the kernel | 41 to 148 ms | 284 to 905 ms | 63 to 270 ms |
| The same project again | 0.5 to 1.2 ms | 2 ms | 14 to 16 ms |
| Kept verdict on a later visit | 3 to 15 ms | 31 to 43 ms | 4 to 185 ms |
| Agreement with native Lean, each way | 14 of 14 | 14 of 14 | 14 of 14 |
| Faults refused | 6 of 6 | 6 of 6 | 4 of 4; 2 not run |

- **Each way** is four: judged by the kernel, reused in the same worker, kept for a later visit, and judged again by a
  kernel restored from the image.
- **The six faults**: an altered bundle, kernel, library; a library with no binding; an image with one byte changed
  (a miss: the worker asks for the library); and a kept verdict rewritten to another suffix's (a miss: the kernel
  judges it). The last two are planted from the page, which Playwright's WebKit cannot do.
- **WebKit here is Safari's engine built for Windows.** It has no private file system, so it used the IndexedDB
  store. The iPhone row of `evidence/engines.json` changes the viewport and user agent only. No phone has run this.
- **Firefox is the slowest engine** on this build at every step the kernel does. The cause was not looked for.

What this costs, and what it does not establish:

- **Memory.** A kernel opened from the image holds 117 MB, against 77 MB: the memory is grown by an allocation the
  size of the image, and that space is not given back.
- **Disk.** The image is 80.5 MB in the origin's storage.
- **Trust.** The store is the origin's own. A script of this origin that writes a whole, self-consistent record can
  make the worker believe it, exactly as it could replace the worker. Reuse saves this tab's own work; it is not
  evidence to anyone else.
- **The image is not yet the same bytes twice.** Two builds differ in about 140 of 80.5 million bytes
  (`snapshot-probe.mjs`), not yet explained. So an image is one this origin made, not one shipped by address.
- **Addresses here are SHA-256**, which the browser computes natively. Hologram's κ is BLAKE3; deriving κ in the tab
  at speed needs BLAKE3 inside the module, which is not built.
- **Per-theorem reuse is not built.** A changed project is judged whole. The prover emits one suffix per project.

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

- The studio using `prove`: it still calls the hosted verifier. The kernel and library are not published.
- Facts kept across visits, and a bound on how many a long session keeps.
- That what `live/` proves is what the app's rule module runs. The statement is about the rules as data.
- Safari itself, and any phone. Memory of 77 to 92 MB has not been tried in iOS Safari.
- Why Firefox is three times slower.
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
