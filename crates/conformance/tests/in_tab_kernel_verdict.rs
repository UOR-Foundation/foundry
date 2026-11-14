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
        "# tests 7",
        "# pass 7",
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
