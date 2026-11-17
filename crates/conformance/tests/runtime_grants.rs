//! The `runtime-grants` suite: one test per scenario in `features/suites/runtime-grants.feature`.
//!
//! Each promise lives in its own module under `app/src/Runtime/`, with the decision it is
//! about. The Lean kernel checks the proofs when `just vv` runs `prismpm verify` on `app/`.
//! What these tests hold fixed is the claim each proof is about: the condition no request
//! may meet, and the theorem that states none does. A weakened condition would still
//! verify, and would no longer be the claim its row makes.

use std::path::PathBuf;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("crates/conformance is two below the root")
        .to_path_buf()
}

/// The body of the top-level declaration named `name`, up to its closing brace.
fn declaration<'a>(model: &'a str, name: &str) -> &'a str {
    let start = model
        .find(&format!("\n  name: {name},\n"))
        .unwrap_or_else(|| panic!("{name} is not declared"));
    let end = model[start..]
        .find("\n}\n")
        .unwrap_or_else(|| panic!("{name} is not closed"));
    &model[start..start + end]
}

/// The condition no request may meet, and the theorem in the same module that says none does.
fn pinned(module: &str, breaks: &str, condition: &str, theorem: &str) {
    let path = root()
        .join("app/src/Runtime")
        .join(format!("{module}.lex.tex"));
    let model = std::fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("the module {module} is not in app/src/Runtime"));
    let found = declaration(&model, breaks);
    assert!(
        found.contains(condition),
        "the condition of {breaks} changed:\n{found}"
    );
    let holds = declaration(&model, theorem);
    let statement = format!("statement: (({breaks} request) = false),");
    assert!(
        holds.contains(&statement),
        "{theorem} must state that no request meets {breaks}:\n{holds}"
    );
}

/// `MON-01`: A capability with no price never opens a checkout
#[test]
fn runtime_grants_mon_01() {
    pinned(
        "Payment",
        "breaksFreeNeverCharges",
        "body: (((project request price) =? 0) && ((checkoutOpens request) =? 1))",
        "freeNeverChargesHolds",
    );
}

/// `MON-02`: A paid capability is never served without a signed receipt
#[test]
fn runtime_grants_mon_02() {
    pinned(
        "Payment",
        "breaksPaidNeedsSignedReceipt",
        "body: (((0 <? (project request price)) && (not ((project request receiptSigned) =? 1))) && ((paidAllows request) =? 1))",
        "paidNeedsSignedReceiptHolds",
    );
}

/// `MON-03`: An expired receipt never serves a paid capability
#[test]
fn runtime_grants_mon_03() {
    pinned(
        "Payment",
        "breaksExpiredReceiptNeverServes",
        "body: (((0 <? (project request price)) && (not ((project request now) <? (project request expires)))) && ((paidAllows request) =? 1))",
        "expiredReceiptNeverServesHolds",
    );
}

/// `MON-04`: A receipt serves only its own user, app and capability
#[test]
fn runtime_grants_mon_04() {
    pinned(
        "Payment",
        "breaksReceiptBoundToHolder",
        "body: (((0 <? (project request price)) && (((not ((project request receiptUser) =? 1)) || (not ((project request receiptApp) =? 1))) || (not ((project request receiptCapability) =? 1)))) && ((paidAllows request) =? 1))",
        "receiptBoundToHolderHolds",
    );
}

/// `MON-05`: A denial wins over a paid receipt
#[test]
fn runtime_grants_mon_05() {
    pinned(
        "Payment",
        "breaksPaidDenialWins",
        "body: (((project request denied) =? 1) && ((paidAllows request) =? 1))",
        "paidDenialWinsHolds",
    );
}

/// `MON-06`: Paying never replaces the user's grant
#[test]
fn runtime_grants_mon_06() {
    pinned(
        "Payment",
        "breaksPaymentIsNotConsent",
        "body: ((not ((project request granted) =? 1)) && ((paidAllows request) =? 1))",
        "paymentIsNotConsentHolds",
    );
}

