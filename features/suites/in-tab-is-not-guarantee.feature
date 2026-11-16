Feature: in-tab-is-not-guarantee

  @FA-91 @build
  Scenario: A guarantee whose conditions say is not or != is proved in the tab when it holds: Lean's kernel proves it below and above the value and joins the two with a lemma it checks
    Given the parking-fee fixture, whose fourth guarantee is always premium over eight hours unless the vehicle is a motorcycle
    When prism.prove proves it in this process with the shipped Lean kernel and library and the pinned guest
    Then every guarantee is proved and the guest says proved, on propext and Quot.sound
    And the same guarantee for every vehicle but a car, which a motorcycle breaks, is refused and named
    And ruleHolds_split, proved in studio/proof, joins the halves, and the kernel refuses a join with the wrong value
