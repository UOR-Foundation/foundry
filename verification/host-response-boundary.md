# Browser response boundary evidence

FA-03 implements `FoundrySpecification.hostResponseBoundary` and its four
`HostResponseError` constructors. This is an explicitly checked host adapter,
not a claim that handwritten JavaScript was generated or formally verified.

The registry, scenario and failing conformance test preceded implementation.
The shared adapter rejects absent handlers, thrown/rejected handlers, invalid
contracted responses and validator exceptions. It never substitutes an empty
success. Both IPC entrypoints preserve error codes and imported error categories.
Valid responses retain their original identity, including legitimate empty lists.
Channels without imported schemas remain outside output-schema coverage.

`studio/model/host-read-scope.json` is the declared external adapter inventory,
checked against the renderer read scan and host handler scan. Required reads
cannot silently become unavailable. New/stale entries fail validation. The scan
is conservative source inspection, not exhaustive dynamic call-graph evidence.
It currently identifies 17 unavailable reads; refusing them does not implement
the corresponding features or establish that every screen renders a useful error.

## Executed controls

- Ten Node tests execute the shipped adapter and actual host dispatch body.
  They cover every error, malformed validators, successful empty results, exact
  output identity, argument forwarding and both entrypoints.
- The real vendored renderer client, error decoder and TanStack query cache
  reject unsupported and invalid responses, retain typed errors and recover to
  success. Both envelope and legacy invocation paths pass.
- The contract shape/scope gate passed against 311 imported channel contracts
  and 106 registered host handlers. Shell parsing passed under browser parse goals.
- Restoring the old empty-success fallback caused two Node tests to fail with
  `true !== false`. Restoring typed refusal passed all ten tests.
- Renaming the required `get-context-paths` handler caused the contract gate to
  fail with `required read is missing: get-context-paths`. Restoring it passed.
- All 37 Rust workspace tests passed, including the new ten-test Node suite.
  This branch is stacked on FA-01; FA-02 remains in its separate PR.
- Diagnostic LexLean verification accepted all five modules with attestation
  `82bd6863ba598b4cfc2567e24c0c7054dd234aeb79f471c5553fdbce66b4f157`.
  Only remote verification in the locked SDK counts as repository acceptance.

Studio CI installs the existing renderer lock once with scripts disabled and
npm download caching, then executes the scope and renderer checks. Pages executes
the same checks after its existing renderer install, with no additional install.
No universal template policy or SDK lock is changed.

## Completeness review

Author review checked all four modeled refusals, the imported Prism error kinds,
legacy and envelope clients, required-read preservation, script packaging through
the recursive shell manifest, and generated conformance registration. The review
identified and preserved the existing missing-handler mutation gate. This is
self-review, not independent approval. Full browser journey/accessibility evidence
and conversion of remaining product decisions into Prism remain separate work.
