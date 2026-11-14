//! The `in-tab-rules-proof` suite: one test per scenario in `features/suites/in-tab-rules-proof.feature`.
use std::path::PathBuf;
use std::process::Command;

/// `FA-87`: With the in-tab switch on, a rules app is proved in the tab: Lean's kernel judges proofs written there from the spec, only the Prism guest's word proved marks it proved, and the hosted verifier is asked only when the tab does not prove
#[test]
fn in_tab_rules_proof_fa_87() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("repository root")
        .to_path_buf();
    // The suite runs the shell's own Lean kernel and the pinned Forge kernel guest; nothing stands in for either.
    let output = Command::new("node")
        .args(["--test", "--test-reporter=tap", "--test-timeout=120000"])
        .arg(root.join("studio/tools/in_tab_prove.test.mjs"))
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
        "# tests 6",
        "# pass 6",
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
