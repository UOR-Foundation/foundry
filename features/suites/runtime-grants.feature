Feature: runtime-grants

  The proved decisions behind priced grants and the Hologram Live runtime contracts the
  Forge kernel adopts. Each concern is its own module under app/src/Runtime/, holding its
  records, its decisions and the theorems that no request meets a violation.

  @MON-01 @build
  Scenario: A capability with no price never opens a checkout
    Given the model in app/src/Runtime/Payment.lex.tex
    When the Lean kernel checks freeNeverChargesHolds during prismpm verify
    Then no request meets breaksFreeNeverCharges

  @MON-02 @build
  Scenario: A paid capability is never served without a signed receipt
    Given the model in app/src/Runtime/Payment.lex.tex
    When the Lean kernel checks paidNeedsSignedReceiptHolds during prismpm verify
    Then no request meets breaksPaidNeedsSignedReceipt

  @MON-03 @build
  Scenario: An expired receipt never serves a paid capability
    Given the model in app/src/Runtime/Payment.lex.tex
    When the Lean kernel checks expiredReceiptNeverServesHolds during prismpm verify
    Then no request meets breaksExpiredReceiptNeverServes

  @MON-04 @build
  Scenario: A receipt serves only its own user, app and capability
    Given the model in app/src/Runtime/Payment.lex.tex
    When the Lean kernel checks receiptBoundToHolderHolds during prismpm verify
    Then no request meets breaksReceiptBoundToHolder

  @MON-05 @build
  Scenario: A denial wins over a paid receipt
    Given the model in app/src/Runtime/Payment.lex.tex
    When the Lean kernel checks paidDenialWinsHolds during prismpm verify
    Then no request meets breaksPaidDenialWins

  @MON-06 @build
  Scenario: Paying never replaces the user's grant
    Given the model in app/src/Runtime/Payment.lex.tex
    When the Lean kernel checks paymentIsNotConsentHolds during prismpm verify
    Then no request meets breaksPaymentIsNotConsent

  @MON-07 @build
  Scenario: Checkout opens only when the owner has signed the payout binding
    Given the model in app/src/Runtime/Payment.lex.tex
    When the Lean kernel checks checkoutNeedsPayoutBindingHolds during prismpm verify
    Then no request meets breaksCheckoutNeedsPayoutBinding

  @NET-01 @build
  Scenario: A fetch needs both the archive's declaration and the user's grant
    Given the model in app/src/Runtime/Network.lex.tex
    When the Lean kernel checks fetchNeedsDeclarationAndGrantHolds during prismpm verify
    Then no request meets breaksFetchNeedsDeclarationAndGrant

  @NET-02 @build
  Scenario: A fetch stays within the granted origin and path
    Given the model in app/src/Runtime/Network.lex.tex
    When the Lean kernel checks fetchStaysInScopeHolds during prismpm verify
    Then no request meets breaksFetchStaysInScope

  @NET-03 @build
  Scenario: A fetch is HTTPS GET only
    Given the model in app/src/Runtime/Network.lex.tex
    When the Lean kernel checks fetchIsHttpsGetOnlyHolds during prismpm verify
    Then no request meets breaksFetchIsHttpsGetOnly

  @NET-04 @build
  Scenario: A fetch never exceeds its byte limit
    Given the model in app/src/Runtime/Network.lex.tex
    When the Lean kernel checks fetchIsBoundedHolds during prismpm verify
    Then no request meets breaksFetchIsBounded

  @NET-05 @build
  Scenario: A denial wins over a network grant
    Given the model in app/src/Runtime/Network.lex.tex
    When the Lean kernel checks fetchDenialWinsHolds during prismpm verify
    Then no request meets breaksFetchDenialWins

  @CMP-01 @build
  Scenario: A child component never holds a capability its parent lacks
    Given the model in app/src/Runtime/Composition.lex.tex
    When the Lean kernel checks childNeverExceedsParentHolds during prismpm verify
    Then no request meets breaksChildNeverExceedsParent

  @CMP-02 @build
  Scenario: A child holds a capability only when it was delegated
    Given the model in app/src/Runtime/Composition.lex.tex
    When the Lean kernel checks childNeedsDelegationHolds during prismpm verify
    Then no request meets breaksChildNeedsDelegation

  @CMP-03 @build
  Scenario: A child's quota never exceeds its parent's
    Given the model in app/src/Runtime/Composition.lex.tex
    When the Lean kernel checks childQuotaBoundedHolds during prismpm verify
    Then no request meets breaksChildQuotaBounded

  @CMP-04 @build
  Scenario: Nothing is prepared until every grant in the chain is admitted
    Given the model in app/src/Runtime/Composition.lex.tex
    When the Lean kernel checks admissionBeforePreparationHolds during prismpm verify
    Then no request meets breaksAdmissionBeforePreparation

  @STO-01 @build
  Scenario: A new write never exceeds the storage quota
    Given the model in app/src/Runtime/Storage.lex.tex
    When the Lean kernel checks writeWithinQuotaHolds during prismpm verify
    Then no request meets breaksWriteWithinQuota

  @STO-02 @build
  Scenario: A write needs a grant and an admitted root
    Given the model in app/src/Runtime/Storage.lex.tex
    When the Lean kernel checks writeNeedsGrantAndRootHolds during prismpm verify
    Then no request meets breaksWriteNeedsGrantAndRoot

  @STO-03 @build
  Scenario: Writing bytes already stored costs no quota
    Given the model in app/src/Runtime/Storage.lex.tex
    When the Lean kernel checks identicalBlobIsFreeHolds during prismpm verify
    Then no request meets breaksIdenticalBlobIsFree

  @STO-04 @build
  Scenario: A denial wins over a storage grant
    Given the model in app/src/Runtime/Storage.lex.tex
    When the Lean kernel checks writeDenialWinsHolds during prismpm verify
    Then no request meets breaksWriteDenialWins

  @PLN-01 @build
  Scenario: A library archive is never reported runnable
    Given the model in app/src/Runtime/Plan.lex.tex
    When the Lean kernel checks libraryNeverRunnableHolds during prismpm verify
    Then no request meets breaksLibraryNeverRunnable

  @PLN-02 @build
  Scenario: An app with no known provider is never reported runnable
    Given the model in app/src/Runtime/Plan.lex.tex
    When the Lean kernel checks unknownProviderNeverRunnableHolds during prismpm verify
    Then no request meets breaksUnknownProviderNeverRunnable

  @PLN-03 @build
  Scenario: A runnable app holds every network grant it needs
    Given the model in app/src/Runtime/Plan.lex.tex
    When the Lean kernel checks runnableHasNetworkGrantHolds during prismpm verify
    Then no request meets breaksRunnableHasNetworkGrant

  @PLN-04 @build
  Scenario: A runnable app holds every storage grant it needs
    Given the model in app/src/Runtime/Plan.lex.tex
    When the Lean kernel checks runnableHasStoreGrantHolds during prismpm verify
    Then no request meets breaksRunnableHasStoreGrant

  @INS-01 @build
  Scenario: Install by name never accepts a mismatched digest
    Given the model in app/src/Runtime/Install.lex.tex
    When the Lean kernel checks installNeedsMatchingDigestHolds during prismpm verify
    Then no request meets breaksInstallNeedsMatchingDigest

  @INS-02 @build
  Scenario: Install never completes with a layer missing
    Given the model in app/src/Runtime/Install.lex.tex
    When the Lean kernel checks installNeedsEveryLayerHolds during prismpm verify
    Then no request meets breaksInstallNeedsEveryLayer

  @INS-03 @build
  Scenario: Install needs a passing verdict
    Given the model in app/src/Runtime/Install.lex.tex
    When the Lean kernel checks installNeedsPassingVerdictHolds during prismpm verify
    Then no request meets breaksInstallNeedsPassingVerdict

  @INS-04 @build
  Scenario: What an archive requests never becomes a grant
    Given the model in app/src/Runtime/Install.lex.tex
    When the Lean kernel checks archiveNeverGrantsItselfHolds during prismpm verify
    Then no request meets breaksArchiveNeverGrantsItself

  @INS-05 @build
  Scenario: Install fetches only layers absent on this device
    Given the model in app/src/Runtime/Install.lex.tex
    When the Lean kernel checks installFetchesOnlyAbsentLayersHolds during prismpm verify
    Then no request meets breaksInstallFetchesOnlyAbsentLayers

  @OFF-01 @build
  Scenario: Without a local daemon, work stays in the browser
    Given the model in app/src/Runtime/Offload.lex.tex
    When the Lean kernel checks noDaemonStaysInBrowserHolds during prismpm verify
    Then no request meets breaksNoDaemonStaysInBrowser

  @OFF-02 @build
  Scenario: Work is handed only to a daemon on this machine
    Given the model in app/src/Runtime/Offload.lex.tex
    When the Lean kernel checks offloadOnlyToLoopbackHolds during prismpm verify
    Then no request meets breaksOffloadOnlyToLoopback

  @OFF-03 @build
  Scenario: Work is handed only to an attested daemon
    Given the model in app/src/Runtime/Offload.lex.tex
    When the Lean kernel checks offloadOnlyWhenAttestedHolds during prismpm verify
    Then no request meets breaksOffloadOnlyWhenAttested

  @OFF-04 @build
  Scenario: An authentication failure refuses rather than falling back
    Given the model in app/src/Runtime/Offload.lex.tex
    When the Lean kernel checks authFailureNeverFallsBackHolds during prismpm verify
    Then no request meets breaksAuthFailureNeverFallsBack

  @OFF-05 @build
  Scenario: An unconfigured model engine refuses rather than simulating an answer
    Given the model in app/src/Runtime/Offload.lex.tex
    When the Lean kernel checks unconfiguredEngineRefusesHolds during prismpm verify
    Then no request meets breaksUnconfiguredEngineRefuses

  @AUD-01 @build
  Scenario: No effect happens before its decision is recorded
    Given the model in app/src/Runtime/Audit.lex.tex
    When the Lean kernel checks noEffectWithoutRecordHolds during prismpm verify
    Then no request meets breaksNoEffectWithoutRecord

  @AUD-02 @build
  Scenario: No effect happens without an allow
    Given the model in app/src/Runtime/Audit.lex.tex
    When the Lean kernel checks noEffectWithoutAllowHolds during prismpm verify
    Then no request meets breaksNoEffectWithoutAllow

  @SES-01 @build
  Scenario: An app is invoked only while its session is open
    Given the model in app/src/Runtime/Session.lex.tex
    When the Lean kernel checks invokeOnlyWhileOpenHolds during prismpm verify
    Then no request meets breaksInvokeOnlyWhileOpen

  @SES-02 @build
  Scenario: Stopping a stopped session leaves it stopped
    Given the model in app/src/Runtime/Session.lex.tex
    When the Lean kernel checks stopIsIdempotentHolds during prismpm verify
    Then no request meets breaksStopIsIdempotent
