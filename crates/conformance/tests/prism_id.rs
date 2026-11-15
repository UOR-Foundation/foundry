//! The `prism-id` suite: one test per scenario in `features/suites/prism-id.feature`.
use std::path::PathBuf;
use std::process::Command;

/// `FA-88`: A session from Foundry's frame verifies by stitch's Prism id only for the app, the active device and the time it was signed for, and a removed device or another id signs none
#[test]
fn prism_id_fa_88() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("repository root")
        .to_path_buf();
    // The frame's own checks, without the Chromium flow, which needs a browser.
    let output = Command::new("node")
        .args([
            "--test",
            "--test-reporter=tap",
            "--test-name-pattern=the frame's checks",
        ])
        .arg(root.join("identity/test.mjs"))
        .output()
        .expect("the locked SDK supplies Node");
    let report = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success(),
        "{report}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
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
