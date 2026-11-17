# Source-bound generation batches

Authority: `FoundrySpecification.generationPatchBoundary`, `GenerationPatchError`,
`projectEditBoundary` and the cancellation extension of `rulesSourceBoundary`.
FA-23 stages bounded model-supplied writes, deletes and renames before one atomic
compare-and-commit transaction. Overlapping operations, escaping paths, missing
delete/rename sources and rename overwrites refuse. Staging never mutates storage.

Direct dependency requests require exact stable numeric versions. Conflicting or
unversioned requests refuse the whole batch. Sorted declarations are included in
`prism/dependencies.json` with profile `foundry/direct-dependency-requests/1`, and
`extraDeps` metadata is updated in the same transaction. The reserved declaration
cannot be replaced by a model-supplied file operation. These are requested direct
versions, not a resolved, authenticated or complete transitive dependency lock.
Legacy unversioned dependency metadata must be resolved before adding requests;
this boundary does not silently choose a version.

Cloud code context and device-rule input use the captured project source. Device
cached rule status is used only when its identity matches the captured rule text.
The request's source is copied before asynchronous preparation, compared inside
the transaction, and carried to the subsequent rules batch. Even a no-op first
batch retains its original source: it cannot allow a later stale rules proposal
to overwrite an intervening edit. Rules, the generated rule module and generated
screen stage and commit together; status remains independently source-bound.

Cancellation refuses before preparation/commit, aborts active project and rule-
status transactions and releases listeners. It does not undo a completed commit.
Chat records each completed batch, emits version-created after commit, retains the
last committed snapshot and tells the user when committed changes remain after
later cancellation/failure. No final redundant seal re-reads potentially mixed
project state. `applyPrismTags` now returns the typed batch result rather than an
unqualified count; the owned chat consumer uses its count, snapshot and source.

The registered ID, scenario and failing test preceded implementation. Six Node
controls cover staging, ambiguity, path and batch bounds, direct dependency
versions, no-ops, cancellation and actual host source/signal/result plumbing.
Chromium executes real transactions and the actual host batch/rules adapters:
complete combined mutation, one version, dependency declaration/metadata parity,
no-op source carry, caller source mutation, cancellation during hashing, cancellation
at a successful write request, cancelled rule-status rollback and retained work
after commit. The preimage/checker oracle in this harness scopes its result to
adapter/storage integration; it does not requalify those imported semantics or
establish full provider-to-renderer chat acceptance.

Four planted defects fail Chromium:

- Removing the project transaction abort listener: `active transaction cancellation did not roll back`.
- Retaining the caller's mutable source object: `caller mutation changed the captured comparison source`.
- Recapturing current source instead of carrying the no-op source: `no-op batch lost source binding before rules`.
- Removing the status transaction abort listener: `cancelled rule status committed`.

All were restored. Generation, explicit-edit, creation and rule-source browser
checks pass. The earlier FA-09 source assertion initially rejected the newly
forwarded cancellation parameter; it now requires that exact parameter, and the
full inherited controls were rerun. Full Rust workspace, Clippy, parser and
imported contract checks pass locally. The diagnostic
compiler verifies all twelve modules with attestation
`396646a4bd6d844337d420801370c25ca917c2aa4eab55fb38535517f8178d32`.
Immutable-SDK and Studio gates remain required at the PR revision.

This is atomicity per completed batch, not whole-turn atomicity, full chat admission
or remote/device inference cancellation. Already submitted inference can continue.
Authenticating dependency closure, every other effect boundary, full feature
routing and durable work ownership remain separate requirements.
