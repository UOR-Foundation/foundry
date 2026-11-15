import PrismLive.Kernel

/-!
# Local, kernel-checkable obligations

For every property `p` and every rule `r` whose answer would break `p`, one obligation: the part
of `r`'s box inside `p`'s box is covered by the boxes of the rules before `r`. Then no request
that `p` speaks about is first matched by `r`. One more obligation covers `otherwise`. Each is
box subtraction over a few intervals, so the Lean kernel decides it quickly, and each depends only
on `p`, `r` and the rules before `r`, which is what makes it a reusable, addressable block.

`regionCheck_sound` proves, once for every model, that passing every obligation means every
property holds on every request in the bounds. Rules must use only `<`, `<=`, `>`, `>=` and `=`
(their box is exactly where they match); properties may also use `!=`, whose box over-covers.
-/

namespace PrismLive.Kernel

/-- A box: one closed interval per field. -/
abbrev Box := List (Nat × Nat)

def inBox : Box → List Nat → Bool
  | [], [] => true
  | (l, h) :: bs, v :: vs => if l ≤ v then (if v ≤ h then inBox bs vs else false) else false
  | _, _ => false

def nonEmpty : Box → Bool
  | [] => true
  | (l, h) :: bs => if l ≤ h then nonEmpty bs else false

@[simp] theorem inBox_cons (l h : Nat) (bs : Box) (v : Nat) (vs : List Nat) :
    inBox ((l, h) :: bs) (v :: vs) = (Decidable.decide (l ≤ v) && Decidable.decide (v ≤ h) && inBox bs vs) := by
  simp only [inBox]; by_cases a : l ≤ v <;> by_cases b : v ≤ h <;> simp [a, b]

theorem nonEmpty_of_inBox : ∀ (b : Box) (x : List Nat), inBox b x = true → nonEmpty b = true
  | [], [], _ => rfl
  | (l, h) :: bs, v :: vs, hx => by
    simp only [inBox] at hx
    split at hx
    · split at hx
      · simp only [nonEmpty]; rw [if_pos (by omega)]; exact nonEmpty_of_inBox bs vs hx
      · simp at hx
    · simp at hx
  | [], _ :: _, hx => by simp [inBox] at hx
  | _ :: _, [], hx => by simp [inBox] at hx

theorem inBox_length : ∀ (b : Box) (x : List Nat), inBox b x = true → x.length = b.length
  | [], [], _ => rfl
  | (l, h) :: bs, v :: vs, hx => by
    simp only [inBox] at hx
    split at hx
    · split at hx
      · simp [inBox_length bs vs hx]
      · simp at hx
    · simp at hx
  | [], _ :: _, hx => by simp [inBox] at hx
  | _ :: _, [], hx => by simp [inBox] at hx

/-! ## Subtraction -/

/-- Boxes that together cover every point of `A` outside `B`. -/
def sub : Box → Box → List Box
  | [], [] => []
  | [], _ :: _ => [[]]
  | a :: as, [] => [a :: as]
  | (al, ah) :: as, (bl, bh) :: bs =>
    if ah < bl then [(al, ah) :: as] else if bh < al then [(al, ah) :: as]
    else (if al < bl then [(al, bl - 1) :: as] else []) ++
         (if bh < ah then [(bh + 1, ah) :: as] else []) ++
         (sub as bs).map (fun p => (max al bl, min ah bh) :: p)

theorem sub_cover : ∀ (A B : Box) (x : List Nat), inBox A x = true → inBox B x = false →
    ∃ p ∈ sub A B, inBox p x = true
  | [], [], [], _, hb => by simp [inBox] at hb
  | [], _ :: _, [], _, _ => ⟨[], by simp [sub], rfl⟩
  | a :: as, [], x, ha, _ => ⟨a :: as, by simp [sub], ha⟩
  | (al, ah) :: as, (bl, bh) :: bs, v :: vs, ha, hb => by
    have hA := ha
    simp only [inBox_cons, Bool.and_eq_true, decide_eq_true_eq] at hA
    obtain ⟨⟨h1, h2⟩, ha'⟩ := hA
    simp only [sub]
    by_cases c1 : ah < bl
    · rw [if_pos c1]; exact ⟨_, List.mem_singleton_self _, ha⟩
    · rw [if_neg c1]
      by_cases c2 : bh < al
      · rw [if_pos c2]; exact ⟨_, List.mem_singleton_self _, ha⟩
      · rw [if_neg c2]
        by_cases lv : v < bl
        · refine ⟨(al, bl - 1) :: as, ?_, ?_⟩
          · rw [if_pos (show al < bl by omega)]; simp
          · simp only [inBox_cons, Bool.and_eq_true, decide_eq_true_eq]; exact ⟨⟨h1, by omega⟩, ha'⟩
        · by_cases rv : bh < v
          · refine ⟨(bh + 1, ah) :: as, ?_, ?_⟩
            · rw [if_pos (show bh < ah by omega)]; simp
            · simp only [inBox_cons, Bool.and_eq_true, decide_eq_true_eq]; exact ⟨⟨by omega, h2⟩, ha'⟩
          · have hbs : inBox bs vs = false := by
              cases h : inBox bs vs
              · rfl
              · simp only [inBox_cons, h, Bool.and_true, Bool.and_eq_false_iff, decide_eq_false_iff_not] at hb
                omega
            obtain ⟨p, hp, hin⟩ := sub_cover as bs vs ha' hbs
            refine ⟨(max al bl, min ah bh) :: p, ?_, ?_⟩
            · simp only [List.mem_append, List.mem_map]; exact Or.inr ⟨p, hp, rfl⟩
            · simp only [inBox_cons, Bool.and_eq_true, decide_eq_true_eq]
              exact ⟨⟨Nat.max_le.mpr ⟨h1, by omega⟩, Nat.le_min.mpr ⟨h2, by omega⟩⟩, hin⟩
  | [], [], _ :: _, ha, _ => by simp [inBox] at ha
  | [], _ :: _, _ :: _, ha, _ => by simp [inBox] at ha
  | _ :: _, _ :: _, [], ha, _ => by simp [inBox] at ha

