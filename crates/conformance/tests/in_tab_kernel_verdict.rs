//! The `in-tab-kernel-verdict` suite: one test per scenario in `features/suites/in-tab-kernel-verdict.feature`.
use std::path::PathBuf;
use std::process::Command;

/// `FA-86`: A proof verdict is decided by the Prism guest from addresses the tab derived and the result of a kernel run in the tab, never from a server reply
#[test]
fn in_tab_kernel_verdict_fa_86() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = Command::new("node")
        .args(["--test", "--test-reporter=tap"])
        .arg(root.join("studio/tools/in_tab_kernel_verdict.test.mjs"))
        .output()
        .expect("the locked SDK supplies Node");
    let report = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success(),
        "{report}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    // A run that skipped, filtered or lost a test is not the oracle.
    for required in [
        "# tests 9",
        "# pass 9",
        "# fail 0",
        "# cancelled 0",
        "# skipped 0",
        "# todo 0",
    ] {
        assert!(
            report.lines().any(|line| line == required),
            "incomplete oracle: {report}"
        );
    }
}

/// `FA-90`: A published app's answer is decided by the rule judge in Foundry's Prism kernel: the first rule whose conditions all hold decides, otherwise decides when none does, and a request outside the fields' bounds is refused
#[test]
fn rule_judge_fa_90() {
    // Lean proves every ruleWords theorem by evaluation (`just app`), and the kernel gate replays each
    // as an acceptance vector in the compiled guest; this holds the two to each other and to dispatch.
    let judge = include_str!("../../../app/src/RuleJudge.lex.tex");
    let kernel = include_str!("../../../app/src/ForgeKernel.lex.tex");
    assert!(
        kernel.contains("(RuleJudge::dispatchRule (sliceOf value 5")
            && kernel.contains("(ruleAcceptance))")
    );
    let theorems = judge.matches("name: ruleWords_").count();
    let vectors = kernel.matches("request := 0x72756c6520").count();
    assert_eq!(theorems, vectors);
    assert!(theorems >= 9);
}

/// `FA-91`: A private workspace opens only for the Prism id that owns it, on a device with a live session and its current boundary key; a record is read only when authentic and in place and stored only sealed; the workspace kept before an id moves in once; and Foundry's Prism kernel names every refusal
#[test]
fn private_workspace_fa_91() {
    // Lean proves every workspaceWords theorem by evaluation (`just app`) and the kernel gate replays
    // each as an acceptance vector in the compiled guest; this holds the two to each other and to dispatch.
    let workspace = include_str!("../../../app/src/WorkspaceProofs.lex.tex");
    let kernel = include_str!("../../../app/src/ForgeKernel.lex.tex");
    assert!(kernel.contains("(Workspace::dispatchWorkspace (sliceOf value 10"));
    let theorems = workspace.matches("name: workspaceWords_").count();
    assert_eq!(
        theorems,
        kernel.matches("request := 0x776f726b737061636520").count()
    );
    assert!(theorems >= 19 && kernel.contains("(workspaceAcceptance))))"));
}

/// `FA-93`: Studio keeps a visitor's work sealed to their Prism ID: each record is sealed as it is stored and opened as it is read, only as Foundry's Prism kernel answers; the work kept before moves in once; a removed device's work is cleared; and the visitor is told each outcome in one sentence
///
/// Here, every request Studio's sealed store makes, asked of the guest Studio pins; the sealing itself runs in
/// Chromium in Studio CI (`studio/tools/storage_request_browser.mjs`), where the shell is built.
#[test]
fn private_workspace_fa_93() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = Command::new("node")
        .args(["--test", "--test-reporter=tap"])
        .arg(root.join("studio/tools/in_tab_kernel_verdict.test.mjs"))
        .output()
        .expect("the locked SDK supplies Node");
    let report = String::from_utf8_lossy(&output.stdout);
    let name = "the pinned guest answers every workspace request Studio makes, as Studio acts on it (FA-93)";
    assert!(
        output.status.success()
            && report
                .lines()
                .any(|l| l.starts_with("ok ") && l.ends_with(name)),
        "{report}"
    );
}

/// `FA-94`: Foundry's Prism kernel decides each record another device of the visitor's Prism ID sends: the newer copy wins, a tie goes the same way on both devices so they converge, and nothing unauthentic, misplaced, device-local or over quota enters
#[test]
fn private_workspace_fa_94() {
    // Lean proves the three merge theorems and every merge word by evaluation (`just app`), and the kernel
    // gate replays each word as an acceptance vector; this holds them to each other and to dispatch.
    let workspace = include_str!("../../../app/src/Workspace.lex.tex");
    let proofs = include_str!("../../../app/src/WorkspaceProofs.lex.tex");
    let kernel = include_str!("../../../app/src/ForgeKernel.lex.tex");
    assert!(
        workspace.contains("name: mergeCode,")
            && workspace.contains("=? 5) && ((prim length words : Nat) =? 14)")
    );
    for theorem in [
        "mergeNeverTakesOlderHolds",
        "mergeConvergesHolds",
        "mergeTakesOnlyWhatMayEnterHolds",
    ] {
        assert!(proofs.contains(&format!("name: {theorem},")), "{theorem}");
    }
    let words = proofs.matches("name: workspaceWords_merge").count();
    // "workspace 0100000005000000": version 1, kind 5.
    let vectors = kernel
        .matches("request := 0x776f726b73706163652030313030303030303035303030303030")
        .count();
    assert_eq!(words, vectors);
    assert!(words >= 13);
}

/// `FA-95`: Studio brings the visitor's work to their other devices app by app: the pages of one Prism ID meet on the frame's sealed channel, connect directly, take the newer copy of each app as Foundry's Prism kernel decides, check every byte through Import before replacing anything, keep an app a window shows until it closes, follow deletions, and keep what arrives sealed
///
/// Here, the merge requests Studio sends, asked of the guest it pins; two browsers sync in Studio CI
/// (`studio/tools/storage_request_browser.mjs`).
#[test]
fn private_workspace_fa_95() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = Command::new("node")
        .args(["--test", "--test-reporter=tap"])
        .arg(root.join("studio/tools/in_tab_kernel_verdict.test.mjs"))
        .output()
        .expect("the locked SDK supplies Node");
    let report = String::from_utf8_lossy(&output.stdout);
    let name = "the pinned guest decides the merge requests Studio sync sends (FA-95)";
    assert!(
        output.status.success()
            && report
                .lines()
                .any(|l| l.starts_with("ok ") && l.ends_with(name)),
        "{report}"
    );
}
