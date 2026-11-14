# FA-89: a rules app with no hosted verifier

Approving and publishing a rules app no longer reach `mcp.uor.foundation`.

- **Approve.** `proveRules` asks one prover, the tab (`in-tab/client.mjs`, FA-87 and FA-88). The rules are proved only
  on the Prism guest's word `proved`. Any other answer leaves them checked, with its reason as the proof error. There
  is no switch and no fallback.
- **Commit.** Nothing leaves the tab, so a proof is committed to only when its answer is in: `proveInTab` calls the
  host's `commit` after the answer and before returning it. An approval cancelled while the tab proves is rolled
  back, and its result is dropped.
- **Publish.** `publishTurn` hands the build the attestation the rules carry, which a proof made in the tab does not
  have, and the axiom sets the renderer writes. The published repository proves its own model again in its CI with
  the locked SDK (`bootstrap.yml`, `just vv`; `build.yml`, `prismpm verify`), as it did before; its `site/app.json`
  records that the proof ran in the SDK image. Rules over the SDK's limit of 24 are proved in the tab and not
  published, with the reason (UOR-Foundation/PrismPM#605).

## Why the renderer's axiom sets are enough

The hosted verifier also corrected each theorem's declared axiom set to the one Lean observed. Four published Prism
apps on this account were read (`prism-rsvp-seat`, `prism-marathon`, `prism-shipping-tier`,
`prism-payment-template-fit`): every declaration of every model and proofs module, 68 in all, records
`[Quot.sound, propext]`, which is what the renderer writes when it is told nothing. A spec whose theorems Lean
observes otherwise would fail its repository's CI, visibly, and is not covered here.

## Evidence

- **Node suite** (`studio/tools/rules_without_hosted_verifier.test.mjs`, three tests). The host's own `proveRules`
  runs in a VM with every effect recorded and the hosted prover replaced by one that fails the test if called: a tab
  proof saves `proved` with no attestation and `{}` axiom sets; a tab refusal saves `checked` with its reason; nothing
  is committed before the answer; a cancelled approval saves nothing. `publishTurn`, `approveRules` and `proveRules`
  name no hosted prover; publish passes the rules' own attestation, refuses rules over the limit, and the published
  `app.json` says the proof ran in the SDK image. No message about a rules app names the hosted verifier.
- **Other suites changed with it.** FA-87 now claims only that a rules app is proved in the tab; its switch and
  fallback tests are gone with the switch. `proof_approval_cancellation`, `rules_source`, `current_main_integration`
  and `proof_reuse` stubbed the hosted prover for rules; they now stub the tab, and the reuse wording is checked on
  `reuseSentence`, which stateful apps still use.
- **The whole studio suite** on Windows: 659 of 672 pass, 3 skipped. The 10 that fail did so before this change: 7
  are the Windows path and missing `happy-dom` failures recorded under FA-86's pin fix, and 3 (`proof completion`
  in `current_main_integration`) stubbed the hosted prover and pass once stubbed with the tab.
- **Planted defects** (`node studio/tools/rules_without_hosted_verifier_defects.mjs`), seven, each refused and
  restored after: a refusal in the tab handed to the hosted verifier; a refusal in the tab saved as proved; the proof
  committed before its answer is in; publish asking the hosted verifier first; rules over the SDK's limit published;
  the published app claiming a hosted attestation; the proof message promising the hosted verifier.

## Still on the hosted verifier

- **Stateful apps** (a LexLean module with state): checking the module as it is written, the preview's data form, and
  proving its theorems. They need Lean's elaborator, not only its kernel.
- `prism.prove`, the hosted prover of a rules model, stays in `prism.js` because the proof-reuse suite exercises the
  reuse machinery stateful apps share through it. No rules path calls it.