/// `MON-07`: Checkout opens only when the owner has signed the payout binding
#[test]
fn runtime_grants_mon_07() {
    pinned(
        "Payment",
        "breaksCheckoutNeedsPayoutBinding",
        "body: ((not ((project request payoutBound) =? 1)) && ((checkoutOpens request) =? 1))",
        "checkoutNeedsPayoutBindingHolds",
    );
}

/// `NET-01`: A fetch needs both the archive's declaration and the user's grant
#[test]
fn runtime_grants_net_01() {
    pinned(
        "Network",
        "breaksFetchNeedsDeclarationAndGrant",
        "body: (((not ((project request declared) =? 1)) || (not ((project request granted) =? 1))) && ((networkAllows request) =? 1))",
        "fetchNeedsDeclarationAndGrantHolds",
    );
}

/// `NET-02`: A fetch stays within the granted origin and path
#[test]
fn runtime_grants_net_02() {
    pinned(
        "Network",
        "breaksFetchStaysInScope",
        "body: (((not ((project request originMatch) =? 1)) || (not ((project request pathWithin) =? 1))) && ((networkAllows request) =? 1))",
        "fetchStaysInScopeHolds",
    );
}

/// `NET-03`: A fetch is HTTPS GET only
#[test]
fn runtime_grants_net_03() {
    pinned(
        "Network",
        "breaksFetchIsHttpsGetOnly",
        "body: (((not ((project request methodGet) =? 1)) || (not ((project request https) =? 1))) && ((networkAllows request) =? 1))",
        "fetchIsHttpsGetOnlyHolds",
    );
}

/// `NET-04`: A fetch never exceeds its byte limit
#[test]
fn runtime_grants_net_04() {
    pinned(
        "Network",
        "breaksFetchIsBounded",
        "body: (((project request limit) <? (project request bytes)) && ((networkAllows request) =? 1))",
        "fetchIsBoundedHolds",
    );
}

/// `NET-05`: A denial wins over a network grant
#[test]
fn runtime_grants_net_05() {
    pinned(
        "Network",
        "breaksFetchDenialWins",
        "body: (((project request denied) =? 1) && ((networkAllows request) =? 1))",
        "fetchDenialWinsHolds",
    );
}

/// `CMP-01`: A child component never holds a capability its parent lacks
#[test]
fn runtime_grants_cmp_01() {
    pinned(
        "Composition",
        "breaksChildNeverExceedsParent",
        "body: ((not ((project request parentHolds) =? 1)) && ((childHolds request) =? 1))",
        "childNeverExceedsParentHolds",
    );
}

/// `CMP-02`: A child holds a capability only when it was delegated
#[test]
fn runtime_grants_cmp_02() {
    pinned(
        "Composition",
        "breaksChildNeedsDelegation",
        "body: ((not ((project request delegated) =? 1)) && ((childHolds request) =? 1))",
        "childNeedsDelegationHolds",
    );
}

/// `CMP-03`: A child's quota never exceeds its parent's
#[test]
fn runtime_grants_cmp_03() {
    pinned(
        "Composition",
        "breaksChildQuotaBounded",
        "body: ((project request parentQuota) <? (childQuota request))",
        "childQuotaBoundedHolds",
    );
}

/// `CMP-04`: Nothing is prepared until every grant in the chain is admitted
#[test]
fn runtime_grants_cmp_04() {
    pinned(
        "Composition",
        "breaksAdmissionBeforePreparation",
        "body: ((((not ((project request parentAdmitted) =? 1)) || (not ((project request delegationAdmitted) =? 1))) || (not ((project request childAdmitted) =? 1))) && ((prepareStarts request) =? 1))",
        "admissionBeforePreparationHolds",
    );
}

