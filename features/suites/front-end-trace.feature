Feature: front-end-trace

  The front end drives the back end. A screen of app/product.json names the back-end features it
  requires; studio/tools/foundry_surfaces.mjs walks its renderer code from vendor/dyad/src and
  resolves every IPC call to its channel and the command-registry feature that answers it, and
  studio/tools/foundry_model.mjs refuses any call that no required feature owns.

  @PM-02 @build
  Scenario: Every IPC call a Foundry screen makes reaches a back-end feature the screen requires, every register ID and registry feature is owned by exactly one back-end feature, and every back-end feature, screen and stakeholder is reached by a journey
    Given app/product.json, model/ids.toml, the command registry and the renderer code of each screen
    When the projector traces each screen's calls to channels and registry features
    Then a call to a registry feature or host channel that no required feature owns is refused
    And a register ID carried by two back-end features, or by none, is refused
    And a back-end feature no screen requires, a screen in no journey and a stakeholder without a journey are refused
    And a threat on a category STRIDE per element does not open on its element is refused
