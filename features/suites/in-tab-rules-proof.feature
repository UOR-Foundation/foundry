Feature: in-tab-rules-proof

  @FA-87 @build
  Scenario: With the in-tab switch on, a rules app is proved in the tab: Lean's kernel judges proofs written there from the spec, only the Prism guest's word proved marks it proved, and the hosted verifier is asked only when the tab does not prove
    Given the studio's own Lean kernel and checker library, each named by its SHA-256 in the shell's manifest, and the pinned Forge kernel guest
    When a rules app is approved with the switch on
    Then Lean's kernel in the tab judges a proof of each guarantee written there from the spec, and the guest compares what the tab derived
    And the app is proved only on the guest's word proved, with no attestation and no request to the hosted verifier
    And a guarantee the rules break, another statement, kernel or library, an axiom outside the two declared, or a guest with no verdict leave it unproved
    And a spec the tab cannot read as boxes, or any answer short of proved, goes to the hosted verifier as before
    And publishing asks the hosted verifier for its attestation before it builds rules proved in the tab
    And with the switch off nothing is asked of the tab
