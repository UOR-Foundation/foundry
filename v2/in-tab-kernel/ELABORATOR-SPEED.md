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

## UORC compression: not on the latency path

**Verdict:** UORC (UOR-Foundation/compression v0.6.0) makes the smallest files, but it decodes about 400 times
slower than zstd. It would slow the first load, not speed it up. Keep it for storage and archives, where size
matters and nobody waits.

**Measured:** v0.6.0's native x86-64 binary, under WSL with 12 cores. Every decode matched the original byte for byte.

| Sample | UORC | xz -9e | zstd -19 | UORC decode | zstd decode |
| --- | --- | --- | --- | --- | --- |
| Largest `Init/Data` `.olean`, 470,192 bytes | 106,947 | 112,324 | 126,000 | 0.96 s | 0.007 s |
| First 8,000,000 bytes of `lean-elab.wasm` | 780,955 | 945,220 | 1,092,087 | 13.9 s | 0.03 s |

Brotli could not be measured: it is not installed in WSL.

**What this means for the payload:**
- **Decode rate.** UORC decodes about 0.5 to 0.6 MB/s natively. The first-load payload is 164 MB (Init plus the module), which is about 5 minutes to decode, more in the browser.
- **Bytes saved.** Against zstd it saves 28% on the module sample: 311 KB per 8 MB, at a cost of 13.9 s of decoding.
- **When it would pay.** Only on links slower than about 0.2 Mbit/s.
- **Already counted.** UORC's own spec charges up to 192 model steps per decoded byte (`UC-PERF-04`); the measurements match that.

**The reasoning:**
- Each κ blob is decoded once and kept in OPFS, so compression only affects the first visit.
- On the first visit, the user waits for download plus decode.
- Brotli is decoded by every browser's network stack at no extra cost (`Content-Encoding: br`). Chrome and Firefox also decode zstd that way.
- So only Brotli or zstd lowers first-visit latency.
- Repeat visits transfer nothing at all, which no codec can beat.

**Where UORC does fit:**
- **Long-term storage of κ blobs.** Proof-term bundles and old toolchains, where storage cost matters and decoding is rare.
- **Its basis idea, at a fast codec's speed.** UORC's conditional archives decode against a named basis. The same idea applied to toolchain updates means shipping a new Init as a delta against the previous Init's κ, for example with zstd's `--patch-from`. That keeps the size win without the decode cost.

**The official Lean kernel and library are unaffected by any codec.** The tab hashes the decoded bytes with BLAKE3
and compares them with the official κ before use. So any lossless codec, UORC included, delivers exactly the
official bytes or a refusal.

## The resident worker (measured, 2026-11-18)

`elab --resident` is one process serving many requests. Per module it keeps Lean's last snapshot and hands it back
to Lean's own incremental processing, so an unchanged header skips the import and the commands before the first edit
are reused. It also keeps the second pass's import environment and verdict, keyed by a hash of the module's source
closure. One session: the six corpus modules cold, then `FoldLaws.Kernels` unchanged, with one theorem added at the
end, with one added in the middle, then `FoldLaws.Main` after its import changed, and again unchanged.

| Request (`FoldLaws.Kernels` unless named) | WebAssembly elaborate | WebAssembly re-check | Native elaborate | Native re-check |
| --- | --- | --- | --- | --- |
| Cold | 9.62 s | 0.85 s | 12.40 s | 0.98 s |
| Unchanged | 12 ms | 0 ms (verdict reused) | 11 ms | 0 ms |
| One theorem added at the end | 27 ms | 0.89 s | 11 ms | 1.08 s |
| One theorem added in the middle | 1.73 s | 1.35 s | 1.59 s | 1.19 s |
| `FoldLaws.Main`, after its import changed | 3.47 s | 1.88 s | 3.31 s | 0.92 s |
| `FoldLaws.Main`, unchanged | 19 ms | 0 ms | 5 ms | 0 ms |

**Agreement.** Every answer, cold, reused or edited, matches the one-shot driver and the other target declaration
by declaration (kind, type hash, value hash, axioms): 355 cold, 150 reused, 219 edited. The second pass refused
nothing.

**Caveats.** Cold timings are noisy (other builds were running; native cold was slower than WebAssembly here). Peak
memory is 5.4 GB in WebAssembly and 5.0 GB native, because every distinct import set keeps its own environment.

**What is still repeated.** After any edit the re-check covers the whole module (about 1 s); checking only changed
declarations is item 3. An edit re-elaborates everything after it; item 1 removes that.

## What to build first

1. ~~**The resident worker** (4).~~ Done; measured above.
2. **Per-declaration κ with proof-term reuse** (1 to 3). This is where WebAssembly beats native on every edit.
3. **The derived symbol table** (6).
4. **Measure 32-bit against 64-bit.**
5. **Static κ distribution** (5).

## Not measured yet

- Browser timings, and the import snapshot's size and restore time.
- 32-bit speed.
- The effect of per-declaration reuse on a real edit sequence.
- The resident worker in a browser tab, and its memory on a phone.

Every estimate above needs a measurement before it goes in the report.
