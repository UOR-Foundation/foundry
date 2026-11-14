Feature: Chat model picker scope
  @FA-79 @build
  Scenario: A mounted chat displays and changes its committed model
    Given a chat under the configured application base with a model distinct from Home, stored before Foundry offered only its own model
    When the user opens the model picker, which offers the device model alone, and selects it
    Then the chat selection survives reload without changing the Home default or another chat
    And an empty chat also retains its explicit model selection

  @FA-79 @build
  Scenario: Home selection and incomplete chat identity stay distinct
    Given Home or a chat route without a valid loaded identity
    When the model picker is used
    Then Home changes only the default and an incomplete chat cannot write a default by accident
