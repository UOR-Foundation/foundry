# In-tab elaborator: completion plan

The goal: a LexLean model elaborated by Lean's own elaborator inside the browser tab. A declaration counts as
proved there only under the rule in `elab/spec/src/InTabElaborator.lex.tex`.

## Where the code is

Foundry implements only Prism (`audit-prism`), so the prototype's code is not in this tree. It is in this
repository's history at commit `43b66b26d38b` (`v2/in-tab-kernel/elab/`: the build scripts, the driver, the Node store, the
browser worker and its WASI host). It moves to PrismPM, `sdk/npm/lean-prover/`; the driver itself ships in LexLean's
release and is pinned into PrismPM. What stays here: this plan, `ELABORATOR-SPEED.md`, `evidence/`, the proved specs
in `elab/spec/`, and the recorded Lean patch `elab/upstream/lean-wasm-elaborator.patch`.

## Order of work (Ilya, 2026-11-18)

The goal is to remove the hosted prover completely. The first target is every Prism SDK build in Node, not the
browser.
1. **Item 5:** LexLean's front end, so a `.lex.tex` goes to verdicts, usable from Node. The print-only render
   command is being added in LexLean (lexlean-render session).
2. **Phase 1 items 1 and 2:** one admission rule; the symbol table derived from Lean's environment.
3. **Phase 2 items 1 and 2, in Node:** the CI corpus gate writing the build's κ; the planted defects refused.
4. **Phase 3 item 1:** publish the engine and Init by κ with the gate's attestation. Then hand the Prism SDK session
   (prismpm#724) what it needs to make the WebAssembly prover prism-code's default, hosted only as a fallback.
5. **The lexlean MCP server** backed by the same prover, so sessions stop calling the hosted server.
6. **Safari last:** the 32-bit build, so the hosted prover can go entirely.

Browser polish (OPFS caching, Firefox, a phone) waits until after step 4.

## Target: every Prism SDK build uses this prover (Ilya, 2026-11-18)

After `npx prism-code@latest setup`, every Prism app's prove and build runs this WebAssembly prover in Node, with
Lean 4.32.2's own library. There is no Docker, and the hosted prover is a fallback only.

**What is official, and what is patched.**
- **Official, unchanged:** the Init `.olean` files, byte for byte the release's. Today they are taken from the elan
  toolchain; before publishing, each κ is checked against the release archive's.
- **Official source, our compile:** Lean's own C++ (runtime, kernel, elaborator, IR interpreter) and the C that
  Lean's compiler emits for Init, Std and Lean, compiled to 64-bit WebAssembly at the release's commit (`f3b06c70`).
- **Patched** (`upstream/lean-emscripten-stubs.patch`, `elab/upstream/`): Emscripten stubs for what a page lacks
  (processes, sockets, signals, `mmap`); a cooperative task manager that never starts a thread, under which a wait
  nothing can satisfy is a panic, never a hang; C++ signatures corrected to match the C Lean emits (native x86-64
  tolerates the mismatch, WebAssembly traps); and a symbol table in place of `dlsym`. The diff is recorded in
  `elab/upstream/lean-wasm-elaborator.patch`; nothing in the kernel's typing rules is changed.
- **Decided (Ilya, 2026-11-18): the gate admits it.** An engine with these C++ patches counts as official Lean
  4.32.2 when the corpus gate admits it. Exactly one hunk touches Lean's kernel source: in
  `src/kernel/environment.cpp`, the declared return type of `lean_kernel_diag_is_enabled` goes from `uint8*` to
  `uint8`, matching the C Lean emits. It is diagnostics plumbing, not checking logic. PrismPM's audit allows exactly
  that hunk and refuses any other change under `src/kernel/`, with a planted defect editing a checker line.
- **Ours:** the driver (`elab/driver/Elab.lean`, Lean's frontend called as `lean` calls it) and its entry.
- **Admitted only by the gate:** a patched engine counts only if the CI corpus gate found it equal to official
  native Lean, declaration by declaration, and the gate's result names that engine's κ (Phase 2 item 1).
- **Not yet official:** the LexLean runtime `.olean` files, compiled here by native Lean from LexLean 6330c8d's
  rendered runtime. They must come from LexLean's own release pipeline, with their κ published there.

**What ships: only what elaboration opens.** That is Init plus the LexLean runtime, not all of Lean. Lean's module
system does not carry the runtime's private import of Lean downstream.

| Part | Files | Bytes | Gzip |
| --- | --- | --- | --- |
| Engine (`lean-elab.wasm` and its loader) | 2 | 121.7 MB | 21.7 MB |
| Library: Init and the LexLean runtime | 2,398 | 375 MB | about 124 MB |
| LexLean front end (`lexlean.wasm`, WASI) | 1 | 19.1 MB | 4.1 MB |
| **First run total** | | **about 516 MB** | **about 150 MB**, against the 5.7 GB SDK image |

**The store: one per machine, by κ.**
- **Layout:** `$PRISM_HOME/kappa/<hex>`, the store prism-code already keeps. Every file, engine and library alike, is
  one blob named by the BLAKE3 κ of its served bytes.
- **Fetched once, checked on every read:** setup fetches each blob once. Every read re-derives its κ, and a mismatch
  is a miss.
- **Shared:** no per-project copies. A new Lean release adds only the blobs whose κ changed.

**The manifest: one file, `lean-wasm-prover/1`.**
- **Fields:** `{ schema, lean, lean_commit, engine: { loader, wasm }, lexlean, library: [{ path, kappa, bytes }],
  gate }`. The library `path` is where the file sits in the prover's in-memory file system (`/lean/lib/lean/...`,
  `/rt/...`). `gate` is the κ of the corpus gate's attestation for this engine.
- **Pinned by κ:** prism-code pins the manifest's own κ. A manifest without `gate` is not a default candidate.

**The Node entry: bytes in, verdicts out.**
- **Loading:** `prover.mjs` exports `open({ manifest, read })`. `read(kappa)` returns the blob's bytes from the
  store. The prover has no network or file access of its own and re-derives every κ it is given. The engine is plain
  WebAssembly (Emscripten, in-memory file system). LexLean runs on a WASI host held in memory (`elab/web/wasi.mjs`),
  so no `node:wasi` is needed.
- **Proving:** `prove({ project })` takes a LexLean project as a map of path to bytes (`lexlean.toml`, the lock, the
  `.lex.tex` sources). It runs LexLean's front end to render the Lean modules, elaborates them, and has the kernel
  check every declaration.
- **The answer:** `{ accepted, modules: [{ module, accepted, declarations: [{ name, kind, accepted, axioms }] }],
  evidence: { engine, library, lexlean, gate } }`, JSON-serializable.
- **What `prove` must match** (agreed with the Prism SDK session, 2026-11-18): all of `lexlean verify` that decides
  acceptance, since Prism's hosted path accepts only `verified` with every entrypoint module covered. That means
  check, render, Lean elaboration, the kernel, and the axiom audit (`LLV7005`): each declaration's observed axioms
  must equal its declared policy exactly. Signing stays a separate step. The evidence names what a verify
  attestation names: engine, library, LexLean and project.
- **Axioms:** `prove` reports the observed set per declaration. Prism also refuses anything outside `propext`,
  `Quot.sound` and `Classical.choice`, so `sorryAx` and `Lean.ofReduceBool` fail.
- **Compressed blobs** (Ilya, 2026-11-18; replaces `gzipKappa`): every blob is stored and shipped as gzip, the one
  format that both Node and the browser decode natively (`DecompressionStream` in Chrome 156 has no zstd or brotli).
  Measured over 461 MB of library: gzip 138 MB, decoded in 1.5 s.
  - **κ is identity, the encoding is not.** κ is BLAKE3 of the decoded bytes, never of the compressed ones. A
    manifest entry is `{ path, kappa, bytes, encoding: "gzip", encodedBytes }`, and the stored file is the compressed
    bytes under the decoded κ.
  - **On read:** decode, then re-derive κ. A decode failure or a mismatch is a miss, and a miss refetches.
  - **Throughput:** decode while downloading (`DecompressionStream`, Node's zlib streams), spread across workers, and
    decode once per prover start.
  - **Storage:** compressed in both stores (OPFS in the tab, `$PRISM_HOME/kappa` on disk), about 138 MB.
  - **The rule is proved** (hosted Lean verification, `evidence/spec-verify-prover.json`): `elab/spec/src/KappaBlob.lex.tex`. A blob is admitted only when it decodes and κ of the
    decoded bytes equals its manifest κ; a blob not admitted is refetched; the encoding never changes admission or
    what the prover reads; the prover reads only the manifest's bytes; collection keeps exactly the blobs a pinned
    manifest names; the proof cache stays within its bound. Tested, not proved: that gzip and BLAKE3 are implemented
    correctly, and the measured sizes and times.
- **Release:** a GitHub release, since prism-code reads only from GitHub. Prism adds a `wasm-lean` tier first in
  `proverWhere`, with the hosted verifier as fallback, and makes it the default only when the manifest names a gate.

**Blocked on.** LexLean's print-only render command, so the front end can hand the engine the Lean modules on WASI
(lexlean-render session). The gate (Phase 2 item 1). A release to pin (Phase 3 item 1).

## What is formally verified, and what is not

The elaborator is not proved correct, and does not need to be. It is untrusted: whatever it produces, the in-tab
kernel checks again. What Lean proves is the admission rule around it. A declaration is accepted only when all of
these hold:
- the in-tab kernel accepted it;
- the build is one that passed the corpus gate;
- the library is admitted (the official Init κ for 64-bit, or a 32-bit Init that agreed with native);
- no extern lookup missed and no wait panicked;
- the axioms are exactly the declared ones.

Each rule is one theorem in that file. The corpus gate (WebAssembly equals native on every declaration) is tested,
not proved: it is evidence about one build, addressed by that build's κ.

## Phase 1: build

Done when the browser can elaborate a LexLean model and give a verdict under the rule.
1. Move `InTabElaborator.lex.tex` beside `app/src/InTabKernel.lex.tex` and compose it with `InTabKernel`'s verdict, so the tab has one admission rule.
   *Composed and proved in `v2` (`elab/spec/src/InTabProver.lex.tex`, hosted Lean verification, `evidence/spec-verify-prover.json`): nothing the in-tab kernel refuses is accepted; no proof comes from an elaborator run its rule refuses; the run enters only through its verdict code; the server cannot change the verdict. It uses a copy of `InTabKernel` until `app/` moves to Lean 4.32.2.*
2. Derive the symbol table from Lean's environment, not from one corpus run: every declaration an import-time attribute or `evalConst` can run. This closes the one known refusal outside the corpus.
   *Done (`gen-symtab.py`, default `SYMTAB=all`). The table is every extern, read from Lean's environment, plus
   every function the linked archive defines: 211,283 names, so nothing depends on a run and nothing is
   interpreted. The run log that missed `--check`'s symbols is no longer read. The corpus still agrees, 355 of 355,
   and the store tests pass. Cost: the engine grows from 67.7 to 121.7 MB, or 13.5 to 21.7 MB gzip. Speed is not
   measured yet: the machine was loaded by other builds during the run.*
3. Build for the browser (`-sENVIRONMENT=web`, a worker, Init's `.olean` files fetched by κ and cached).
   *Done in a real tab, uncached (`elab/web`, `evidence/browser-elab.json`). Chrome 156, not cross-origin
   isolated: the six-module corpus agrees with native Lean, 355 of 355 declarations, `FoldLaws.Kernels` in 8.2 s.
   Opening the worker fetches a 64.6 MB engine and 2,398 library files (375 MB, Init and the LexLean runtime), every
   one checked by BLAKE3 κ: 14 s from localhost. Not done: caching in OPFS, Firefox, a phone.*
4. Keep the library resident between edits, so an edit pays for changed declarations only. *Done under Node, native
   and WebAssembly (`elab --resident`): an unchanged module answers in 12 ms, and the kernel re-check after an edit
   covers only changed declarations. The browser worker serves through it; edits there are not measured yet.*
5. Put LexLean's front end (`wasm32-wasip1`, LexLean#503) in the same worker: `.lex.tex` in, verdicts out.

## Phase 2: test

Done when every number in `ELABORATOR-SPIKE.md` is measured in a browser and the gate is automatic.
1. The corpus gate in CI: native against WebAssembly, every declaration (`agree.py`). It writes the build's κ when it passes; the rule refuses any other build.
2. Planted defects, each of which must be refused: a changed `.olean` byte, a missing extern, a wrong axiom, a build not gated, a 32-bit Init that disagrees.
3. Headless Chromium and Firefox: cold start split into download, compile and import; warm start; edit to verdict.
4. A phone-sized memory limit (1 GB) on Android Chrome.
5. Widen the corpus: every LexLean example and every `app/src` model.

## Phase 3: publish

Done when a user opens Prism Foundry and their model is checked in their own tab.
1. Publish the module and Init by κ, with the gate result as their attestation; a reader re-derives κ before use.
2. Ship behind the existing in-tab kernel flag, desktop and Android first; Safari falls back to the hosted prover.
3. Upstream the patches to Lean (cooperative tasks, the ten signatures, `lean.h`, the symbol table hook).
4. Decide on the 32-bit build for Safari from Phase 2's memory numbers.

## Decided

- **The in-tab prover replaces the hosted prover for every Prism app build, through the Prism SDK** (Ilya,
  2026-11-18). It is not a second check. The hosted prover stays only as the fallback: Safari, or a build whose gate
  failed. The SDK's default is hosted today (prismpm#724); it switches to in-tab once Phase 3 publishes.
- **Results are canonical only** (Ilya, 2026-11-18): the tab reports what native Lean produces for the same inputs,
  never a provisional or approximate result. See `ELABORATOR-SPEED.md`.

## Open decisions

- Is a 32-bit build worth maintaining before Safari ships 64-bit WebAssembly?