/-- `A` minus every box of `Bs`, as boxes, empty ones dropped. -/
def subAll (A : Box) : List Box → List Box
  | [] => if nonEmpty A then [A] else []
  | B :: Bs => (subAll A Bs).flatMap (fun p => (sub p B).filter nonEmpty)

theorem subAll_cover (A : Box) (x : List Nat) (ha : inBox A x = true) :
    ∀ Bs : List Box, (∀ B ∈ Bs, inBox B x = false) → ∃ p ∈ subAll A Bs, inBox p x = true
  | [], _ => ⟨A, by simp [subAll, nonEmpty_of_inBox A x ha], ha⟩
  | B :: Bs, h => by
    obtain ⟨p, hp, hin⟩ := subAll_cover A x ha Bs (fun B' hB' => h B' (List.mem_cons_of_mem _ hB'))
    obtain ⟨q, hq, hqin⟩ := sub_cover p B x hin (h B (List.mem_cons_self ..))
    exact ⟨q, List.mem_flatMap.mpr ⟨p, hp, List.mem_filter.mpr ⟨hq, nonEmpty_of_inBox q x hqin⟩⟩, hqin⟩

/-- Empty subtraction: every point of `A` is in some box of `Bs`. -/
theorem covered_of_subAll (A : Box) (Bs : List Box) (h : subAll A Bs = []) (x : List Nat)
    (ha : inBox A x = true) : ∃ B ∈ Bs, inBox B x = true := by
  by_cases hc : ∃ B ∈ Bs, inBox B x = true
  · exact hc
  · have : ∀ B ∈ Bs, inBox B x = false := fun B hB => by
      cases hx : inBox B x
      · rfl
      · exact absurd ⟨B, hB, hx⟩ hc
    obtain ⟨p, hp, _⟩ := subAll_cover A x ha Bs this
    rw [h] at hp; exact absurd hp List.not_mem_nil

def meet : Box → Box → Box
  | (al, ah) :: as, (bl, bh) :: bs => (max al bl, min ah bh) :: meet as bs
  | _, _ => []

theorem inBox_meet : ∀ (A B : Box) (x : List Nat), inBox A x = true → inBox B x = true →
    inBox (meet A B) x = true
  | (al, ah) :: as, (bl, bh) :: bs, v :: vs, ha, hb => by
    simp only [inBox_cons, Bool.and_eq_true, decide_eq_true_eq] at ha hb
    simp only [meet, inBox_cons, Bool.and_eq_true, decide_eq_true_eq]
    exact ⟨⟨Nat.max_le.mpr ⟨ha.1.1, hb.1.1⟩, Nat.le_min.mpr ⟨ha.1.2, hb.1.2⟩⟩, inBox_meet as bs vs ha.2 hb.2⟩
  | _ :: _, _ :: _, [], ha, _ => by simp [inBox] at ha
  | [], _, x, ha, _ => by cases x <;> simp_all [inBox, meet]
  | _ :: _, [], x, _, hb => by cases x <;> simp_all [inBox, meet]

/-! ## The box of a list of conditions -/

def setLo : Box → Nat → Nat → Box
  | [], _, _ => []
  | (l, h) :: bs, 0, lo => (max l lo, h) :: bs
  | b :: bs, f + 1, lo => b :: setLo bs f lo

def setHi : Box → Nat → Nat → Box
  | [], _, _ => []
  | (l, h) :: bs, 0, hi => (l, min h hi) :: bs
  | b :: bs, f + 1, hi => b :: setHi bs f hi

theorem inBox_setLo : ∀ (B : Box) (f lo : Nat) (x : List Nat), f < B.length →
    (inBox (setLo B f lo) x = true ↔ inBox B x = true ∧ lo ≤ get x f)
  | [], _, _, _, hf => absurd hf (Nat.not_lt_zero _)
  | (l, h) :: bs, 0, lo, v :: vs, _ => by
    simp only [setLo, inBox, get]
    constructor
    · intro hx; split at hx
      · split at hx
        · exact ⟨by rw [if_pos (by omega), if_pos (by omega)]; exact hx, by omega⟩
        · simp at hx
      · simp at hx
    · intro ⟨hx, hlo⟩; split at hx
      · split at hx
        · rw [if_pos (by omega), if_pos (by omega)]; exact hx
        · simp at hx
      · simp at hx
  | (l, h) :: bs, f + 1, lo, v :: vs, hf => by
    simp only [setLo, inBox, get]
    have ih := inBox_setLo bs f lo vs (by simp at hf; omega)
    constructor
    · intro hx; split at hx
      · split at hx
        · rename_i a b; exact ⟨by rw [if_pos a, if_pos b]; exact (ih.mp hx).1, (ih.mp hx).2⟩
        · simp at hx
      · simp at hx
    · intro ⟨hx, hlo⟩; split at hx
      · split at hx
        · rename_i a b; rw [if_pos a, if_pos b]; exact ih.mpr ⟨hx, hlo⟩
        · simp at hx
      · simp at hx
  | (l, h) :: bs, f, lo, [], _ => by cases f <;> simp [setLo, inBox]

