//! Execute the current main integration boundary and its negative controls.
use std::path::PathBuf;
use std::process::Command;

#[test]
fn current_main_integration_fa_24() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("repository root")
        .to_path_buf();
    let output = Command::new("node")
        .args(["--test", "--test-reporter=tap"])
        .arg(root.join("studio/tools/current_main_integration.test.mjs"))
        .arg(root.join("studio/tools/rules_transaction.test.mjs"))
        .arg(root.join("studio/tools/main_stateful_integration.test.mjs"))
        .arg(root.join("studio/tools/notation_host_integration.test.mjs"))
        .arg(root.join("studio/tools/backlog_workflows.test.mjs"))
        .output()
        .expect("the locked SDK supplies Node");
    let report = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success(),
        "{report}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    for required in [
        "# tests 31",
        "# pass 31",
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
