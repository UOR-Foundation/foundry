#!/usr/bin/env bash
# Times Lean's kernel on shapes of the region checker, on Verdant, before any of them is proved sound: which shape
# is worth proving. Each variant is one file whose only theorem is `<checker> ... = true := by decide +kernel`.
#   bash live/variants.sh        (WSL, after live/build.sh)
set -uo pipefail
work=${TLK:-$HOME/tlk}/live
export PATH=$HOME/.elan/toolchains/leanprover--lean4---v4.32.1/bin:$PATH
cd "$work/proof"
export LEAN_PATH=$work/proof/.lake/build/lib/lean:$(lean --print-prefix)/lib/lean
mkdir -p "$work/variants"

cat > "$work/variants/Defs.lean" <<'EOF'
import PrismLive.VerdantRegions
open PrismLive.Kernel

namespace Fast

/-- V1: every rule's box is computed once and passed along, not recomputed at each later rule. -/
def oblRulesB (pB : Box) (p : Property) : List Box → List Rule → List Box → Bool
  | _, [], _ => true
  | pre, r :: rs, rb :: rbs =>
    (if bad p r.outcome then (subAll (meet rb pB) pre).isEmpty else true) && oblRulesB pB p (pre ++ [rb]) rs rbs
  | _, _ :: _, [] => false

def checkB (B : Box) (rules : List Rule) (props : List Property) (d : Nat) (bs : List Box) : Bool :=
  rules.all (fun r => condsOk B.length true r.when) &&
  props.all (fun p => condsOk B.length false p.when && oblRulesB (boxOf B p.when) p [] rules bs &&
    (if bad p d then (subAll (meet B (boxOf B p.when)) bs).isEmpty else true))

def regionCheck1 (B : Box) (rules : List Rule) (props : List Property) (d : Nat) : Bool :=
  checkB B rules props d (rules.map (fun q => boxOf B q.when))

/-- V2: the rule boxes are given as data, already evaluated, and only compared with what `boxOf` computes. -/
def regionCheck2 (B : Box) (rules : List Rule) (props : List Property) (d : Nat) (bs : List Box) : Bool :=
  (rules.map (fun q => boxOf B q.when) == bs) && checkB B rules props d bs

/-- V3: V2 with the guarantees' boxes given as data too. -/
def checkP (B : Box) (rules : List Rule) (d : Nat) (bs : List Box) : List Property → List Box → Bool
  | [], [] => true
  | p :: ps, pB :: pBs =>
    (boxOf B p.when == pB) && condsOk B.length false p.when && oblRulesB pB p [] rules bs &&
    (if bad p d then (subAll (meet B pB) bs).isEmpty else true) && checkP B rules d bs ps pBs
  | _, _ => false

def regionCheck3 (B : Box) (rules : List Rule) (props : List Property) (d : Nat) (bs pbs : List Box) : Bool :=
  rules.all (fun r => condsOk B.length true r.when) && (rules.map (fun q => boxOf B q.when) == bs) && checkP B rules d bs props pbs

/-- V4: one pass. `R` is what of the guarantee's box no earlier rule has taken; a rule whose answer would break the
guarantee must not touch it, and each rule's box is then taken out. -/
def takeOut (R : List Box) (b : Box) : List Box := R.flatMap (fun q => (sub q b).filter nonEmpty)

def passCheck (p : Property) (d : Nat) : List Box → List Rule → List Box → Bool
  | R, [], _ => if bad p d then R.isEmpty else true
  | R, r :: rs, rb :: rbs =>
    (if bad p r.outcome then R.all (fun q => !(nonEmpty (meet rb q))) else true) && passCheck p d (takeOut R rb) rs rbs
  | _, _ :: _, [] => false

def regionCheck4 (B : Box) (rules : List Rule) (props : List Property) (d : Nat) : Bool :=
  rules.all (fun r => condsOk B.length true r.when) &&
  props.all (fun p => condsOk B.length false p.when &&
    passCheck p d (if nonEmpty (boxOf B p.when) then [boxOf B p.when] else []) rules (rules.map (fun q => boxOf B q.when)))

end Fast

-- The boxes as literals, printed once by Lean itself.
#eval IO.FS.writeFile "boxes.txt" ((repr (VerdantR.rules.map (fun q => boxOf VerdantR.B q.when))).pretty (width := 10000000) ++ "\n" ++ (repr (VerdantR.props.map (fun q => boxOf VerdantR.B q.when))).pretty (width := 10000000) ++ "\n")
EOF
(cd "$work/variants" && lean Defs.lean -o "$work/proof/.lake/build/lib/lean/Defs.olean" 2>&1 | head -5)
rb=$(sed -n 1p "$work/variants/boxes.txt"); pb=$(sed -n 2p "$work/variants/boxes.txt")
head='import Defs
open PrismLive.Kernel VerdantR Fast
'
printf '%s' "$head" > "$work/variants/Empty.lean"
printf '%stheorem t : regionCheck B rules props d = true := by decide +kernel\n' "$head" > "$work/variants/V0.lean"
printf '%stheorem t : regionCheck1 B rules props d = true := by decide +kernel\n' "$head" > "$work/variants/V1.lean"
printf '%sdef bs : List Box := %s\ntheorem t : regionCheck2 B rules props d bs = true := by decide +kernel\n' "$head" "$rb" > "$work/variants/V2.lean"
printf '%sdef bs : List Box := %s\ndef pbs : List Box := %s\ntheorem t : regionCheck3 B rules props d bs pbs = true := by decide +kernel\n' "$head" "$rb" "$pb" > "$work/variants/V3.lean"
printf '%stheorem t : regionCheck4 B rules props d = true := by decide +kernel
' "$head" > "$work/variants/V4.lean"
uptime | sed 's/.*load/load/'
for v in Empty V0 V4 V0 V4 V4; do
  s=$(date +%s%N); out=$(lean "$work/variants/$v.lean" 2>&1 | head -3); echo "$v: $(( ($(date +%s%N) - s) / 1000000 )) ms ${out:0:160}"
done