/// `STO-01`: A new write never exceeds the storage quota
#[test]
fn runtime_grants_sto_01() {
    pinned(
        "Storage",
        "breaksWriteWithinQuota",
        "body: (((not ((project request existing) =? 1)) && ((project request quota) <? ((project request used) + (project request size)))) && ((writeAllows request) =? 1))",
        "writeWithinQuotaHolds",
    );
}

/// `STO-02`: A write needs a grant and an admitted root
#[test]
fn runtime_grants_sto_02() {
    pinned(
        "Storage",
        "breaksWriteNeedsGrantAndRoot",
        "body: (((not ((project request granted) =? 1)) || (not ((project request rootMatch) =? 1))) && ((writeAllows request) =? 1))",
        "writeNeedsGrantAndRootHolds",
    );
}

/// `STO-03`: Writing bytes already stored costs no quota
#[test]
fn runtime_grants_sto_03() {
    pinned(
        "Storage",
        "breaksIdenticalBlobIsFree",
        "body: (((project request existing) =? 1) && (not ((writeCharge request) =? 0)))",
        "identicalBlobIsFreeHolds",
    );
}

/// `STO-04`: A denial wins over a storage grant
#[test]
fn runtime_grants_sto_04() {
    pinned(
        "Storage",
        "breaksWriteDenialWins",
        "body: (((project request denied) =? 1) && ((writeAllows request) =? 1))",
        "writeDenialWinsHolds",
    );
}

/// `PLN-01`: A library archive is never reported runnable
#[test]
fn runtime_grants_pln_01() {
    pinned(
        "Plan",
        "breaksLibraryNeverRunnable",
        "body: (((project request isLibrary) =? 1) && ((planBlocker request) =? 0))",
        "libraryNeverRunnableHolds",
    );
}

/// `PLN-02`: An app with no known provider is never reported runnable
#[test]
fn runtime_grants_pln_02() {
    pinned(
        "Plan",
        "breaksUnknownProviderNeverRunnable",
        "body: ((not ((project request providerKnown) =? 1)) && ((planBlocker request) =? 0))",
        "unknownProviderNeverRunnableHolds",
    );
}

/// `PLN-03`: A runnable app holds every network grant it needs
#[test]
fn runtime_grants_pln_03() {
    pinned(
        "Plan",
        "breaksRunnableHasNetworkGrant",
        "body: ((((project request needsNetwork) =? 1) && (not ((project request networkGranted) =? 1))) && ((planBlocker request) =? 0))",
        "runnableHasNetworkGrantHolds",
    );
}

/// `PLN-04`: A runnable app holds every storage grant it needs
#[test]
fn runtime_grants_pln_04() {
    pinned(
        "Plan",
        "breaksRunnableHasStoreGrant",
        "body: ((((project request needsStore) =? 1) && (not ((project request storeGranted) =? 1))) && ((planBlocker request) =? 0))",
        "runnableHasStoreGrantHolds",
    );
}

/// `INS-01`: Install by name never accepts a mismatched digest
#[test]
fn runtime_grants_ins_01() {
    pinned(
        "Install",
        "breaksInstallNeedsMatchingDigest",
        "body: ((not ((project request digestMatches) =? 1)) && ((pullInstalls request) =? 1))",
        "installNeedsMatchingDigestHolds",
    );
}

/// `INS-02`: Install never completes with a layer missing
#[test]
fn runtime_grants_ins_02() {
    pinned(
        "Install",
        "breaksInstallNeedsEveryLayer",
        "body: ((not ((project request layersPresent) =? 1)) && ((pullInstalls request) =? 1))",
        "installNeedsEveryLayerHolds",
    );
}

/// `INS-03`: Install needs a passing verdict
#[test]
fn runtime_grants_ins_03() {
    pinned(
        "Install",
        "breaksInstallNeedsPassingVerdict",
        "body: ((not ((project request verdictPasses) =? 1)) && ((pullInstalls request) =? 1))",
        "installNeedsPassingVerdictHolds",
    );
}

