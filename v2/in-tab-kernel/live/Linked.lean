import PrismLive.Regions

/-!
# One guarantee, assembled from facts

`certCheck_sound` (Certified.lean) still has the kernel evaluate a checker for every guarantee: the box of every
rule, the bounds check of every rule, which rules a proof names. Each is small, and the kernel takes milliseconds
over each, so a guarantee costs the same after an edit as before it.

Here nothing is evaluated when a guarantee is assembled. Every evaluation is a fact of its own, a small statement
about plain data that mentions neither the app nor the guarantee:

* `RuleBox B c Q`   the conditions `c` are well formed over `B`, and their box is `Q`
* `PropBox B pw W`  the same for a guarantee's conditions, which may use `!=`
* `NotBad a po o`   the outcome `o` does not break a guarantee of this kind and outcome
* `Apart Q W`       the two boxes share no request
* `Meets Q W M`     the two boxes meet in `M`
* `CoveredBy M Bs`  the boxes `Bs` cover `M`

A fact is proved once, by the kernel doing the evaluation, and is then named. `linked_sound` puts a guarantee
together from named facts by applying the lemmas below, rule by rule from the last to the first. An edit to one rule
changes the facts that mention that rule's box, and no others.
-/

namespace PrismLive.Kernel

def RuleBox (B : Box) (c : List Cond) (Q : Box) : Prop := condsOk B.length true c = true ∧ boxOf B c = Q
def PropBox (B : Box) (pw : List Cond) (W : Box) : Prop := condsOk B.length false pw = true ∧ boxOf B pw = W
def NotBad (a : Bool) (po o : Nat) : Prop := bad ⟨a, [], po⟩ o = false
def Apart (Q W : Box) : Prop := nonEmpty (meet Q W) = false
def Meets (Q W M : Box) : Prop := meet Q W = M
def CoveredBy (M : Box) (Bs : List Box) : Prop := subAll M Bs = []

theorem ruleBox_intro (B : Box) (c : List Cond) (Q : Box) (h1 : condsOk B.length true c = true)
    (h2 : boxOf B c = Q) : RuleBox B c Q := ⟨h1, h2⟩
theorem propBox_intro (B : Box) (pw : List Cond) (W : Box) (h1 : condsOk B.length false pw = true)
    (h2 : boxOf B pw = W) : PropBox B pw W := ⟨h1, h2⟩
theorem notBad_intro (a : Bool) (po o : Nat) (h : bad ⟨a, [], po⟩ o = false) : NotBad a po o := h
theorem apart_intro (Q W : Box) (h : nonEmpty (meet Q W) = false) : Apart Q W := h
theorem meets_intro (Q W M : Box) (h : meet Q W = M) : Meets Q W M := h
theorem coveredBy_intro (M : Box) (Bs : List Box) (h : subAll M Bs = []) : CoveredBy M Bs := h

/-- Every box of `Bs` is one of `pre`. -/
def AllIn (Bs pre : List Box) : Prop := ∀ Q ∈ Bs, Q ∈ pre

theorem inHere (Q : Box) (pre : List Box) : Q ∈ Q :: pre := List.Mem.head _
theorem inThere (Q R : Box) (pre : List Box) (h : Q ∈ pre) : Q ∈ R :: pre := List.Mem.tail _ h
theorem allIn_nil (pre : List Box) : AllIn [] pre := fun _ h => absurd h List.not_mem_nil
theorem allIn_cons (Q : Box) (Bs pre : List Box) (h : Q ∈ pre) (hs : AllIn Bs pre) : AllIn (Q :: Bs) pre :=
  fun Q' h' => by
    cases List.mem_cons.mp h' with
    | inl e => rw [e]; exact h
    | inr e => exact hs Q' e

/-- No request the guarantee speaks about, in `Q` and in no box of `pre`, may be answered `o`. -/
def Never (B : Box) (a : Bool) (pw : List Cond) (po : Nat) (pre : List Box) (Q : Box) (o : Nat) : Prop :=
  ∀ x, inBox B x = true → allHold pw x = true → (∀ Q' ∈ pre, inBox Q' x = false) → inBox Q x = true →
    bad ⟨a, pw, po⟩ o = false

theorem never_ok (B : Box) (a : Bool) (pw : List Cond) (po : Nat) (pre : List Box) (Q : Box) (o : Nat)
    (h : NotBad a po o) : Never B a pw po pre Q o := fun _ _ _ _ _ => h