theorem inBox_setHi : ∀ (B : Box) (f hi : Nat) (x : List Nat), f < B.length →
    (inBox (setHi B f hi) x = true ↔ inBox B x = true ∧ get x f ≤ hi)
  | [], _, _, _, hf => absurd hf (Nat.not_lt_zero _)
  | (l, h) :: bs, 0, hi, v :: vs, _ => by
    simp only [setHi, inBox, get]
    constructor
    · intro hx; split at hx
      · split at hx
        · exact ⟨by rw [if_pos (by omega), if_pos (by omega)]; exact hx, by omega⟩
        · simp at hx
      · simp at hx
    · intro ⟨hx, hhi⟩; split at hx
      · split at hx
        · rw [if_pos (by omega), if_pos (by omega)]; exact hx
        · simp at hx
      · simp at hx
  | (l, h) :: bs, f + 1, hi, v :: vs, hf => by
    simp only [setHi, inBox, get]
    have ih := inBox_setHi bs f hi vs (by simp at hf; omega)
    constructor
    · intro hx; split at hx
      · split at hx
        · rename_i a b; exact ⟨by rw [if_pos a, if_pos b]; exact (ih.mp hx).1, (ih.mp hx).2⟩
        · simp at hx
      · simp at hx
    · intro ⟨hx, hhi⟩; split at hx
      · split at hx
        · rename_i a b; rw [if_pos a, if_pos b]; exact ih.mpr ⟨hx, hhi⟩
        · simp at hx
      · simp at hx
  | (l, h) :: bs, f, hi, [], _ => by cases f <;> simp [setHi, inBox]

theorem setLo_length : ∀ (B : Box) (f lo : Nat), (setLo B f lo).length = B.length
  | [], _, _ => rfl
  | (l, h) :: bs, 0, lo => rfl
  | b :: bs, f + 1, lo => by simp [setLo, setLo_length bs f lo]

theorem setHi_length : ∀ (B : Box) (f hi : Nat), (setHi B f hi).length = B.length
  | [], _, _ => rfl
  | (l, h) :: bs, 0, hi => rfl
  | b :: bs, f + 1, hi => by simp [setHi, setHi_length bs f hi]

/-- Narrow a box by one condition. `!=` (op 5 and above) does not narrow. -/
def condBox (B : Box) (c : Cond) : Box :=
  if c.op = 0 then (if c.value = 0 then setHi (setLo B c.field 1) c.field 0 else setHi B c.field (c.value - 1))
  else if c.op = 1 then setHi B c.field c.value
  else if c.op = 2 then setLo B c.field (c.value + 1)
  else if c.op = 3 then setLo B c.field c.value
  else if c.op = 4 then setHi (setLo B c.field c.value) c.field c.value
  else B

theorem condBox_length (B : Box) (c : Cond) : (condBox B c).length = B.length := by
  unfold condBox; repeat' split
  all_goals simp [setLo_length, setHi_length]

/-- A point in the box that meets the condition stays in the narrowed box. -/
theorem condBox_hull (B : Box) (c : Cond) (x : List Nat) (hf : c.field < B.length)
    (hx : inBox B x = true) (hc : condHolds c x = true) : inBox (condBox B c) x = true := by
  simp only [condHolds, opHolds] at hc
  unfold condBox
  have hl := hf; have hl2 : c.field < (setLo B c.field 1).length := by rw [setLo_length]; exact hf
  have hl3 : c.field < (setLo B c.field c.value).length := by rw [setLo_length]; exact hf
  by_cases h0 : c.op = 0
  · simp only [h0, if_true] at hc ⊢
    split at hc
    · rename_i hv
      by_cases hz : c.value = 0
      · omega
      · rw [if_neg hz]; exact (inBox_setHi B _ _ x hf).mpr ⟨hx, by omega⟩
    · simp at hc
  · simp only [h0, if_false] at hc ⊢
    by_cases h1 : c.op = 1
    · simp only [h1, if_true] at hc ⊢
      split at hc
      · exact (inBox_setHi B _ _ x hf).mpr ⟨hx, by omega⟩
      · simp at hc
    · simp only [h1, if_false] at hc ⊢
      by_cases h2 : c.op = 2
      · simp only [h2, if_true] at hc ⊢
        split at hc
        · exact (inBox_setLo B _ _ x hf).mpr ⟨hx, by omega⟩
        · simp at hc
      · simp only [h2, if_false] at hc ⊢
        by_cases h3 : c.op = 3
        · simp only [h3, if_true] at hc ⊢
          split at hc
          · exact (inBox_setLo B _ _ x hf).mpr ⟨hx, by omega⟩
          · simp at hc
        · simp only [h3, if_false] at hc ⊢
          by_cases h4 : c.op = 4
          · simp only [h4, if_true] at hc ⊢
            split at hc
            · exact (inBox_setHi _ _ _ x hl3).mpr ⟨(inBox_setLo B _ _ x hf).mpr ⟨hx, by omega⟩, by omega⟩
            · simp at hc
          · simp only [h4, if_false]; exact hx

/-- For `<`, `<=`, `>`, `>=` and `=`, a point in the narrowed box meets the condition. -/
theorem condBox_exact (B : Box) (c : Cond) (x : List Nat) (hf : c.field < B.length) (hop : c.op < 5)
    (hx : inBox (condBox B c) x = true) : inBox B x = true ∧ condHolds c x = true := by
  simp only [condHolds, opHolds]
  unfold condBox at hx
  have hl2 : c.field < (setLo B c.field 1).length := by rw [setLo_length]; exact hf
  have hl3 : c.field < (setLo B c.field c.value).length := by rw [setLo_length]; exact hf
  by_cases h0 : c.op = 0
  · simp only [h0, if_true] at hx ⊢
    by_cases hz : c.value = 0
    · rw [if_pos hz] at hx
      have := (inBox_setHi _ _ _ x hl2).mp hx
      have := (inBox_setLo B _ _ x hf).mp this.1
      omega
    · rw [if_neg hz] at hx
      have := (inBox_setHi B _ _ x hf).mp hx
      exact ⟨this.1, by rw [if_pos (by omega)]⟩
  · simp only [h0, if_false] at hx ⊢
    by_cases h1 : c.op = 1
    · simp only [h1, if_true] at hx ⊢
      have := (inBox_setHi B _ _ x hf).mp hx
      exact ⟨this.1, by rw [if_pos this.2]⟩
    · simp only [h1, if_false] at hx ⊢
      by_cases h2 : c.op = 2
      · simp only [h2, if_true] at hx ⊢
        have := (inBox_setLo B _ _ x hf).mp hx
        exact ⟨this.1, by rw [if_pos (by omega)]⟩
      · simp only [h2, if_false] at hx ⊢
        by_cases h3 : c.op = 3
        · simp only [h3, if_true] at hx ⊢
          have := (inBox_setLo B _ _ x hf).mp hx
          exact ⟨this.1, by rw [if_pos this.2]⟩
        · simp only [h3, if_false] at hx ⊢
          have h4 : c.op = 4 := by omega
          simp only [h4, if_true] at hx ⊢
          have a := (inBox_setHi _ _ _ x hl3).mp hx
          have b := (inBox_setLo B _ _ x hf).mp a.1
          exact ⟨b.1, by rw [if_pos (by omega)]⟩

