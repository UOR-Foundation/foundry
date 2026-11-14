//! The `prism-r4-route` suite: one test per scenario in `features/suites/prism-r4-route.feature`.
use std::path::PathBuf;
use std::process::Command;

/// `FA-87`: A chat turn is answered only by Foundry's own model in Prism, and Prism R4 refuses every route to another model before the request leaves the tab
#[test]
fn prism_r4_route_fa_87() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("repository root")
        .to_path_buf();
    let output = Command::new("node")
        .args(["--test", "--test-reporter=tap"])
        .arg(root.join("studio/tools/prism_r4_route.test.mjs"))
        .output()
        .expect("the locked SDK supplies Node");
    let report = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success(),
        "{report}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    for required in [
        "# tests 5",
        "# pass 5",
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
