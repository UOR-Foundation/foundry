# In-tab elaborator: completion plan

The goal: a LexLean model elaborated by Lean's own elaborator inside the browser tab. A declaration counts as
proved there only under the rule in `elab/spec/src/InTabElaborator.lex.tex`.

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
2. Derive the symbol table from Lean's environment, not from one corpus run: every declaration an import-time attribute or `evalConst` can run. This closes the one known refusal outside the corpus.
3. Build for the browser (`-sENVIRONMENT=web`, a worker, Init's `.olean` files fetched by κ and cached).
   *Done in a real tab, uncached (`elab/web`, `evidence/browser-elab.json`). Chrome 156, not cross-origin
   isolated: the six-module corpus agrees with native Lean, 355 of 355 declarations, `FoldLaws.Kernels` in 8.2 s.
   Opening the worker fetches a 64.6 MB engine and 2,398 library files (375 MB, Init and the LexLean runtime), every
   one checked by BLAKE3 κ: 14 s from localhost. Not done: caching in OPFS, Firefox, a phone.*
4. Keep the library resident between edits, so an edit pays for changed declarations only. *Done under Node, native
   and WebAssembly (`elab --resident`): an unchanged module answers in 12 ms, and the kernel re-check after an edit
   covers only changed declarations. Not yet in a browser worker (item 3).*
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
