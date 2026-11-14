Feature: prism-r4-route

  @FA-87 @build
  Scenario: A chat turn is answered only by Foundry's own model in Prism, and Prism R4 refuses every route to another model before the request leaves the tab
    Given the Prism R4 decision, afflom/me's spec byte for byte, and a studio whose grant names no route
    When a builder sends an idea from the home box or the chat with any model selection
    Then a route to a model outside Foundry is refused by R4 before the request is looked up or made
    And the device model's answer is shown, sealed and applied only when R4 answers answer for its weights and engine
    And weights not read back by their verified image address, or an engine without its address, are refused
    And the studio offers and defaults to the device model only, and a stored cloud selection is moved to it once
