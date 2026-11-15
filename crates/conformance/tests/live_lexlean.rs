//! The `live-lexlean` suite: one test per scenario in `features/suites/live-lexlean.feature`.
//!
//! Lean checks the proofs when the studio workflow builds `studio/proof` and prints
//! their axioms. What these tests hold fixed is the claim each proof is about: a
//! weakened statement, a compiler-trusting tactic or an unchecked axiom would still
//! build, and would no longer be the claim its row makes.

use std::path::PathBuf;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("crates/conformance is two below the root")
        .to_path_buf()
}

fn read(path: &str) -> String {
    std::fs::read_to_string(root().join(path)).unwrap_or_else(|e| panic!("{path}: {e}"))
}

/// The studio workflow builds the proofs and refuses any axiom beyond propext and
/// Quot.sound for all three theorems, so the claim is checked where it is made.
fn built_and_axioms_checked(theorem: &str) {
    let workflow = read(".github/workflows/studio.yml");
    assert!(
        workflow.contains("cd proof && lake build && lake env lean PrismLive/Axioms.lean"),
        "the studio workflow no longer builds the proofs and prints their axioms"
    );
    assert!(
        workflow.contains(r#"depends on axioms: \[propext, Quot.sound\]' axioms.txt)" = 3"#),
        "the studio workflow no longer requires exactly propext and Quot.sound of all three theorems"
    );
    let axioms = read("studio/proof/PrismLive/Axioms.lean");
    assert!(
        axioms.contains(&format!("#print axioms {theorem}\n")),
        "Axioms.lean no longer prints the axioms of {theorem}"
    );
}

/// `LL-01`: Every guarantee holds on every request in the bounds when every local obligation passes
#[test]
fn live_lexlean_ll_01() {
    let regions = read("studio/proof/PrismLive/Regions.lean");
    let statement = "theorem regionCheck_sound (B : Box) (rules : List Rule) (props : List Property) (d : Nat)\n    (hc : regionCheck B rules props d = true) (p : Property) (hp : p ∈ props)\n    (x : List Nat) (hx : inBox B x = true) : breaks rules d p x = false := by";
    assert!(
        regions.contains(statement),
        "regionCheck_sound no longer states that a passing check means no request in the box breaks a guarantee"
    );
    for forbidden in ["sorry", "native_decide", "\naxiom "] {
        assert!(
            !regions.contains(forbidden),
            "Regions.lean uses {forbidden:?}"
        );
    }
    built_and_axioms_checked("PrismLive.Kernel.regionCheck_sound");
}

/// `LL-02`: Every guarantee of the Verdant Resonance fixture holds on every request in its bounds
#[test]
fn live_lexlean_ll_02() {
    let verdant = read("studio/proof/PrismLive/VerdantRegions.lean");
    assert!(
        verdant.contains(
            "theorem checked : regionCheck B rules props d = true := by decide +kernel\n"
        ),
        "Verdant's obligations are no longer decided by Lean's kernel alone"
    );
    assert!(
        verdant.contains("theorem all_hold : ∀ p ∈ props, ∀ x, inBox B x = true → breaks rules d p x = false :=\n  fun p hp x hx => regionCheck_sound B rules props d checked p hp x hx\n"),
        "all_hold no longer states that no request in the bounds breaks a guarantee, from regionCheck_sound"
    );
    for forbidden in ["sorry", "native_decide", "\naxiom "] {
        assert!(
            !verdant.contains(forbidden),
            "VerdantRegions.lean uses {forbidden:?}"
        );
    }
    let workflow = read(".github/workflows/studio.yml");
    assert!(
        workflow.contains("node tools/live_proof.mjs --check"),
        "the studio workflow no longer refuses a VerdantRegions.lean that drifted from the fixture"
    );
    built_and_axioms_checked("VerdantR.all_hold");
}
