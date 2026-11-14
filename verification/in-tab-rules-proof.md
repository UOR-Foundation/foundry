# FA-87: a rules app proved in the tab

With the switch on (`?proof=tab` on the studio's address; `?proof=hosted` turns it off), approving a rules app proves
its guarantees in the tab. Lean 4.32.1's kernel, compiled to WebAssembly, judges proofs the tab writes from the spec,
through `linked_sound` (`v2/in-tab-kernel/live/Linked.lean`). The Forge kernel guest then decides the verdict from what
the tab derived (FA-86). Only its word `proved` marks the app proved.

## What ships

| File | What it is | Bytes | gzip |
| --- | --- | --- | --- |
| `studio/shell/in-tab/lean-kernel.wasm` | Lean 4.32.1's kernel, single-threaded | 2,235,906 | 421,004 |
| `studio/shell/in-tab/lean-kernel.mjs` | its Emscripten loader | 62,458 | |
| `studio/shell/in-tab/library.ndjson` | the proved checker: `regionCheck_sound`, `certCheck_sound`, `linked_sound` and all they rest on | 7,204,099 | 1,147,748 |
| `studio/shell/in-tab/manifest.json` | each of the above by SHA-256, and the record that this kernel judged this library whole | | |
| `emit.mjs`, `certs.mjs`, `prove.mjs` | the proof writer, byte for byte the one in `v2/in-tab-kernel/live/` | | |
| `worker.mjs`, `client.mjs`, `spec-app.mjs` | the worker, the page's side, and the reading of a spec as boxes | | |

They are built by `v2/in-tab-kernel` (`build-wasm.sh`, `live/build.sh`, `bind-library.mjs`, `live/make-dist.mjs`).

## Evidence

- **Node suite** (`studio/tools/in_tab_prove.test.mjs`, six tests): the shell's real kernel and the pinned guest. The
  parking spec is proved and the guest says `proved`; proved again, no fact is judged; one rule edited, 3 of 14 facts
  are judged. A guarantee the rules break, another app's statement (every guarantee of it true), fewer guarantees,
  another kernel, another library, `sorryAx`, `Classical.choice`, a missing axiom, and a guest that answers `invalid`
  are each refused. A rule with `is not`, or one comparing two fields, starts no worker. The host's `proveRules` is
  run with the switch on and off: on, a tab proof saves `proved` with no hosted call; a tab refusal asks the hosted
  verifier and keeps the tab's reason; off, the tab is never asked. Publish asks the hosted verifier before it builds.
- **Browsers** (`studio/tools/in_tab_prove_browser.mjs`, the real worker with its storage, served with no isolation
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
  a guest with no verdict taken as `proved`; a rule with `is not`, or a comparison of two fields, read as a box; the
  statement's address leaving out `otherwise`; the switch on by default; the host not asking the hosted verifier
  when the tab does not prove; the host asking the tab with the switch off; publish building rules with no
  attestation; the shell's library not the one its manifest names. The first run let the statement's address
  through: the test's other app also had a guarantee Lean refused, so it failed for that reason. It now proves an app
  whose every guarantee holds and whose `otherwise` differs, and the defect is refused (`expected: false`,
  `actual: true` with it planted; six of six pass restored).

## Not established

- The full studio with the switch on: approving an app in the chat has not been run in a browser.
- Safari itself and any phone.
- Specs the tab cannot read as boxes (`is not` in a rule, a comparison of two fields, a number with no maximum) still
  go to the hosted verifier, and publishing still asks it for an attestation.
- What the tab proves is a statement about the rules as data. That the module the published app runs answers the same
  is not yet proved.