theorem never_apart (B : Box) (a : Bool) (pw : List Cond) (po : Nat) (pre : List Box) (Q : Box) (o : Nat)
    (W : Box) (hp : PropBox B pw W) (h : Apart Q W) : Never B a pw po pre Q o := fun x hx hw _ hQ => by
  have ⟨hp1, hp2⟩ : condsOk B.length false pw = true ∧ boxOf B pw = W := hp
  have hWx : inBox W x = true := by
    have := boxOf_hull B pw x hp1 hx hw
    rw [hp2] at this; exact this
  have := nonEmpty_of_inBox _ x (inBox_meet Q W x hQ hWx)
  rw [show nonEmpty (meet Q W) = false from h] at this
  exact absurd this (by simp)

theorem never_cover (B : Box) (a : Bool) (pw : List Cond) (po : Nat) (pre : List Box) (Q : Box) (o : Nat)
    (W M : Box) (Bs : List Box) (hp : PropBox B pw W) (hM : Meets Q W M) (hf : CoveredBy M Bs)
    (hin : AllIn Bs pre) : Never B a pw po pre Q o := fun x hx hw hpre hQ => by
  have ⟨hp1, hp2⟩ : condsOk B.length false pw = true ∧ boxOf B pw = W := hp
  have hWx : inBox W x = true := by
    have := boxOf_hull B pw x hp1 hx hw
    rw [hp2] at this; exact this
  have hMx : inBox M x = true := by
    have := inBox_meet Q W x hQ hWx
    rw [show meet Q W = M from hM] at this; exact this
  obtain ⟨Q', hQ', hQx⟩ := covered_of_subAll M Bs hf x hMx
  rw [hpre Q' (hin Q' hQ')] at hQx
  exact absurd hQx (by simp)

/-- From the requests in no box of `pre`, the rules `rs` and then `d` never answer against the guarantee. -/
def Safe (B : Box) (a : Bool) (pw : List Cond) (po : Nat) (d : Nat) (pre : List Box) (rs : List Rule) : Prop :=
  ∀ x, inBox B x = true → allHold pw x = true → (∀ Q ∈ pre, inBox Q x = false) →
    bad ⟨a, pw, po⟩ (judge rs d x) = false

theorem safe_nil (B : Box) (a : Bool) (pw : List Cond) (po : Nat) (d : Nat) (pre : List Box)
    (hn : Never B a pw po pre B d) : Safe B a pw po d pre [] := fun x hx hw hpre => hn x hx hw hpre hx

theorem safe_cons (B : Box) (a : Bool) (pw : List Cond) (po : Nat) (d : Nat) (pre : List Box)
    (c : List Cond) (o : Nat) (rs : List Rule) (Q : Box) (hr : RuleBox B c Q)
    (hn : Never B a pw po pre Q o) (hs : Safe B a pw po d (Q :: pre) rs) :
    Safe B a pw po d pre (⟨c, o⟩ :: rs) := fun x hx hw hpre => by
  have ⟨hc, hQ⟩ : condsOk B.length true c = true ∧ boxOf B c = Q := hr
  cases hm : allHold c x
  · have hj : judge (⟨c, o⟩ :: rs) d x = judge rs d x := by simp [judge, hm]
    rw [hj]
    refine hs x hx hw (fun Q' hQ' => ?_)
    cases List.mem_cons.mp hQ' with
    | inl e =>
      cases hq : inBox Q' x
      · rfl
      · rw [e, ← hQ] at hq
        have := (boxOf_exact B c x hc hq).2
        rw [hm] at this; exact absurd this (by simp)
    | inr e => exact hpre Q' e
  · have hj : judge (⟨c, o⟩ :: rs) d x = o := by simp [judge, hm]
    rw [hj]
    have hin : inBox Q x = true := by
      have := boxOf_hull B c x (condsOk_weaken _ _ hc) hx hm
      rw [hQ] at this; exact this
    exact hn x hx hw hpre hin

/-- A guarantee assembled over all the rules holds on every request in the bounds. -/
theorem linked_sound (B : Box) (a : Bool) (pw : List Cond) (po : Nat) (d : Nat) (rules : List Rule)
    (h : Safe B a pw po d [] rules) (x : List Nat) (hx : inBox B x = true) :
    breaks rules d ⟨a, pw, po⟩ x = false := by
  rw [breaks, breaksWith_eq]
  show (allHold pw x && bad ⟨a, pw, po⟩ (judge rules d x)) = false
  cases hw : allHold pw x
  · rfl
  · simpa using h x hx hw (fun _ h' => absurd h' List.not_mem_nil)

end PrismLive.Kernel
