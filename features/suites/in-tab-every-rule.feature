Feature: in-tab-every-rule

  @FA-88 @build
  Scenario: The tab proves a rules app whatever its conditions say: is not, a comparison of two fields, and a number with no maximum, up to the largest number a request can carry
    Given the fixture specs RSVP, which compares two fields, the parking fee, which says is not, and the library fee
    When each is proved in the tab through tab_sound, with the shell's own Lean kernel and the pinned guest
    Then each is proved, on propext and Quot.sound, and so is RSVP with no maximum on seats and a spec comparing fields by = and !=
    And the data the tab proves answers every sampled request as the spec's rules answer it
    And RSVP without its waitlist rule, and the parking fee with its is not guarantee turned around, are refused, the broken guarantee named
    And an edit judges only the facts it changed
