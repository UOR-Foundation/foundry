Feature: rules-without-hosted-verifier

  @FA-89 @build
  Scenario: Approving or publishing a rules app asks no hosted verifier: approval proves only in the tab, and publish builds with no attestation, the published repository's own CI proving the model with the locked SDK
    Given the host's own approval, proof and publish functions, with the hosted prover replaced by one that fails if it is called
    When a rules app is approved, proved and published
    Then the tab is the only prover asked, and its refusal leaves the rules checked, with its reason and no proof
    And a proof is committed only when its answer is in, so an approval cancelled while the tab proves is rolled back
    And publish hands the build the attestation the rules carry, none for a proof made in the tab, and the published app says its proof ran in the SDK image
    And rules over the SDK's rule limit are proved and not published
    And no message about a rules app names the hosted verifier
