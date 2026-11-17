# Runtime grants

Authority: `MON-01` to `MON-07`, `NET-01` to `NET-05`, `CMP-01` to `CMP-04`, `STO-01` to `STO-04`,
`PLN-01` to `PLN-04`, `INS-01` to `INS-05`, `OFF-01` to `OFF-05`, `AUD-01`, `AUD-02`, `SES-01` and
`SES-02` in `model/ids.toml`, scenarios in `features/suites/runtime-grants.feature`.

These are the decisions behind two proposals. The first is priced grants: any app owner may charge for a
capability, and the owner is the merchant of record. The second is the Hologram Live runtime contracts the
Forge kernel adopts without its daemon: permissions an archive carries, components built from proved parts,
storage under a quota, a plan that says why an app cannot run, install by name, optional local hardware,
an audit record and explicit sessions.

Each concern is one module under `app/src/Runtime/`: `Payment`, `Network`, `Composition`, `Storage`, `Plan`,
`Install`, `Offload`, `Audit` and `Session`. Each module holds its request records, its decisions and the
theorems about them, and imports nothing, so one can be removed or replaced alone. `ForgeKernel` imports all
nine, so `prismpm verify` on `app/` proves them with the kernel. Every promise is stated the same way: a
`breaks` condition, and a theorem that no request meets it. A field holding `1` means yes; any other value
means no.

The registered IDs, scenarios and failing tests came first: all 38 tests failed, each naming its missing
module, before the modules were written. Then 38 passed, and `npx prism-code verify --lean --local` in `app/`
verified all 21 modules in the SDK image `prismpm.lock` pins (attestation
`29f4ca1f9c0353a7ae7399781c516c167f53625731cd4d91402722d12dcc18fc`).

Mutation, 2026-11-11:

1. The decision. Removing the `receiptSigned` check from `paidAllows` in `app/src/Runtime/Payment.lex.tex`
   made `npx prism-code verify --lean --local` fail with `LLV7002 Lean rejected
   PrismForgeKernel.Runtime.Payment (error): omega could not prove the goal`, at `paidNeedsSignedReceiptHolds`
   (MON-02). Restored, verified.
2. The claim. Weakening `breaksPaidNeedsSignedReceipt` to compare `paidAllows` with `2` still verifies,
   because Lean proves whatever is stated. `cargo test -p repo-conformance --test runtime_grants` refused it:
   `runtime_grants_mon_02` panicked with `the condition of breaksPaidNeedsSignedReceipt changed`. Restored,
   38 passed.

What this does not establish. The decisions are proved; the inputs are not. Each field is computed by a host:
whether a receipt's signature checks, whether a path lies inside a scope, whether a daemon is on loopback.
The guarantees hold only where the frame, the service worker and the publisher compute those inputs
faithfully and act on these answers. No request kind in `ForgeKernel::dispatch` reaches these decisions yet,
so the shipped kernel guest does not answer them, and `studio/KERNEL_REV` is unchanged. Who issues receipts,
and the PrismPM change that lets an archive carry a capability request (`studio/UPSTREAM.md`), are outside
this proof.
