//! The `in-tab-kernel-verdict` suite: one test per scenario in `features/suites/in-tab-kernel-verdict.feature`.
use std::path::PathBuf;
use std::process::Command;

/// `FA-86`: A proof verdict is decided by the Prism guest from addresses the tab derived and the result of a kernel run in the tab, never from a server reply
#[test]
fn in_tab_kernel_verdict_fa_86() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("repository root")
        .to_path_buf();
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
        "# tests 8",
        "# pass 8",
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

/// `FA-91`: A guarantee whose conditions say is not or != is proved in the tab when it holds: Lean's kernel proves it below and above the value and joins the two with a lemma it checks
#[test]
fn in_tab_is_not_guarantee_fa_91() {
    // The suite runs prism.prove as the studio runs it, with the shipped Lean kernel and library and the pinned
    // guest; FA-86's test above reads the same report and holds the counts.
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("repository root")
        .to_path_buf();
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
    assert!(
        report.lines().any(|line| line
            == "ok 8 - a guarantee that says is not is proved when it holds, below and above the value, and refused when it does not"),
        "the is-not guarantee test did not pass: {report}"
    );
    let regions = include_str!("../../../studio/proof/PrismLive/Regions.lean");
    assert!(regions.contains("theorem ruleHolds_split"));
}