def boxOf (B : Box) : List Cond → Box
  | [] => B
  | c :: cs => boxOf (condBox B c) cs

def condsOk (n : Nat) (strict : Bool) : List Cond → Bool
  | [] => true
  | c :: cs => if c.field < n then (if strict then (if c.op < 5 then condsOk n strict cs else false) else condsOk n strict cs) else false

theorem condsOk_weaken (n : Nat) : ∀ cs : List Cond, condsOk n true cs = true → condsOk n false cs = true
  | [], _ => rfl
  | c :: cs, h => by
    by_cases hf : c.field < n
    · by_cases ho : c.op < 5
      · simp [condsOk, hf, ho] at h ⊢; exact condsOk_weaken n cs h
      · simp [condsOk, hf, ho] at h
    · simp [condsOk, hf] at h

theorem boxOf_length : ∀ (B : Box) (cs : List Cond), (boxOf B cs).length = B.length
  | _, [] => rfl
  | B, c :: cs => by simp [boxOf, boxOf_length _ cs, condBox_length]

theorem boxOf_hull : ∀ (B : Box) (cs : List Cond) (x : List Nat), condsOk B.length false cs = true →
    inBox B x = true → allHold cs x = true → inBox (boxOf B cs) x = true
  | _, [], _, _, hx, _ => hx
  | B, c :: cs, x, hok, hx, hall => by
    simp only [condsOk] at hok
    split at hok
    · rename_i hf
      simp only [allHold] at hall
      split at hall
      · rename_i hc
        have := boxOf_hull (condBox B c) cs x (by rw [condBox_length]; exact hok) (condBox_hull B c x hf hx hc) hall
        exact this
      · simp at hall
    · simp at hok

theorem boxOf_exact : ∀ (B : Box) (cs : List Cond) (x : List Nat), condsOk B.length true cs = true →
    inBox (boxOf B cs) x = true → inBox B x = true ∧ allHold cs x = true
  | _, [], _, _, hx => ⟨hx, rfl⟩
  | B, c :: cs, x, hok, hx => by
    simp only [condsOk] at hok
    split at hok
    · rename_i hf
      rw [if_true] at hok
      split at hok
      · rename_i hop
        have ih := boxOf_exact (condBox B c) cs x (by rw [condBox_length]; exact hok) hx
        have := condBox_exact B c x hf hop ih.1
        simp only [allHold, this.2, if_true]
        exact ⟨this.1, ih.2⟩
      · simp at hok
    · simp at hok

/-! ## The obligations -/

/-- Outcome `o` would break property `p`. -/
def bad (p : Property) (o : Nat) : Bool :=
  if p.always then (if o = p.outcome then false else true) else (if o = p.outcome then true else false)

theorem breaksWith_eq (p : Property) (x : List Nat) (o : Nat) :
    breaksWith p x o = (allHold p.when x && bad p o) := by
  simp only [breaksWith, bad]; split <;> simp_all

/-- Rule `r`, after the rules `pre`, never first-matches a request that `p` speaks about with an
answer that breaks `p`. -/
def oblRule (B : Box) (pre : List Rule) (r : Rule) (p : Property) : Bool :=
  if bad p r.outcome then (subAll (meet (boxOf B r.when) (boxOf B p.when)) (pre.map (fun q => boxOf B q.when))).isEmpty
  else true

def oblRules (B : Box) (p : Property) : List Rule → List Rule → Bool
  | _, [] => true
  | pre, r :: rs => oblRule B pre r p && oblRules B p (pre ++ [r]) rs

/-- `otherwise` never answers, against `p`, a request no rule matches. -/
def oblOther (B : Box) (rules : List Rule) (d : Nat) (p : Property) : Bool :=
  if bad p d then (subAll (meet B (boxOf B p.when)) (rules.map (fun q => boxOf B q.when))).isEmpty else true

def regionCheck (B : Box) (rules : List Rule) (props : List Property) (d : Nat) : Bool :=
  rules.all (fun r => condsOk B.length true r.when) &&
  props.all (fun p => condsOk B.length false p.when && oblRules B p [] rules && oblOther B rules d p)

/-! ## Soundness -/

theorem judge_cases (d : Nat) (x : List Nat) : ∀ rules : List Rule,
    ((∀ r ∈ rules, allHold r.when x = false) ∧ judge rules d x = d) ∨
    ∃ pre r suf, rules = pre ++ r :: suf ∧ (∀ q ∈ pre, allHold q.when x = false) ∧
      allHold r.when x = true ∧ judge rules d x = r.outcome
  | [] => Or.inl ⟨fun _ h => absurd h List.not_mem_nil, rfl⟩
  | r :: rs => by
    cases hr : allHold r.when x
    · rcases judge_cases d x rs with ⟨hn, hj⟩ | ⟨pre, r', suf, he, hp, hm, hj⟩
      · left; refine ⟨fun q hq => ?_, ?_⟩
        · cases List.mem_cons.mp hq with
          | inl h => subst h; exact hr
          | inr h => exact hn q h
        · simp [judge, hr, hj]
      · right; refine ⟨r :: pre, r', suf, by simp [he], fun q hq => ?_, hm, by simp [judge, hr, hj]⟩
        cases List.mem_cons.mp hq with
        | inl h => subst h; exact hr
        | inr h => exact hp q h
    · right; exact ⟨[], r, rs, rfl, fun _ h => absurd h List.not_mem_nil, hr, by simp [judge, hr]⟩

