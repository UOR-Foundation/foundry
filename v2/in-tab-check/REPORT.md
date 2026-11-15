# LexLean's check, in the tab

> The scripts and crate this report ran are no longer in the tree: they are at commit d2a1a71 (`git show d2a1a71:v2/in-tab-check/<file>`). Foundry now proves rule apps in the tab with Lean's kernel instead (studio/shell/prism.js `prove`).

Result: LexLean's own `check` runs in a browser worker with no server. It is the pinned LexLean 0.3.0, compiled to WebAssembly from the commit the SDK image names, with a patch of 59 added lines. On all 17 corpus files it gives the image's verdict, codes, messages, lines and columns, and it writes the image's lock file byte for byte. An edited spec gets its verdict in about 50 ms, against 500 to 1,000 ms on the hosted route. The verdict is "checked", never "proved".

It is an experiment, not something to ship today: it needs a patched LexLean, and Foundry ships no fork. What it would take is in section 7.

## 1. The routes

| Route | Needs from upstream | Foundry carries | Size and time | Risk | Outcome |
| --- | --- | --- | --- | --- | --- |
| (a) LexLean's `check` as WebAssembly, `wasm32-wasip1`, file calls answered from memory | A patch: 59 added lines, 7 files | A 13 KB file-system host, a 50-line wrapper crate, the checker's bytes | 7.1 MB gzip, 46 ms a check | Low: the code is LexLean's | Built, agrees 17 of 17. Chosen |
| (a') The same, without the embedded preservation library | A second patch: 17 lines | The same | 3.5 MB gzip, ready in 91 ms, 50 ms a check | The language-1.2 identity is carried, not computed; one gate holds it | Built, agrees 17 of 17 |
| (a'') `wasm32-unknown-unknown` with a bytes-in API | A new public API in LexLean | A binding | Smaller host | A larger upstream change for the same result | Not built; requested |
| (b) Only the reader of the data form | The same patch, or `identity_bytes` made public | The same | No smaller: one crate | None | Included in (a): 1 to 3 ms a module |
| (c) Per-declaration checking | A per-declaration check API. LexLean links a module as a whole and reports a type fault against the whole module | Nothing sound without it | n/a | A second implementation of the rules otherwise | Not possible as stated. What is sound was built: reuse of a whole result under the address of everything that made it, 0.6 ms |
| (d) Precomputed library results | Nothing | A gate | 46 ms instead of 130 to 316 ms | Rests on LexLean checking a module independently of modules it does not import | Built: name the author's modules, hold the library's own `check --all` in a test |
| (e) Keep the instance alive | Nothing | Nothing | Removes 0.8 to 1.3 s from every check | State kept between checks | Built. Found by measuring: see section 2 |
| (e') One engine across checks | A session API in LexLean | Nothing | An estimated 30 ms off each check | None | Requested, not built |

No route has a second implementation of any rule. `wasm32-wasip1` was chosen over a bytes API because it changes nothing LexLean does with files: the same paths, the same confinement checks, the same lock.

## 2. What blocked it, exactly

Measured on PrismPM `35e9f01d` (the SDK image's `org.opencontainers.image.revision`), `vendor/lexlean` 0.3.0, Rust 1.97.1. Each blocker was found by building or running, in this order:

1. `fs4` does not compile for WASI (9 errors, "cannot find module `sys`"). Used at one site, `api.rs` `acquire_lock`. `check` never takes that lock; `lock`, `build`, `fmt` and `verify` do.
2. `verify/lifeline.rs` defines `end_leader` for Unix and for Windows only. Compile error on any other target.
3. `link.rs` `check_project` runs the pipeline on a new thread sized for the configured depth. WASI has no threads: at run time, `LLS8001 cannot spawn the compile thread`.
4. `lib.rs` `embedded_digest` reads the embedded tree on up to eight threads. The process aborts, even for `--version`.
5. `same-file` compiles for WASI and then refuses at run time: `same-file is not supported on this platform`, once per source file. The comparison with the image found this one: every file came back refused.
6. `backend/core.rs` `on_stack_for` spawns a thread for the same reason as 3. On the build path, not `check`; patched for completeness, not exercised.

`studio/UPSTREAM.md` predicted 1 and 5. The patch (`upstream/wasm-check.patch`) gates each site on `target_family = "wasm"`; on every other target the compiled code is the same except that the digest loop is a named closure. It applies to PrismPM `35e9f01d5415ed4b0b64c152238f291546957ec4`.

Two things the patch gives up on WebAssembly, and only there:

- No exclusive lock on the build root. One instance owns its whole file system.
- No "these two paths are one file" check (`LLC0104`). The host's file system has no hard or symbolic links and cannot make one (`path_link` answers "not supported").

A finding that shaped the design: for language 1.2, LexLean computes its compiler-semantics ID by reading 31 MB of embedded preservation library into its data form, in every process. On native threads this is hidden; in WebAssembly it is 0.8 to 1.3 s. So the checker is a library whose instance stays alive (the ID is computed once), not a command run per check.

## 3. What was built

- `upstream/wasm-check.patch`, `upstream/lean-embed.patch`: the two proposals.
- `crate/`: a wrapper with three exports and no rule. `run` is `lexlean::cli::run` with the host's arguments, `data` is `lexlean::identity_bytes`, `warm` computes the ID early.
- `wasi.mjs`: the 25 WASI calls the module imports, over a file tree in memory. Time is a counter and randomness a fixed sequence, so a result cannot depend on when it ran. A module that imports anything else is refused by name.
- `checker.mjs`: assembles the project the image would see (the pack plus the author's modules), runs `lexlean lock` then `lexlean check`, parses LexLean's JSON, and on a pass reads each module's data form. `pack.json` holds the library, the `prism.arch` lexicon and the project files (153 files, 20 KB gzip).
- `worker.mjs`, `client.mjs`: the worker, and the page's side with the fallback order.
- `checker.json`, `checker-lean.json`: what a tab may run, by address.
- `agree.mjs`, `test.mjs`, `bench.html`, `serve.mjs`, `build.sh`, `make-pack.mjs`, `make-manifest.mjs`.

The built checkers are not committed (47 MB and 15 MB); `build.sh` makes them and the manifests hold their addresses.

## 4. Agreement with the authority

Authority: `lexlean check --all` in `prismpm-sdk-candidate@sha256:cd3b47d7…`, recorded in `v2/hosted-check/image-results.json`. In-tab: both builds, both scopes (`agreement.json`, `agreement-lean.json`).

| File | Image | In tab | Codes | Messages, lines, columns |
| --- | --- | --- | --- | --- |
| guests-1 | checked | checked | none | identical |
| guests-2 | checked | checked | none | identical |
| guests-3 | refused | refused | LLT4001 | identical |
| payment (two modules) | checked | checked | none | identical |
| broken/unknown-name | refused | refused | LLT4001 | identical |
| broken/wrong-type | refused | refused | LLT4001 | identical |
| broken/missing-field | refused | refused | LLT4001 | identical |
| broken/constructor-arity | refused | refused | LLT4001 | identical |
| broken/reserved-name | refused | refused | LLT4001 | identical |
| broken/non-terminating | refused | refused | LLT4001 | identical |
| broken/bad-qualifier | refused | refused | LLT4001 | identical |
| broken/malformed-syntax | refused | refused | LLP2001 | identical |
| broken/title-not-in-lexicon | refused | refused | LLL1004 | identical |
| broken/title-lowercase | refused | refused | LLL1004 | identical |
| broken/title-phrase-then-unknown | refused | refused | LLL1004 | identical |
| broken/title-two-phrases | checked | checked | none | identical |
| broken/title-hosted-word | checked | checked | none | identical |

No difference in any of the 68 comparisons (17 files, 2 builds, 2 scopes). The title workaround of the hosted route is gone: the tab uses the SDK's own lexicon, so titles are sent as written and no position is mapped.

Versions. Image and tab run the same LexLean: 0.3.0, compiler-semantics `8554008034f6…` (both print it), built from the commit the image names. The lock each tab build writes for `payment` equals the lock the image wrote (`v2/probe-payment/lexlean.lock`), which carries the language-1.2 identity `5262e5b4…`. What differs is the compilation target and the six gated sites. So agreement here is the same source on two targets, which is stronger than the hosted route's two compilers, and it still rests on 17 files.

The data form: for `Payment`, `PaymentApproval` and `Foundation.Bytes` the tab's data form equals the one fetched from the hosted service earlier (`v2/probe-payment/data/`), compared as JSON. The interpreter can run from it with no server.

## 5. Measurements

In the Claude desktop in-app browser (Chrome 156, Windows 11), in a dedicated worker, 12 runs each. The machine was compiling Rust for other sessions throughout, so these are pessimistic. Full figures: `measurements.json`.

| Measure | Full build | Lean build | Hosted route |
| --- | --- | --- | --- |
| Download, raw / gzip / brotli | 47.4 / 7.1 / 4.8 MB | 15.1 / 3.5 / 2.4 MB | none |
| Pack, raw / gzip | 254 / 20 KB | the same | |
| Scripts (host, checker, worker, client), gzip | 9.1 KB | the same | 3.4 KB |
| Return visit, bytes in hand to ready, median / worst | 942 / 1,128 ms | 91 / 117 ms | n/a |
| of which: hash, compile, instantiate, warm | 45, 30, 9, 806 ms | 18, 17, 6, 0.1 ms | |
| First check after a start, median / worst | 67 / 84 ms | 110 / 172 ms | |
| Edited spec, passes, median / worst | 46 / 56 ms | 50 / 62 ms | 563 to 988 / 1,121 to 1,718 ms |
| Edited spec, syntax refusal | 31 / 38 ms | 37 / 39 ms | 544 to 735 / 816 to 1,612 ms |
| Edited spec, type refusal | 45 / 88 ms | 37 / 38 ms | |
| Edited spec, two modules of the author's | 56 / 92 ms | 65 / 95 ms | |
| Data form, inside the above | 1.1 ms | 1.5 ms | 332 ms |
| Unchanged spec again | 0.6 / 0.7 ms | 0.7 / 1.6 ms | the same as a new one |
| Checks a second, one worker | 23 | 21 | limited by the service |
| Checks a second, 16 workers (one run) | not run | 273 | |
| Linear memory of the instance | 214 MB | 90 MB | none |

Last keystroke to verdict is the editor's own pause plus the page round trip in the table: with no pause, 46 to 50 ms median. The round trip is 0.5 ms more than the time inside the worker.

Where a check's 46 ms goes: a syntax refusal, which stops before linking, takes 31 ms, so about 30 ms is what LexLean does on every command (load the project, verify the lock, read 141 lexicon entries, parse its embedded tables) and about 15 ms is the author's module and its imports. Of the 90 MB, 80 MB is the stack LexLean's own plan reserves for depth 1,024; untouched pages of it are not committed.

Not tested: Firefox, Safari, any phone, any slow network. Peak memory of the whole agent could not be read (`measureUserAgentSpecificMemory` is unavailable there). Download time was measured on localhost only and says nothing about a network.

## 6. Security and seamlessness

Where it runs. A dedicated module worker. In the test page the worker's script is served with `Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'`. Measured from inside the worker: a fetch to `https://mcp.uor.foundation/` is refused, and so is a fetch to its own origin. Independently of any policy, the module imports 25 functions, all file-system calls answered from memory; none can open a socket, and a module that imported one would be refused before it ran (`ITC_IMPORT`, tested).

What it can read. The pack and the spec it is handed. It holds no key and no project data: the page passes bytes in and gets JSON out. The spec never leaves the tab.

How its bytes are pinned. `checker.json` carries the content address of the checker and of the pack, as Hologram labels on the sha256 axis (`sha256:<hex>`). The worker hashes what it was handed and refuses a mismatch (`ITC_ADDRESS`) before compiling. It then asks the checker what it is and refuses one that does not report the manifest's LexLean version and compiler-semantics ID (`ITC_VERSION`). The manifest's LexLean identity is copied from what the image printed, never from the build. In the app the manifest belongs in the service worker's closure, which already verifies its files by SHA-256 before caching them; the checker's bytes then sit in the Cache API under their address (read back in 17 to 32 ms).

Why sha256 and not BLAKE3. Hologram's default address is BLAKE3; it also accepts sha256 labels. The repository's script BLAKE3 measures about 27 MB/s, which is 0.6 to 1.8 s for these bytes; the browser's own SHA-256 took 18 to 45 ms. Used from Hologram: its address form, verify on read, and reuse by address. Not usable from it today: its browser store hashes only with BLAKE3, it has no receipt that ties a tool and its inputs to an output, and no loader that checks a module against an address before running it (requests in `UPSTREAM.md`).

How a user knows the verdict is authentic. Every answer carries `by`: the route, the checker's address, the pack's address, LexLean's version and compiler-semantics ID. Anyone can rebuild the checker from the named commit and patch and compare the address. What is not there: a signature. The address proves the bytes are the ones the manifest names; it does not prove who made the manifest. That is the service worker closure's job, and it is only as strong as the host that serves it.

Reuse. A result is kept under the address of the checker, the pack, the scope and every module's text, each part framed by its length. Because time and randomness are fixed, the result is a function of exactly those. A stored result is re-hashed on read and dropped when it does not match what was recorded with it (tested by turning a stored refusal into a pass). Only the in-memory store was exercised in the browser; a persistent one is an interface (`store`) with a test double.

Offline. Once the bytes are held locally, nothing needs a network; the worker has none either way.

First visit. The page loads 1.4 KB (`client.mjs`), far inside the 60 KB budget. The checker loads in the background. Until it is ready, `check` goes to the hosted route and the answer says `by: { route: "hosted", instead: { code: "ITC_NOT_LOADED" } }`. With no hosted route given, it fails with that code instead.

Fallback order. In the tab when ready. Hosted while loading, when the bytes do not match, or when the checker stops (`ITC_TRAP`: the instance is discarded and a new one made). Never silently: the answer names the route and why. `only: "in-tab"` waits for the tab instead, for a user who does not want a spec sent anywhere.

When the version differs from the SDK's. A test ties `checker.json`'s image to `prismpm.lock`'s `sdk_image`. When the SDK moves, that test fails until the checker is rebuilt from the new commit and the corpus re-recorded. At run time a checker of another LexLean is refused by `ITC_VERSION`.

## 7. What it would take to ship

1. Upstream takes `wasm-check.patch` or its equivalent (request 1). Without it Foundry would ship a fork, which it will not.
2. For the lean build, upstream takes request 2. Until then the full build works, at twice the download and ten times the start.
3. The SDK publishes the checker as an inventory item with its digest in `prismpm.lock` (request 5). Then Foundry carries no Rust and no build, and the gate is one comparison: the address in the manifest equals the SDK's.
4. Until 3: the gate is `build.sh` in the lane, then `node make-manifest.mjs --check`, which fails when the built bytes, the pack, either patch, the wrapper or the build script differ from what the manifest records. Run end to end from the two patch files, `build.sh` reproduced both recorded addresses on this machine. The bytes depend on the build directory's path, so the lane must fix it.
5. Foundry carries: `wasi.mjs`, `checker.mjs`, `worker.mjs`, `client.mjs` (9.1 KB gzip together), `pack.json`, the manifest, and the wiring into `studio/shell/live/v2/` and the service worker, none of which this work touched.
6. The agreement test in the lane, rerun whenever the SDK moves.

## 8. Planted defects

Each was restored afterwards; `node --test v2/in-tab-check/test.mjs` then passed 34 of 34 (17 tests on each build).

| Defect | Caught by | Diagnostic |
| --- | --- | --- |
| Built without the same-file gate (not planted: the first build) | agreement | all 17 `DIFF`, 5 `DISAGREE`: `LLS8001 same-file is not supported on this platform` |
| The checker's address is not compared | "bytes that are not the manifest's are refused", and the client test | 4 fail |
| A stored result is believed without hashing | "a stored one is verified on read" | 2 fail |
| One word of a library module changed in the pack | load | the test file fails at once with `ITC_ADDRESS` |
| The lean build given a wrong language-1.2 identity | the address check (`ITC_ADDRESS`), and with its own address accepted, "the lock is byte for byte the image's" | lock differs |

The last one matters. With a wrong identity the checker still agreed with the image on all 17 verdicts and diagnostics, because it locks and checks with the same wrong value. Only the lock comparison sees it. So verdict agreement alone does not hold the lean build; the lock gate does.

## 9. Measured, estimated, not established

Measured: everything in sections 4, 5 and 8; the blockers in section 2; that the worker reaches no network; that two instances give byte-equal results on every corpus file; that `build.sh`, from the patch files, reproduces both checkers' addresses in the same directory on the same machine.

Estimated: that a session API would remove about 30 ms a check (from the syntax-refusal time, not from a profile); that full link-time optimisation and `wasm-opt` would shrink and speed the code (the optimised build was killed for memory on this machine; `wasm-opt` was not installed).

Not established:

- Agreement beyond 17 files, one example of each fault kind.
- Deep nesting. The image runs the pipeline on an 80 MB thread stack and reports `LLS8002` past its depth. In a tab the engine's own call stack may end first, as a trap (`ITC_TRAP`), not as LexLean's diagnostic. No spec that deep was tried.
- That checking the author's modules alone always equals `check --all`. It holds on the corpus, and the library's own `check --all` is tested, but the independence of unimported modules was read from behavior, not from LexLean's source.
- The patched crate's own test suite on a native target. It was compiled natively, not tested.
- `build.sh` in another directory or on another machine, and whether the SDK image can build the wasm target.
- Any browser but one, any phone, real network download time, the whole agent's memory.
- A persistent result store in a browser, and the service worker wiring.
- Who signs the manifest.