/// `INS-04`: What an archive requests never becomes a grant
#[test]
fn runtime_grants_ins_04() {
    pinned(
        "Install",
        "breaksArchiveNeverGrantsItself",
        "body: ((((project request archiveRequests) =? 1) && (not ((project request hostGrant) =? 1))) && ((pullGrant request) =? 1))",
        "archiveNeverGrantsItselfHolds",
    );
}

/// `INS-05`: Install fetches only layers absent on this device
#[test]
fn runtime_grants_ins_05() {
    pinned(
        "Install",
        "breaksInstallFetchesOnlyAbsentLayers",
        "body: (((project request presentLocally) =? 1) && ((layerFetch request) =? 1))",
        "installFetchesOnlyAbsentLayersHolds",
    );
}

/// `OFF-01`: Without a local daemon, work stays in the browser
#[test]
fn runtime_grants_off_01() {
    pinned(
        "Offload",
        "breaksNoDaemonStaysInBrowser",
        "body: ((not ((project request daemonPresent) =? 1)) && (not ((offloadRoute request) =? 0)))",
        "noDaemonStaysInBrowserHolds",
    );
}

/// `OFF-02`: Work is handed only to a daemon on this machine
#[test]
fn runtime_grants_off_02() {
    pinned(
        "Offload",
        "breaksOffloadOnlyToLoopback",
        "body: ((not ((project request loopback) =? 1)) && ((offloadRoute request) =? 1))",
        "offloadOnlyToLoopbackHolds",
    );
}

/// `OFF-03`: Work is handed only to an attested daemon
#[test]
fn runtime_grants_off_03() {
    pinned(
        "Offload",
        "breaksOffloadOnlyWhenAttested",
        "body: ((not ((project request attested) =? 1)) && ((offloadRoute request) =? 1))",
        "offloadOnlyWhenAttestedHolds",
    );
}

/// `OFF-04`: An authentication failure refuses rather than falling back
#[test]
fn runtime_grants_off_04() {
    pinned(
        "Offload",
        "breaksAuthFailureNeverFallsBack",
        "body: (((((project request daemonPresent) =? 1) && ((project request loopback) =? 1)) && ((project request authFailed) =? 1)) && (not ((offloadRoute request) =? 2)))",
        "authFailureNeverFallsBackHolds",
    );
}

/// `OFF-05`: An unconfigured model engine refuses rather than simulating an answer
#[test]
fn runtime_grants_off_05() {
    pinned(
        "Offload",
        "breaksUnconfiguredEngineRefuses",
        "body: ((not ((project request engineConfigured) =? 1)) && (not ((engineReply request) =? 2)))",
        "unconfiguredEngineRefusesHolds",
    );
}

/// `AUD-01`: No effect happens before its decision is recorded
#[test]
fn runtime_grants_aud_01() {
    pinned(
        "Audit",
        "breaksNoEffectWithoutRecord",
        "body: ((not ((project request recorded) =? 1)) && ((effectProceeds request) =? 1))",
        "noEffectWithoutRecordHolds",
    );
}

/// `AUD-02`: No effect happens without an allow
#[test]
fn runtime_grants_aud_02() {
    pinned(
        "Audit",
        "breaksNoEffectWithoutAllow",
        "body: ((not ((project request decision) =? 1)) && ((effectProceeds request) =? 1))",
        "noEffectWithoutAllowHolds",
    );
}

/// `SES-01`: An app is invoked only while its session is open
#[test]
fn runtime_grants_ses_01() {
    pinned(
        "Session",
        "breaksInvokeOnlyWhileOpen",
        "body: (((not ((project request started) =? 1)) || ((project request stopped) =? 1)) && ((invokeAllowed request) =? 1))",
        "invokeOnlyWhileOpenHolds",
    );
}

/// `SES-02`: Stopping a stopped session leaves it stopped
#[test]
fn runtime_grants_ses_02() {
    pinned(
        "Session",
        "breaksStopIsIdempotent",
        "body: (((project request stopped) =? 1) && (not ((stopState request) =? 1)))",
        "stopIsIdempotentHolds",
    );
}
