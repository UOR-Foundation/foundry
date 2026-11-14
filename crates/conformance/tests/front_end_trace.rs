//! The `front-end-trace` suite: one test per scenario in `features/suites/front-end-trace.feature`.
use std::path::PathBuf;
use std::process::Command;

/// `PM-02`: Every IPC call a Foundry screen makes reaches a back-end feature the screen requires, every register ID and registry feature is owned by exactly one back-end feature, and every back-end feature, screen and stakeholder is reached by a journey
#[test]
fn front_end_trace_pm_02() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("repository root")
        .to_path_buf();
    let output = Command::new("node")
        .args(["--test", "--test-reporter=tap"])
        .arg(root.join("studio/tools/foundry_trace.test.mjs"))
        .output()
        .expect("the locked SDK supplies Node");
    let report = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success(),
        "{report}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
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