theorem oblRules_at (B : Box) (p : Property) : ∀ (acc pre : List Rule) (r : Rule) (suf : List Rule),
    oblRules B p acc (pre ++ r :: suf) = true → oblRule B (acc ++ pre) r p = true
  | acc, [], r, suf, h => by simp only [List.nil_append, oblRules, Bool.and_eq_true] at h; simpa using h.1
  | acc, q :: pre, r, suf, h => by
    simp only [List.cons_append, oblRules, Bool.and_eq_true] at h
    have := oblRules_at B p (acc ++ [q]) pre r suf h.2
    simpa [List.append_assoc] using this

/-- Passing every obligation means every property holds on every request in the bounds. -/
theorem regionCheck_sound (B : Box) (rules : List Rule) (props : List Property) (d : Nat)
    (hc : regionCheck B rules props d = true) (p : Property) (hp : p ∈ props)
    (x : List Nat) (hx : inBox B x = true) : breaks rules d p x = false := by
  simp only [regionCheck, Bool.and_eq_true, List.all_eq_true] at hc
  obtain ⟨hrules, hprops⟩ := hc
  obtain ⟨⟨hpok, hobl⟩, hother⟩ := hprops p hp
  simp only [breaks, breaksWith_eq]
  cases hw : allHold p.when x
  · rfl
  · have hW := boxOf_hull B p.when x hpok hx hw
    rcases judge_cases d x rules with ⟨hn, hj⟩ | ⟨pre, r, suf, he, hpre, hm, hj⟩
    · rw [hj]
      cases hb : bad p d
      · rfl
      · simp only [oblOther, hb, if_true, List.isEmpty_iff] at hother
        obtain ⟨Q, hQ, hin⟩ := covered_of_subAll _ _ hother x (inBox_meet _ _ x hx hW)
        obtain ⟨q, hq, rfl⟩ := List.mem_map.mp hQ
        have := (boxOf_exact B q.when x (hrules q hq) hin).2
        rw [hn q hq] at this; exact absurd this (by simp)
    · rw [hj]
      cases hb : bad p r.outcome
      · rfl
      · have hr := oblRules_at B p [] pre r suf (he ▸ hobl)
        simp only [List.nil_append, oblRule, hb, if_true, List.isEmpty_iff] at hr
        have hR := boxOf_hull B r.when x (condsOk_weaken _ _ (hrules r (by rw [he]; simp))) hx hm
        obtain ⟨Q, hQ, hin⟩ := covered_of_subAll _ _ hr x (inBox_meet _ _ x hR hW)
        obtain ⟨q, hq, rfl⟩ := List.mem_map.mp hQ
        have hqr : q ∈ rules := by rw [he]; simp [hq]
        have := (boxOf_exact B q.when x (hrules q hqr) hin).2
        rw [hpre q hq] at this; exact absurd this (by simp)

end PrismLive.Kernel


/-! ## The rule judge a published app runs

A published rule app answers through the Forge kernel's `RuleJudge` (app/src/RuleJudge.lex.tex), compiled by
LexLean. The definitions below are the Lean LexLean writes for it, line for line (`lexlean build`), with the two
runtime functions they call stated as LexLean's runtime states them for lists of numbers. CI compares each line with
LexLean's output again. `ruleJudge_sound` then speaks about the judge the published app runs: if `wordsCheck` holds
on the app's words, no in-bounds request the guest answers breaks the guarantee. -/

namespace LexLeanRuntime
def multiply (left right : Nat) : Nat := left * right
def listIndex : List Nat → Nat → Option Nat
  | [], _ => none
  | head :: _, 0 => some head
  | _ :: tail, index + 1 => listIndex tail index
def index (value : List Nat) (offset : Nat) : Option Nat := listIndex value offset
end LexLeanRuntime

namespace PrismForgeKernel.WorkProtocol
def word (words : List (Nat)) (offset : Nat) : Nat := (match (LexLeanRuntime.index (words) (offset) : Option (Nat)) with | Option.none => 0 | Option.some value => value)
end PrismForgeKernel.WorkProtocol

namespace PrismForgeKernel.RuleJudge

def ruleOpHolds (op : Nat) (bound : Nat) (value : Nat) : Bool := (if (Nat.beq (op) (0)) then (Nat.blt (value) (bound)) else (if (Nat.beq (op) (1)) then (Nat.ble (value) (bound)) else (if (Nat.beq (op) (2)) then (Nat.blt (bound) (value)) else (if (Nat.beq (op) (3)) then (Nat.ble (bound) (value)) else (if (Nat.beq (op) (4)) then (Nat.beq (value) (bound)) else (!(Nat.beq (value) (bound))))))))

def ruleCondsHold : (words : List (Nat)) -> («at» : Nat) -> (count : Nat) -> (base : Nat) -> Bool
  | _words, _at, Nat.zero, _base => true
  | words, «at», Nat.succ less, base => (if ruleOpHolds (PrismForgeKernel.WorkProtocol.word (words) ((«at» + 1))) (PrismForgeKernel.WorkProtocol.word (words) ((«at» + 2))) (PrismForgeKernel.WorkProtocol.word (words) ((base + PrismForgeKernel.WorkProtocol.word (words) («at»)))) then ruleCondsHold (words) ((«at» + 3)) (less) (base) else false)

def ruleSpan (words : List (Nat)) («at» : Nat) : Nat := ((«at» + 2) + (LexLeanRuntime.multiply (3) (PrismForgeKernel.WorkProtocol.word (words) («at»)) : Nat))

