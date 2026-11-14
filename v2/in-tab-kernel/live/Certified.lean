import PrismLive.Regions

/-!
# One guarantee, proved from named obligations

`regionCheck_sound` (Regions.lean) has the kernel subtract, for every rule, the box of every earlier rule. Almost all
of that is redundant: an earlier box that does not touch a region cannot cover any of it, and a region already known
to be covered need not be covered again.

Here the caller says, for each rule, which earlier rules to subtract (`sel`), and may point at a fact already proved
(`memo`): a region and boxes whose subtraction is known to be empty. What the caller says is not trusted. A rule
named in `sel` that is not earlier is dropped, which can only make the check harder to pass; a `memo` is used only if
the fact it points at is exactly the region and boxes of this obligation, and every fact is a hypothesis of the
theorem, to be discharged by a proof of its own.

`certCheck_sound`: if the check passes and every fact holds, the guarantee holds on every request in the bounds.
-/

namespace PrismLive.Kernel

/-- The rules at the given positions, keeping only positions before `n`. -/
def pick (rules : List Rule) (n : Nat) : List Nat → List Rule
  | [] => []
  | i :: is =>
    if i < n then (match rules[i]? with
      | some q => q :: pick rules n is
      | none => pick rules n is)
    else pick rules n is

theorem mem_pick (rules : List Rule) (n : Nat) :
    ∀ (is : List Nat) (q : Rule), q ∈ pick rules n is → ∃ i, i < n ∧ rules[i]? = some q
  | [], q, h => by simp [pick] at h
  | i :: is, q, h => by
    simp only [pick] at h
    split at h
    · rename_i hi
      split at h
      · rename_i q' hq'
        cases List.mem_cons.mp h with
        | inl e => subst e; exact ⟨i, hi, hq'⟩
        | inr h' => exact mem_pick rules n is q h'
      · exact mem_pick rules n is q h
    · exact mem_pick rules n is q h

/-- A region and boxes: the fact is that the boxes cover the region. -/
abbrev Fact := Box × List Box

/-- Every fact holds. -/
def AllKnown (known : List Fact) : Prop := ∀ e ∈ known, subAll e.1 e.2 = []

theorem allKnown_nil : AllKnown [] := fun _ h => absurd h List.not_mem_nil

theorem allKnown_cons (e : Fact) (es : List Fact) (h : subAll e.1 e.2 = []) (hs : AllKnown es) :
    AllKnown (e :: es) := fun e' h' => by
  cases List.mem_cons.mp h' with
  | inl q => subst q; exact h
  | inr q => exact hs e' q

/-- The region is covered: by the fact pointed at, if it is this very region and these very boxes, or else by
subtracting. -/
def covered (known : List Fact) (M : Box) (Bs : List Box) : Option Nat → Bool
  | some k => (match known[k]? with
    | some e => e == (M, Bs)
    | none => false)
  | none => (subAll M Bs).isEmpty

theorem covered_sound (known : List Fact) (hk : AllKnown known) (M : Box) (Bs : List Box) :
    ∀ m : Option Nat, covered known M Bs m = true → subAll M Bs = []
  | none, h => by simpa [covered, List.isEmpty_iff] using h
  | some k, h => by
    simp only [covered] at h
    split at h
    · rename_i e he
      have heq : e = (M, Bs) := by simpa using h
      have := hk e (List.mem_of_getElem? he)
      rw [heq] at this; exact this
    · simp at h

/-- What the caller says of one obligation: which earlier rules to subtract, and perhaps a fact to use instead. -/
abbrev Cert := List Nat × Option Nat

def oblC (B : Box) (rules : List Rule) (known : List Fact) (p : Property) (n : Nat) (r : Rule) (c : Cert) : Bool :=
  if bad p r.outcome then
    covered known (meet (boxOf B r.when) (boxOf B p.when)) ((pick rules n c.1).map (fun q => boxOf B q.when)) c.2
  else true

def oblsC (B : Box) (rules : List Rule) (known : List Fact) (p : Property) : Nat → List Rule → List Cert → Bool
  | _, [], _ => true
  | n, r :: rs, c :: cs => oblC B rules known p n r c && oblsC B rules known p (n + 1) rs cs
  | _, _ :: _, [] => false

