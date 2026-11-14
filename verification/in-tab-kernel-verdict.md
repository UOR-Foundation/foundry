# FA-86 — In-tab kernel verdict

Authority: `InTabKernel.verdictCode`, `InTabKernel.wordOf`, `InTabKernelProtocol.dispatchVerdict` and `InTabKernelProtocol.verdictWireBoundary`.

A verdict is decided from what the tab derived and what its own kernels answered. The request carries the pinned and the derived address of the library, of the bundle and of the kernel, the spec statement's and the checked statement's address, the declared and the observed axiom set, and four flags: Lean's kernel ran, it accepted, the second kernel ran, it accepted. The guest compares each pair of addresses; the caller cannot state that they agree. `proved` needs Lean's kernel to have run in the tab and accepted. Without it, an accepting second kernel reads `kernel-checked`. Kernels that disagree refuse. No field carries what a server said, and `InTabKernel.noVerdictFromTheServer` proves that changing it alone cannot change the verdict.

The protocol has exactly 72 request words and three response words, in bounded lowercase little-endian hexadecimal. The JavaScript codec (`studio/shell/in-tab-verdict-codec.mjs`) writes requests and reads replies; it implements no rule of the model. `studio/tools/in_tab_verdict_author.mjs` writes the protocol module, the corpus and the kernel's three references to them, and `--check` refuses drift.

## Local evidence

The FA-86 ID, scenario and failing test preceded the implementation (`just new-capability`; the test panicked "FA-86 is registered and not built").

Lean proved the model and the protocol on the hosted verifier, profile `prism-app`: six modules, attestation `071f5c38f04bfaaa7c42b160df70f0316899c1b83386547af8746d97c2a183c3` (`in-tab-kernel-verdict-proof.json`). That run covered the model's theorems and nine wire theorems, each a corpus vector Lean evaluates. The hosted verifier is a diagnostic; it does not replace the locked SDK.

In the locked SDK image, `lexlean fmt --check --all` and `lexlean lock --check` pass on all 24 modules.

The corpus has 19 vectors: 16 typed and three raw. The guest carries three of them as acceptance vectors: proved, kernel-checked and refused. A request is 584 bytes. The Node suite passes (six tests then, seven now), the 151-test Rust conformance suite passes, and `check-model` and `cargo fmt --check` pass. On Linux the 636-test Studio suite passes but for `home_card_keyboard`, whose `happy-dom` dependency is not installed here.

Seven planted codec defects were each refused (`node studio/tools/in_tab_kernel_verdict_defects.mjs`): a reply whose word is not its code believed; an extra field ignored; an axiom outside the admitted three dropped; an address cut to 128 bits; the request read after the guest is ready; a flag other than 0 or 1 sent; a guest fault read as proved. Restoring the codec restores the suite. Two rules no test could fail, a reply-length bound and a bytes check, were removed: the two exact reply shapes already imply both.

Five existing suites pinned the kernel's acceptance root as `previewAcceptance`; it is now `verdictAcceptance`, which ends in `previewAcceptance`. The count of acceptance requests in the model moves from 321 to 324.

## The Lean stage's limit

The SDK builds the application's Lean within 600 seconds (`application-lean`). With this capability CI ran past it four times (`PP5007`; runs 43501078726, 43506802819, 43523926, 43530074457). Three explanations were tried and were wrong or beside the point: too many embedded vectors, one slow theorem, and a longer dispatcher. Each change stays because it is measured to be cheaper, but none was the cause.

The cause, read from the SDK's own workspace after a local run of the stage: the application build stages only the runtime modules the application's modules import, and builds them from source. `InTabKernel` held its arithmetic theorems, so it imported LexLean's `Laws` runtime, which no other module of the application does (`ForgeKernelProofs` does, and it is not part of the application build). `Laws` then did not finish: its `.olean` was written in 20 seconds and its build was still running when the stage was stopped ten minutes later. `InTabKernel`, `InTabKernelProtocol` and `ForgeKernel` waited behind it.

`InTabKernel` now holds the definitions and the one theorem Lean proves by unfolding, and imports no `Laws`. The 14 arithmetic theorems are in `InTabKernelProofs`, which `ForgeKernelProofs` imports, as `ForgeKernel` and `ForgeKernelProofs` are already divided.

Measured on the way, module by module in a 6 GB container: main's modules build in about 131 seconds, `EventProtocol` 77 of them. `noVerdictFromTheServer`, first stated over two arbitrary evidence records, took 18 seconds; stated over one (`withServerSaying`) it is proved by unfolding with no axiom. Wrapping the dispatcher's whole body in one more arm took `ForgeKernel` from 21.7 to 28.0 seconds; the body now stays whole as `dispatchApplication` behind a small `dispatch`.

## Open qualification

`prismpm verify` did not complete locally: the SDK ended with `PP5007: application-lean timed out`. The guest is built by CI's page build, and `just vv` there is the authority.

No host handler calls the codec yet. Runtime and browser replay, and Studio acceptance, remain mandatory before the studio shows a verdict from it.

## The guest the studio ships

After the capability merged (20fac93), the guest the studio ran still answered `invalid` to every `verdict` request, and every gate passed.

- **What happened.** The pin workflow takes the holo of a finished page build and archives it on main. The page build of a87fb88, the commit before the merge, finished after the merge. Its holo (`blake3:8ebf4ec8`) was archived onto 20fac93 and its commit message named 20fac93 as the source, because the workflow read the branch's head and not the commit the build ran on. The page build of 20fac93 itself produced `blake3:4d442359`; its pin was refused at the push, twice (runs 43586490750, 43587685742), because main had begun to take changes through pull requests only.
- **Why no gate saw it.** The Node suite spoke to a stand-in for the guest. Nothing asked the pinned bytes a `verdict` request.
- **The pin now.** `studio/shell/kernel/kernel.holo` is `blake3:4d442359`, taken from the page build of 20fac93 (run 43578381047); `gh attestation verify` accepts its signature. The Kernel gate replays 322 of 322 vectors, and the kernel's boundary tests pass.
- **The gate now.** A seventh test in `studio/tools/in_tab_kernel_verdict.test.mjs` reads `studio/shell/kernel/guest.wasm`, checks it is the file `kernel.json` names, and asks it all 19 vectors of the corpus. So every vector, the ten Lean did not evaluate among them, is now replayed in the compiled guest.
- **Planted defect.** With the earlier pin's `guest.wasm` and `kernel.json` put back, `node --test studio/tools/in_tab_kernel_verdict.test.mjs` fails that test with `expected: 'ok 010000000000000000000000'`, `actual: 'invalid'`, six passing and one failing. Restored, seven pass.
- **The workflow now.** It names the commit the page build ran on, and it archives nothing when `app` or `prismpm.lock` differ between that commit and the checkout. On the case above the check stops the archive (`git diff --quiet a87fb88 20fac93 -- app prismpm.lock` exits 1).
- **Still open.** The workflow's own push to main is refused by the repository's rule, so a later kernel change will not be pinned until someone opens a pull request for it, as this one was. The new test catches a lagging pin only where the corpus differs.

This is the verdict rule and its wire. It does not run a kernel, derive an address, audit axioms or fetch a proof; those are `v2/in-tab-kernel/` prototypes that no published build reads. Nothing here establishes that the tab's inputs are what they claim: a caller that lies about what its kernel answered gets the verdict its lie describes. No independent review or release acceptance is claimed.