def rulesEnd : (words : List (Nat)) -> («at» : Nat) -> (count : Nat) -> Nat
  | _words, «at», Nat.zero => «at»
  | words, «at», Nat.succ less => rulesEnd (words) (ruleSpan (words) («at»)) (less)

def ruleOutcome : (words : List (Nat)) -> («at» : Nat) -> (count : Nat) -> (otherwise : Nat) -> (base : Nat) -> Nat
  | _words, _at, Nat.zero, otherwise, _base => otherwise
  | words, «at», Nat.succ less, otherwise, base => (if ruleCondsHold (words) ((«at» + 2)) (PrismForgeKernel.WorkProtocol.word (words) («at»)) (base) then PrismForgeKernel.WorkProtocol.word (words) ((«at» + 1)) else ruleOutcome (words) (ruleSpan (words) («at»)) (less) (otherwise) (base))

def ruleInBounds : (words : List (Nat)) -> (field : Nat) -> (count : Nat) -> (base : Nat) -> Bool
  | _words, _field, Nat.zero, _base => true
  | words, field, Nat.succ less, base => (if ((Nat.ble (PrismForgeKernel.WorkProtocol.word (words) ((2 + (LexLeanRuntime.multiply (2) (field) : Nat)))) (PrismForgeKernel.WorkProtocol.word (words) ((base + field)))) && (Nat.ble (PrismForgeKernel.WorkProtocol.word (words) ((base + field))) (PrismForgeKernel.WorkProtocol.word (words) ((3 + (LexLeanRuntime.multiply (2) (field) : Nat)))))) then ruleInBounds (words) ((field + 1)) (less) (base) else false)

end PrismForgeKernel.RuleJudge

namespace PrismLive.Kernel
open PrismForgeKernel.WorkProtocol PrismForgeKernel.RuleJudge LexLeanRuntime

/-- The conditions of a rule, as the words state them: field, operator, bound. -/
def condsOf (w : List Nat) : Nat → Nat → List Cond
  | _, 0 => []
  | a, k + 1 => ⟨word w a, word w (a + 1), word w (a + 2)⟩ :: condsOf w (a + 3) k

/-- The rules, as the words state them: conditions, then outcome. -/
def rulesOf (w : List Nat) : Nat → Nat → List Rule
  | _, 0 => []
  | a, k + 1 => ⟨condsOf w (a + 2) (word w a), word w (a + 1)⟩ :: rulesOf w (ruleSpan w a) k

/-- Each field's least and greatest value. -/
def boundsOf (w : List Nat) : Nat → Nat → Box
  | _, 0 => []
  | f, k + 1 => (word w (2 + multiply 2 f), word w (3 + multiply 2 f)) :: boundsOf w (f + 1) k

/-- A rule's conditions as boxes: `is not` (any operator past 4) is below or above. -/
def splitConds : List Cond → List (List Cond)
  | [] => [[]]
  | c :: cs =>
    if c.op < 5 then (splitConds cs).map (c :: ·)
    else (splitConds cs).map (⟨c.field, 0, c.value⟩ :: ·) ++ (splitConds cs).map (⟨c.field, 2, c.value⟩ :: ·)

/-- The same rules with every `is not` split, in order: the first match answers the same. -/
def expand : List Rule → List Rule
  | [] => []
  | r :: rs => (splitConds r.when).map (fun cs => ⟨cs, r.outcome⟩) ++ expand rs

/-- What the tab has Lean's kernel evaluate for one guarantee of an app whose words, before the request, are `P`. -/
def wordsCheck (P : List Nat) (p : Property) : Bool :=
  let n := word P 1
  let start := 4 + multiply 2 n
  (rulesEnd P start (word P (3 + multiply 2 n)) == P.length) &&
  regionCheck (boundsOf P 0 n) (expand (rulesOf P start (word P (3 + multiply 2 n)))) [p] (word P (2 + multiply 2 n))

/-! ### The words read the same with the request after them -/

theorem listIndex_append_lt : ∀ (P x : List Nat) (i : Nat), i < P.length → listIndex (P ++ x) i = listIndex P i
  | [], _, _, h => absurd h (by simp)
  | _ :: _, _, 0, _ => rfl
  | _ :: P, x, i + 1, h => listIndex_append_lt P x i (by simp at h; omega)

theorem word_append_lt (P x : List Nat) (i : Nat) (h : i < P.length) : word (P ++ x) i = word P i := by
  simp only [word, index, listIndex_append_lt P x i h]

theorem listIndex_append_len : ∀ (P x : List Nat) (f : Nat), listIndex (P ++ x) (P.length + f) = listIndex x f
  | [], _, _ => by simp
  | _ :: P, x, f => by
    have := listIndex_append_len P x f
    simp only [List.cons_append, List.length_cons, show P.length + 1 + f = (P.length + f) + 1 by omega, listIndex]
    exact this

theorem listIndex_get : ∀ (x : List Nat) (f : Nat), (match listIndex x f with | none => 0 | some v => v) = get x f
  | [], _ => rfl
  | _ :: _, 0 => rfl
  | _ :: x, f + 1 => listIndex_get x f

theorem word_append_len (P x : List Nat) (f : Nat) : word (P ++ x) (P.length + f) = get x f := by
  simp only [word, index, listIndex_append_len]; exact listIndex_get x f

theorem le_ruleSpan (w : List Nat) (a : Nat) : a + 2 ≤ ruleSpan w a := by
  simp only [ruleSpan, multiply]; omega

theorem le_rulesEnd (w : List Nat) : ∀ (a k : Nat), a ≤ rulesEnd w a k
  | a, 0 => by simp [rulesEnd]
  | a, k + 1 => by
    simp only [rulesEnd]
    have := le_rulesEnd w (ruleSpan w a) k; have := le_ruleSpan w a; omega

