Feature: in-tab-rules-proof

  @FA-87 @build
  Scenario: A rules app is proved in the tab: Lean's kernel judges proofs written there from the spec, and only the Prism guest's word proved marks it proved
    Given the studio's own Lean kernel and checker library, each named by its SHA-256 in the shell's manifest, and the pinned Forge kernel guest
    When a rules app is approved
    Then Lean's kernel in the tab judges a proof of each guarantee written there from the spec, and the guest compares what the tab derived
    And the app is proved only on the guest's word proved, with no attestation
    And a guarantee the rules break, another statement, kernel or library, an axiom outside the two declared, or a guest with no verdict leave it unproved
