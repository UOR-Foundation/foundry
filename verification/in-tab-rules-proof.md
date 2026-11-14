# FA-87: a rules app proved in the tab

Approving a rules app proves its guarantees in the tab. Lean 4.32.1's kernel, compiled to WebAssembly, judges proofs
the tab writes from the spec, through `tab_sound` (`v2/in-tab-kernel/live/Tab.lean`, FA-88; first `linked_sound`). The
Forge kernel guest then decides the verdict from what the tab derived (FA-86). Only its word `proved` marks the app
proved.

This capability first shipped behind a switch (`?proof=tab`), with the hosted verifier asked whenever the tab did not
prove. FA-89 removed both: the tab is now the only prover of a rules app.

## What ships

| File | What it is | Bytes | gzip |
| --- | --- | --- | --- |
| `studio/shell/in-tab/lean-kernel.wasm` | Lean 4.32.1's kernel, single-threaded | 2,235,906 | 421,004 |
| `studio/shell/in-tab/lean-kernel.mjs` | its Emscripten loader | 62,458 | |
| `studio/shell/in-tab/library.ndjson` | the proved checker: `regionCheck_sound`, `certCheck_sound`, `linked_sound`, `tab_sound` and all they rest on | 8,917,947 | 1,412,960 |
| `studio/shell/in-tab/manifest.json` | each of the above by SHA-256, and the record that this kernel judged this library whole | | |
| `emit.mjs`, `certs.mjs`, `prove.mjs`, `zones.mjs` | the proof writer, byte for byte the one in `v2/in-tab-kernel/live/` | | |
| `worker.mjs`, `client.mjs`, `spec-app.mjs` | the worker, the page's side, and the reading of a spec as data | | |

They are built by `v2/in-tab-kernel` (`build-wasm.sh`, `live/build.sh`, `bind-library.mjs`, `live/make-dist.mjs`).

## Evidence

- **Node suite** (`studio/tools/in_tab_prove.test.mjs`, four tests): the shell's real kernel and the pinned guest. The
  parking spec is proved and the guest says `proved`; proved again, no fact is judged; one rule edited, only the facts
  it changed are judged. A guarantee the rules break, another app's statement (every guarantee of it true), fewer
  guarantees, another kernel, another library, `sorryAx`, `Classical.choice`, a missing axiom, and a guest that
  answers `invalid` are each refused. A spec the tab cannot read (a choice value that is not one) starts no worker.
- **Browsers** (measured on the `linked_sound` library, before FA-88) (`studio/tools/in_tab_prove_browser.mjs`, the real worker with its storage, served with no isolation
  headers, Playwright on one Windows 11 desktop, three runs):

  | | Edge 157 (Chromium) | Firefox 153 | WebKit 26.5 |
  | --- | --- | --- | --- |
  | First proof, kernel and library read | 0.94 to 1.73 s | 3.15 to 4.16 s | 1.39 to 2.46 s |
  | Proved again | 10 to 22 ms | 24 to 34 ms | 40 to 60 ms |
  | One rule edited | 13 to 365 ms | 58 to 75 ms | 31 to 63 ms |
  | A later visit, kernel from its kept image | 0.61 to 1.01 s | 1.10 to 1.30 s | 0.91 to 1.66 s |

  In every run each engine refused the broken guarantee. One earlier Firefox run timed out after three minutes; it
  did not recur in three runs.
- **Planted defects** (`node studio/tools/in_tab_prove_defects.mjs`), each refused by the suite and restored after:
  a verdict other than `proved` taken as a proof; the library's, the kernel's or the statement's pinned address
  taken from the worker; the observed axioms replaced by the declared ones; Lean's refusal not reported to the guest;
  a guest with no verdict taken as `proved`; the statement's address leaving out `otherwise`; the shell's library not
  the one its manifest names. The first run let the statement's address through: the test's other app also had a
  guarantee Lean refused, so it failed for that reason. It now proves an app whose every guarantee holds and whose
  `otherwise` differs, and the defect is refused. The defects about the switch, the fallback and reading only boxes
  went with them; FA-88 and FA-89 plant their own.

## Not established

- The full studio: approving an app in the chat has not been run in a browser.
- Safari itself and any phone.
- What the tab proves is a statement about the rules as data. That the module the published app runs answers the same
  is not yet proved.