theorem condsOf_append (P x : List Nat) : ∀ (a k : Nat), a + 3 * k ≤ P.length → condsOf (P ++ x) a k = condsOf P a k
  | _, 0, _ => rfl
  | a, k + 1, h => by
    simp only [condsOf, word_append_lt P x a (by omega), word_append_lt P x (a + 1) (by omega),
      word_append_lt P x (a + 2) (by omega), condsOf_append P x (a + 3) k (by omega)]

theorem boundsOf_append (P x : List Nat) : ∀ (f k : Nat), 2 + 2 * (f + k) ≤ P.length →
    boundsOf (P ++ x) f k = boundsOf P f k
  | _, 0, _ => rfl
  | f, k + 1, h => by
    simp only [boundsOf, multiply, word_append_lt P x (2 + 2 * f) (by omega), word_append_lt P x (3 + 2 * f) (by omega),
      boundsOf_append P x (f + 1) k (by omega)]

theorem ruleSpan_append (P x : List Nat) (a : Nat) (h : a < P.length) : ruleSpan (P ++ x) a = ruleSpan P a := by
  simp only [ruleSpan, word_append_lt P x a h]

theorem rules_append (P x : List Nat) : ∀ (a k : Nat), rulesEnd P a k ≤ P.length →
    rulesEnd (P ++ x) a k = rulesEnd P a k ∧ rulesOf (P ++ x) a k = rulesOf P a k
  | _, 0, _ => ⟨rfl, rfl⟩
  | a, k + 1, h => by
    simp only [rulesEnd] at h
    have hs := le_ruleSpan P a
    have he := le_rulesEnd P (ruleSpan P a) k
    have ha : a < P.length := by omega
    have ih := rules_append P x (ruleSpan P a) k h
    refine ⟨by simp only [rulesEnd, ruleSpan_append P x a ha, ih.1], ?_⟩
    have hsp : ruleSpan P a = a + 2 + 3 * word P a := by simp [ruleSpan, multiply]
    have hc : (a + 2) + 3 * word P a ≤ P.length := by omega
    simp only [rulesOf, ruleSpan_append P x a ha, ih.2, word_append_lt P x a ha,
      word_append_lt P x (a + 1) (by omega), condsOf_append P x (a + 2) (word P a) hc]

/-! ### The guest's judge is the first-match judge -/

theorem ruleOpHolds_eq (op c v : Nat) : ruleOpHolds op c v = opHolds op c v := by
  unfold ruleOpHolds opHolds
  have bl : ∀ a b, Nat.blt a b = Decidable.decide (a < b) := fun a b => Bool.eq_iff_iff.mpr (by simp [Nat.blt_eq])
  have le : ∀ a b, Nat.ble a b = Decidable.decide (a ≤ b) := fun a b => Bool.eq_iff_iff.mpr (by simp [Nat.ble_eq])
  have eq : ∀ a b, Nat.beq a b = Decidable.decide (a = b) := fun a b => Bool.eq_iff_iff.mpr (by simp [Nat.beq_eq])
  simp only [bl, le, eq]
  by_cases h0 : op = 0 <;> by_cases h1 : op = 1 <;> by_cases h2 : op = 2 <;> by_cases h3 : op = 3 <;>
    by_cases h4 : op = 4 <;> simp [h0, h1, h2, h3, h4] <;> omega

theorem ruleCondsHold_eq (w x : List Nat) (base : Nat) (hx : ∀ f, word w (base + f) = get x f) :
    ∀ (a k : Nat), ruleCondsHold w a k base = allHold (condsOf w a k) x
  | _, 0 => rfl
  | a, k + 1 => by
    simp only [ruleCondsHold, condsOf, allHold, condHolds, ruleOpHolds_eq, hx, ruleCondsHold_eq w x base hx (a + 3) k]
    rfl

theorem ruleOutcome_eq (w x : List Nat) (base d : Nat) (hx : ∀ f, word w (base + f) = get x f) :
    ∀ (a k : Nat), ruleOutcome w a k d base = judge (rulesOf w a k) d x
  | _, 0 => rfl
  | a, k + 1 => by
    simp only [ruleOutcome, rulesOf, judge, ruleCondsHold_eq w x base hx, ruleOutcome_eq w x base d hx (ruleSpan w a) k]

theorem get_of_drop : ∀ (x : List Nat) (f v : Nat) (vs : List Nat), x.drop f = v :: vs → get x f = v ∧ vs = x.drop (f + 1)
  | [], _, _, _, h => by simp at h
  | y :: ys, 0, v, vs, h => by simp at h; simp [get, h.1, h.2]
  | _ :: ys, f + 1, v, vs, h => get_of_drop ys f v vs (by simpa using h)

