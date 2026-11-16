Feature: private-workspace

  @FA-91 @build
  Scenario: A private workspace opens only for the Prism id that owns it, on a device with a live session and its current boundary key; a record is read only when authentic and in place and stored only sealed; the workspace kept before an id moves in once; and Foundry's Prism kernel names every refusal
    Given the Workspace module in Foundry's Prism kernel, reached by the workspace request prefix
    When the kernel is asked to open a workspace, read or store a record, move the workspace kept before an id, or remove its plain copy
    Then it answers ok only for the owning id on a device with a live session and the current boundary key, for an authentic record in its place, for a sealed record within quota, for a first move, and for a removal after the sealed copy is committed
    And every other request is refused by name, a removed device first, and a wrong version, a trailing word or an unknown kind is malformedWorkspaceRequest
    And each answer is a theorem Lean proves by evaluation and an acceptance vector the compiled guest replays

  @FA-93 @build
  Scenario: Studio keeps a visitor's work sealed to their Prism ID: each record is sealed as it is stored and opened as it is read, only as Foundry's Prism kernel answers; the work kept before moves in once; a removed device's work is cleared; and the visitor is told each outcome in one sentence
    Given Studio's device store, the workspace key the Prism frame keeps for this origin, and the kernel guest Studio pins
    When Studio opens over work kept before the workspace, reads and stores records, meets a record altered, copied or planted in the clear, and opens on a device removed from the visitor's Prism ID
    Then the work kept before is sealed in place in one transaction, opens as it was written, and the visitor is told so once
    And every record stored afterwards is sealed with seal_bytes, except the grants and published .holo bytes the service worker reads
    And an altered or planted record is refused as recordTampered and a copied one as recordMisplaced, and neither is returned
    And on a removed device everything kept where work belongs is cleared before a new key is made, so nothing left behind enters the new workspace
    And the sentence the visitor reads for each answer is a statement of the experience module

  @FA-94 @build
  Scenario: Foundry's Prism kernel decides each record another device of the visitor's Prism ID sends: the newer copy wins, a tie goes the same way on both devices so they converge, and nothing unauthentic, misplaced, device-local or over quota enters
    Given the Workspace module in Foundry's Prism kernel, reached by the workspace request prefix with kind 5
    When it is asked whether to take a record another device sent or keep its own, with whether the place syncs, the sealed bytes are authentic and in place, the record fits, this device holds the place, the sent record is a deletion, both times and who wins a tie
    Then it answers take only for a newer copy, an absent place, or a tie the sender wins, and keep otherwise
    And two devices exchanging one place never both take, whatever else holds, so they converge on one copy
    And it never takes an unauthentic, misplaced or device-local record, nor one over quota unless it is a deletion, and names each refusal
    And each answer is a theorem Lean proves by evaluation and an acceptance vector the compiled guest replays

  @FA-95 @build
  Scenario: Studio brings the visitor's work to their other devices app by app: the pages of one Prism ID meet on the frame's sealed channel, connect directly, take the newer copy of each app as Foundry's Prism kernel decides, check every byte through Import before replacing anything, keep an app a window shows until it closes, follow deletions, and keep what arrives sealed
    Given two browsers on the whole shell, the second joined to the first's Prism ID through the Prism ID panel, and the relay in memory
    When the first makes an app and later deletes it
    Then the second holds the app, sealed, and then no longer holds it
    And every merge request Studio sends is answered by the guest Studio pins as the kernel's merge decision
    And a copy that fails Import's checks is refused before the local copy is touched

