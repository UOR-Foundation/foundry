//! The `rules-without-hosted-verifier` suite: one test per scenario in `features/suites/rules-without-hosted-verifier.feature`.
use std::path::PathBuf;
use std::process::Command;

/// `FA-89`: Approving or publishing a rules app asks no hosted verifier: approval proves only in the tab, and publish builds with no attestation, the published repository's own CI proving the model with the locked SDK
#[test]
fn rules_without_hosted_verifier_fa_89() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("repository root")
        .to_path_buf();
    // The suite runs the host's own functions, with the hosted prover replaced by one that fails if it is called.
    let output = Command::new("node")
        .args(["--test", "--test-reporter=tap"])
        .arg(root.join("studio/tools/rules_without_hosted_verifier.test.mjs"))
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
        "# tests 3",
        "# pass 3",
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