def otherC (B : Box) (rules : List Rule) (known : List Fact) (d : Nat) (p : Property) (c : Cert) : Bool :=
  if bad p d then
    covered known (meet B (boxOf B p.when)) ((pick rules rules.length c.1).map (fun q => boxOf B q.when)) c.2
  else true

/-- One guarantee: the rules and the guarantee are well formed, and every obligation is covered as the caller says. -/
def certCheck (B : Box) (rules : List Rule) (known : List Fact) (d : Nat) (p : Property)
    (cs : List Cert) (co : Cert) : Bool :=
  rules.all (fun r => condsOk B.length true r.when) && condsOk B.length false p.when &&
  oblsC B rules known p 0 rules cs && otherC B rules known d p co

theorem oblsC_at (B : Box) (rules : List Rule) (known : List Fact) (p : Property) :
    ∀ (n : Nat) (pre : List Rule) (r : Rule) (suf : List Rule) (cs : List Cert),
    oblsC B rules known p n (pre ++ r :: suf) cs = true → ∃ c, oblC B rules known p (n + pre.length) r c = true
  | n, [], r, suf, [], h => by simp [oblsC] at h
  | n, [], r, suf, c :: cs, h => by
    simp only [List.nil_append, oblsC, Bool.and_eq_true] at h
    exact ⟨c, by simpa using h.1⟩
  | n, q :: pre, r, suf, [], h => by simp [oblsC] at h
  | n, q :: pre, r, suf, c :: cs, h => by
    simp only [List.cons_append, oblsC, Bool.and_eq_true] at h
    obtain ⟨c', hc'⟩ := oblsC_at B rules known p (n + 1) pre r suf cs h.2
    refine ⟨c', ?_⟩
    have : n + (q :: pre).length = n + 1 + pre.length := by simp; omega
    rw [this]; exact hc'

/-- If the check passes and every fact holds, the guarantee holds on every request in the bounds. -/
theorem certCheck_sound (B : Box) (rules : List Rule) (known : List Fact) (d : Nat) (p : Property)
    (cs : List Cert) (co : Cert) (hk : AllKnown known) (hc : certCheck B rules known d p cs co = true)
    (x : List Nat) (hx : inBox B x = true) : breaks rules d p x = false := by
  simp only [certCheck, Bool.and_eq_true, List.all_eq_true] at hc
  obtain ⟨⟨⟨hrules, hpok⟩, hobl⟩, hother⟩ := hc
  simp only [breaks, breaksWith_eq]
  cases hw : allHold p.when x
  · rfl
  · have hW := boxOf_hull B p.when x hpok hx hw
    rcases judge_cases d x rules with ⟨hn, hj⟩ | ⟨pre, r, suf, he, hpre, hm, hj⟩
    · rw [hj]
      cases hb : bad p d
      · rfl
      · simp only [otherC, hb, if_true] at hother
        obtain ⟨Q, hQ, hin⟩ := covered_of_subAll _ _ (covered_sound known hk _ _ _ hother) x (inBox_meet _ _ x hx hW)
        obtain ⟨q, hq, rfl⟩ := List.mem_map.mp hQ
        obtain ⟨i, _, hi⟩ := mem_pick rules _ _ q hq
        have hqr : q ∈ rules := List.mem_of_getElem? hi
        have := (boxOf_exact B q.when x (hrules q hqr) hin).2
        rw [hn q hqr] at this; exact absurd this (by simp)
    · rw [hj]
      cases hb : bad p r.outcome
      · rfl
      · subst he
        obtain ⟨c, hr⟩ := oblsC_at B (pre ++ r :: suf) known p 0 pre r suf cs hobl
        simp only [Nat.zero_add, oblC, hb, if_true] at hr
        have hR := boxOf_hull B r.when x (condsOk_weaken _ _ (hrules r (by simp))) hx hm
        obtain ⟨Q, hQ, hin⟩ := covered_of_subAll _ _ (covered_sound known hk _ _ _ hr) x (inBox_meet _ _ x hR hW)
        obtain ⟨q, hq, rfl⟩ := List.mem_map.mp hQ
        obtain ⟨i, hi, hget⟩ := mem_pick _ _ _ q hq
        have hqpre : q ∈ pre := by
          rw [List.getElem?_append_left hi] at hget
          exact List.mem_of_getElem? hget
        have := (boxOf_exact B q.when x (hrules q (by simp [hqpre])) hin).2
        rw [hpre q hqpre] at this; exact absurd this (by simp)

end PrismLive.Kernel