theorem ruleInBounds_eq (w x : List Nat) (base : Nat) (hx : ∀ f, word w (base + f) = get x f) :
    ∀ (x' : List Nat) (f k : Nat), x' = x.drop f → x'.length = k →
      ruleInBounds w f k base = inBox (boundsOf w f k) x'
  | [], _, 0, _, _ => rfl
  | v :: vs, f, k + 1, hd, hl => by
    have hv := get_of_drop x f v vs hd.symm
    simp only [ruleInBounds, boundsOf, inBox_cons, hx, hv.1,
      ruleInBounds_eq w x base hx vs (f + 1) k hv.2 (by simpa using hl)]
    have le : ∀ a b, Nat.ble a b = Decidable.decide (a ≤ b) := fun a b => Bool.eq_iff_iff.mpr (by simp [Nat.ble_eq])
    simp only [le]
    cases Decidable.decide (word w (2 + multiply 2 f) ≤ v) <;> cases Decidable.decide (v ≤ word w (3 + multiply 2 f)) <;> rfl
  | [], _, _ + 1, _, hl => absurd hl (Nat.succ_ne_zero _).symm
  | _ :: _, _, 0, _, hl => absurd hl (by simp)

/-! ### Splitting `is not` keeps the first match -/

theorem allHold_cons' (c : Cond) (cs : List Cond) (x : List Nat) :
    allHold (c :: cs) x = (condHolds c x && allHold cs x) := by
  simp only [allHold]; cases condHolds c x <;> rfl

theorem any_map_cons (c : Cond) (x : List Nat) : ∀ L : List (List Cond),
    (L.map (c :: ·)).any (fun ds => allHold ds x) = (condHolds c x && L.any (fun ds => allHold ds x))
  | [] => by simp
  | d :: L => by
    simp only [List.map_cons, List.any_cons, any_map_cons c x L, allHold_cons']
    cases condHolds c x <;> simp

theorem allHold_split : ∀ (cs : List Cond) (x : List Nat), allHold cs x = (splitConds cs).any (fun ds => allHold ds x)
  | [], x => by simp [splitConds, allHold]
  | c :: cs, x => by
    have ih := allHold_split cs x
    by_cases h : c.op < 5
    · simp only [splitConds, h, if_true, any_map_cons, allHold_cons', ih]
    · simp only [splitConds, h, if_false, List.any_append, any_map_cons, allHold_cons', ← ih]
      have hne : condHolds c x = (condHolds ⟨c.field, 0, c.value⟩ x || condHolds ⟨c.field, 2, c.value⟩ x) := by
        unfold condHolds opHolds; simp only
        have h0 : c.op ≠ 0 := by omega
        have h1 : c.op ≠ 1 := by omega
        have h2 : c.op ≠ 2 := by omega
        have h3 : c.op ≠ 3 := by omega
        have h4 : c.op ≠ 4 := by omega
        simp only [h0, h1, h2, h3, h4, if_false]
        by_cases e : get x c.field = c.value <;> simp [e] <;> omega
      rw [hne]; cases condHolds ⟨c.field, 0, c.value⟩ x <;> cases condHolds ⟨c.field, 2, c.value⟩ x <;> simp

theorem judge_block (o d : Nat) (x : List Nat) (rs : List Rule) :
    ∀ css : List (List Cond), judge (css.map (fun cs => ⟨cs, o⟩) ++ rs) d x =
      if css.any (fun cs => allHold cs x) then o else judge rs d x
  | [] => by simp
  | cs :: css => by
    simp only [List.map_cons, List.cons_append, judge, List.any_cons, judge_block o d x rs css]
    by_cases h : allHold cs x = true <;> simp [h]

theorem judge_expand (d : Nat) (x : List Nat) : ∀ rs : List Rule, judge (expand rs) d x = judge rs d x
  | [] => rfl
  | r :: rs => by
    simp only [expand, judge_block, judge, judge_expand d x rs, ← allHold_split]

/-! ### Soundness of the published judge -/

/-- If `wordsCheck` holds on an app's words `P`, then for every request `x` the guest takes (the words are `P`
followed by `x`, `ruleDecide`'s length test passes, and `ruleInBounds` holds), the outcome the guest answers,
`ruleOutcome`, does not break `p`. -/
theorem ruleJudge_sound (P : List Nat) (p : Property) (hc : wordsCheck P p = true) (x : List Nat)
    (hlen : rulesEnd (P ++ x) (4 + multiply 2 (word (P ++ x) 1)) (word (P ++ x) (3 + multiply 2 (word (P ++ x) 1)))
      + word (P ++ x) 1 = (P ++ x).length)
    (hin : ruleInBounds (P ++ x) 0 (word (P ++ x) 1)
      (rulesEnd (P ++ x) (4 + multiply 2 (word (P ++ x) 1)) (word (P ++ x) (3 + multiply 2 (word (P ++ x) 1)))) = true) :
    breaksWith p x (ruleOutcome (P ++ x) (4 + multiply 2 (word (P ++ x) 1))
      (word (P ++ x) (3 + multiply 2 (word (P ++ x) 1))) (word (P ++ x) (2 + multiply 2 (word (P ++ x) 1)))
      (rulesEnd (P ++ x) (4 + multiply 2 (word (P ++ x) 1)) (word (P ++ x) (3 + multiply 2 (word (P ++ x) 1))))) = false := by
  simp only [wordsCheck, Bool.and_eq_true, beq_iff_eq] at hc
  obtain ⟨hend, hreg⟩ := hc
  -- The header words are before the rules, so they read the same with the request after them.
  have hstart : 4 + 2 * word P 1 ≤ P.length := by
    have := le_rulesEnd P (4 + multiply 2 (word P 1)) (word P (3 + multiply 2 (word P 1)))
    rw [hend] at this; simpa [multiply] using this
  have h1 : word (P ++ x) 1 = word P 1 := word_append_lt P x 1 (by omega)
  have h2 : word (P ++ x) (2 + multiply 2 (word P 1)) = word P (2 + multiply 2 (word P 1)) :=
    word_append_lt P x _ (by simp only [multiply]; omega)
  have h3 : word (P ++ x) (3 + multiply 2 (word P 1)) = word P (3 + multiply 2 (word P 1)) :=
    word_append_lt P x _ (by simp only [multiply]; omega)
  rw [h1, h3] at hlen hin ⊢; rw [h2]
  obtain ⟨he, hr⟩ := rules_append P x _ _ (Nat.le_of_eq hend)
  rw [he, hend] at hlen hin ⊢
  have hx : ∀ f, word (P ++ x) (P.length + f) = get x f := word_append_len P x
  have hxl : x.length = word P 1 := by simp at hlen; omega
  rw [ruleOutcome_eq _ x _ _ hx, hr, ← judge_expand]
  have hbox : inBox (boundsOf P 0 (word P 1)) x = true := by
    rw [ruleInBounds_eq _ x _ hx x 0 _ rfl hxl, boundsOf_append P x 0 _ (by omega)] at hin
    exact hin
  exact regionCheck_sound _ _ _ _ hreg p (by simp) x hbox

end PrismLive.Kernel
