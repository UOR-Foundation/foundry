# Faster than native: elaboration by κ

## The answer

WebAssembly cannot run one Lean step faster than native: measured, it is 1.7 times slower on proof-heavy work. It
can still beat native end to end, by doing far less work. Native Lean repeats three things that κ makes
unnecessary:
- the library import, on every run;
- the elaboration of every declaration in a changed file;
- proof search for proofs that someone has already found.

**The key fact:** finding a proof is search, while checking one is cheap. On the corpus, the kernel checks a
module 3 to 7 times faster than the elaborator produces it (measured: `FoldLaws.Kernels` 1.69 s against 12.53 s in
WebAssembly). A proof term addressed by κ can come from anywhere, untrusted, and the kernel in the tab decides.

## Where the time goes now (measured, WebAssembly, Node 24, WSL)

| Part | WebAssembly | Native | How it is repeated today |
| --- | --- | --- | --- |
| Compile the 66 MB module | 0.33 s | none | every process |
| Import Init and the runtime (empty module) | about 1.3 s warm | about 0.25 s | every module, every run |
| Elaborate `FoldLaws.Kernels`, import included | 12.53 s | 7.22 s | every declaration, every edit |
| Kernel re-check of `FoldLaws.Kernels` | 1.69 s | 0.88 s | every run |

The import measurements are noisy: a cold first run took 5.7 s. Even the warm import is 4 to 5 times native,
because native maps the `.olean` files into memory while WebAssembly copies 98 MB into its heap.

## Six ways to remove repeated work

Ordered by effect.

1. **Declarations by κ, not files.**
   - **The key.** Each declaration is keyed by κ(its source, the κ of every constant it uses, the toolchain κ).
   - **Proofs don't propagate.** A theorem's proof is irrelevant to its dependents; only its statement matters. So editing one proof re-elaborates that proof alone. Editing a definition re-elaborates only the declarations that use it.
   - **Native doesn't do this.** Native Lake re-elaborates the whole file. Lean's own language server reuses only the unchanged prefix of a file.
   - **Estimated effect.** Editing one proof in `FoldLaws.Kernels` costs about one declaration's share, about 0.1 s, against native's 7.2 s for the file.
2. **Proof terms by κ, checked in the tab.**
   - **What gets stored.** The proof term, keyed as in 1.
   - **Where it comes from.** A term found by anyone can be fetched from anywhere: the tab's OPFS store, a static file, a peer.
   - **Why that is safe.** The tab's kernel checks the term before acceptance, so the source needs no trust.
   - **Effect.** This turns search into checking, 3 to 7 times cheaper (measured ratio). It follows the CLAUDE.md rule: reuse is checked on read.
3. **Verdicts by κ.**
   - **The key.** A kernel verdict is keyed by κ(term, dependency statements, kernel build).
   - **Effect.** An identical key under an identical kernel reuses the verdict at zero cost. That is exactly the reuse rule `InTabKernel.reuseAdmits` already proves sound.
4. **The library imported once per tab session.**
   - **One worker.** It stays alive and holds the imported environment, so an edit never imports again.
   - **Cold start next.** Snapshot the heap right after import as one κ blob (Hologram's `hologram-runtime` already treats a snapshot as κ content). Restoring it is a copy, not an import.
   - **Fewer relocations.** Placing Lean's compacted regions at their saved base address avoids relocation.
   - **Effect.** It removes the 1.3 s from every edit, and most of it from a cold start (estimated).
5. **Bytes fetched once, verified once, stored forever.**
   - **Static files by κ.** The module, the import snapshot and published proof terms are served by κ from any static host.
   - **Verification.** Each is verified by Hologram's 1 MiB BLAKE3 piece tables (`hologram-space/src/piece.rs`), so pieces can come in parallel from any mirror.
   - **Storage.** Kept in OPFS through `hologram-store`'s `opfs` backend.
   - **Compiling.** `WebAssembly.compileStreaming` overlaps compiling with downloading, and the browser caches compiled code per URL. A κ URL never changes, so that cache never goes stale.
6. **No interpreted fallback.**
   - **The problem.** Tactics and macros run as compiled code only when the symbol table has them. Otherwise Lean's IR interpreter runs them, an order of magnitude slower (estimated).
   - **The fix.** Derive the table from Lean's environment (Phase 1, step 2 of the plan), so nothing is interpreted.

## Lean and high throughput

**Memory and width.**
- **Bounds checks.** 64-bit WebAssembly memory needs an explicit bounds check on every load, since browsers can't use guard pages for it. 32-bit uses guard pages instead.
- **Pointer size.** 32-bit pointers halve the size of every Lean object.
- **So 32-bit is likely faster as well as smaller** (estimated, 10 to 30%). That turns the Safari build from a fallback into a candidate default; measure it first.

**Size.**
- **The module.** It is 66 MB raw, 12.8 MB gzipped. Next steps are Brotli, `wasm-opt -O3`, and dropping what a LexLean module never runs (Lean's code generator, the language server, Lake).
- **The library.** Ship the import snapshot instead of 98 MB of `.olean` files when it is smaller; it needs measuring.

**Parallelism.**
- **Desktop.** Independent declarations (no κ edge between them) go to separate workers, each restored from the same import snapshot. The work-list is the κ dependency graph, so nothing is elaborated twice.
- **Memory.** Each worker holds about 1 GB (measured peak), so phones run one worker.

## 100% serverless

**Everything below runs without a server running code:**
- static κ files on any static host or CDN;
- verification in the tab;
- OPFS storage;
- the kernel in the tab as the only judge.

**The proof-term cache for published work is serverless too.** Proofs of Init, the LexLean runtime and every
published model are built once and served as static κ files.

**One gap: sharing a new proof between users live, with no server.**
- **Why Hologram doesn't cover it.** Its peer network (`hologram-net`: TCP Kademlia, QUIC) has no browser transport.
- **Why WebRTC doesn't either.** Browsers can only talk peer to peer over WebRTC, which needs a signalling step to connect.
- **The choice:**
  - Accept static files plus local OPFS. Each user's own new proofs stay on their own device until published.
  - Or add WebRTC with signalling over an existing static or peer channel.

I recommend the first option. It is fully serverless now, and the trust model stays the same either way.

## What to build first

1. **The resident worker** (4). It removes the largest repeated cost, every import, with the least work.
2. **Per-declaration κ with proof-term reuse** (1 to 3). This is where WebAssembly beats native on every edit.
3. **The derived symbol table** (6).
4. **Measure 32-bit against 64-bit.**
5. **Static κ distribution** (5).

## Not measured yet

- Browser timings, and the import snapshot's size and restore time.
- 32-bit speed.
- The effect of per-declaration reuse on a real edit sequence.

Every estimate above needs a measurement before it goes in the report.
