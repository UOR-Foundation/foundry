Feature: Exact chat provider routing
  @FA-81 @build
  Scenario: Captured cloud selections retain exact provider and model identity
    Given a chat that still holds an OpenRouter or Featherless model independent of Home defaults
    When the user submits a turn
    Then Prism R4 refuses it before any request, and no other engine answers in its place
    And token accounting and the stored selection keep the exact captured route

  @FA-81 @build
  Scenario: Invalid explicit selections cannot silently select a different engine
    Given a malformed model selection or an unsupported provider
    When chat routing is requested
    Then a fixed typed refusal occurs before transcript or network effects
