//! The `in-tab-every-rule` suite: one test per scenario in `features/suites/in-tab-every-rule.feature`.
use std::path::PathBuf;
use std::process::Command;

/// `FA-88`: The tab proves a rules app whatever its conditions say: is not, a comparison of two fields, and a number with no maximum, up to the largest number a request can carry
#[test]
fn in_tab_every_rule_fa_88() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("repository root")
        .to_path_buf();
    // The suite runs the fixtures' own specs through the shell's Lean kernel and the pinned Forge kernel guest.
    let output = Command::new("node")
        .args(["--test", "--test-reporter=tap", "--test-timeout=200000"])
        .arg(root.join("studio/tools/in_tab_every_rule.test.mjs"))
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
        "# tests 4",
        "# pass 4",
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
