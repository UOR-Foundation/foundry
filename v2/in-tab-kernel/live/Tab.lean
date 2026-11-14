import PrismLive.Regions

/-!
# Every rule a Prism spec can state, proved in the tab

`linked_sound` (Linked.lean) proves a guarantee from boxes: every field a range, every rule a box. A spec can say more.
A rule may say `is not` (a field is not a value), and may compare two fields (`party > seats`). Neither is a box.

Here a region is a list of zones. A zone is a box and a few difference constraints, `x_a + k ≤ x_b + j`. Every
condition a spec can state gives zones exactly: `is not` splits a zone in two, a comparison of fields adds a
constraint (or splits, for `!=`). Zones are closed under the two things an obligation needs. Their meet is a zone,
and one zone minus another is a list of zones. That a zone holds no request is decided by closing its constraints
(Floyd and Warshall's closure) and finding a constraint that says a field is above itself.

The semantics are stated here, beside the checker: `Cond` carries whether its value is a number or another field.
For a spec with no such condition they are `PrismLive.Kernel`'s (`condHolds_number`).

The proof of one guarantee is assembled from facts, as in Linked.lean, and the kernel evaluates nothing while
assembling. A fact is one evaluation: a list of conditions and its zones (`ZonesOf`), that an answer does not break a
kind of guarantee (`NotBad`), and that zones cover the meet of two zones (`Covers`).

`tab_sound`: if the facts hold and the assembly checks, no request in the bounds breaks the guarantee.
-/

namespace PrismLive.Tab
open PrismLive.Kernel

/-! ## Semantics -/

/-- Field `field` compared by `op` with the number `value`, or, when `other`, with field `value`. -/
structure Cond where
  field : Nat
  op : Nat
  value : Nat
  other : Bool

def condHolds (c : Cond) (x : List Nat) : Bool :=
  opHolds c.op (if c.other then get x c.value else c.value) (get x c.field)

def allHold : List Cond → List Nat → Bool
  | [], _ => true
  | c :: cs, x => if condHolds c x then allHold cs x else false

structure Rule where
  when : List Cond
  outcome : Nat

/-- First match decides; `d` is `otherwise`. -/
def judge : List Rule → Nat → List Nat → Nat
  | [], d, _ => d
  | r :: rs, d, x => if allHold r.when x then r.outcome else judge rs d x

/-- Outcome `o` breaks a guarantee that always (or never) answers `outcome`. -/
def bad (always : Bool) (outcome o : Nat) : Bool :=
  if always then (if o = outcome then false else true) else (if o = outcome then true else false)

/-- Request `x` breaks the guarantee "when `pw`, always (or never) `po`". -/
def breaks (rules : List Rule) (d : Nat) (always : Bool) (pw : List Cond) (po : Nat) (x : List Nat) : Bool :=
  allHold pw x && bad always po (judge rules d x)

theorem condHolds_number (c : Cond) (h : c.other = false) (x : List Nat) :
    condHolds c x = PrismLive.Kernel.condHolds ⟨c.field, c.op, c.value⟩ x := by
  simp [condHolds, PrismLive.Kernel.condHolds, h]

/-! ## Zones -/

/-- `x_a + k ≤ x_b + j`. -/
structure Diff where
  a : Nat
  k : Nat
  b : Nat
  j : Nat

def diffHolds (e : Diff) (x : List Nat) : Bool := decide (get x e.a + e.k ≤ get x e.b + e.j)

/-- Exactly the requests `e` does not hold on. -/
def negDiff (e : Diff) : Diff := ⟨e.b, e.j + 1, e.a, e.k⟩

theorem diffHolds_neg (e : Diff) (x : List Nat) : diffHolds (negDiff e) x = !diffHolds e x := by
  unfold diffHolds negDiff
  by_cases h : get x e.a + e.k ≤ get x e.b + e.j
  · have : ¬ (get x e.b + (e.j + 1) ≤ get x e.a + e.k) := by omega
    simp [h, this]
  · have : get x e.b + (e.j + 1) ≤ get x e.a + e.k := by omega
    simp [h, this]

def allDiffs : List Diff → List Nat → Bool
  | [], _ => true
  | e :: es, x => if diffHolds e x then allDiffs es x else false

theorem allDiffs_append (x : List Nat) : ∀ (es fs : List Diff), allDiffs (es ++ fs) x = (allDiffs es x && allDiffs fs x)
  | [], fs => by simp [allDiffs]
  | e :: es, fs => by
    simp only [List.cons_append, allDiffs]
    split <;> simp [allDiffs_append x es fs]

@[simp] theorem allDiffs_cons (e : Diff) (es : List Diff) (x : List Nat) :
    allDiffs (e :: es) x = (diffHolds e x && allDiffs es x) := by
  simp only [allDiffs]; split <;> simp_all

/-- Linear facts move through a conjunction with Boolean ones. -/
theorem iff_one {A B P Q : Prop} (h : P ↔ Q) : (A ∧ P ∧ B) ↔ ((A ∧ B) ∧ Q) := by
  rw [h]; constructor
  · rintro ⟨a, q, b⟩; exact ⟨⟨a, b⟩, q⟩
  · rintro ⟨⟨a, b⟩, q⟩; exact ⟨a, q, b⟩
theorem iff_two {A B P₁ P₂ Q : Prop} (h : P₁ ∧ P₂ ↔ Q) : (A ∧ P₁ ∧ P₂ ∧ B) ↔ ((A ∧ B) ∧ Q) := by
  rw [← h]; constructor
  · rintro ⟨a, p, p', b⟩; exact ⟨⟨a, b⟩, p, p'⟩
  · rintro ⟨⟨a, b⟩, p, p'⟩; exact ⟨a, p, p', b⟩
theorem iff_or {A B P₁ P₂ Q : Prop} (h : P₁ ∨ P₂ ↔ Q) : ((A ∧ P₁ ∧ B) ∨ (A ∧ P₂ ∧ B)) ↔ ((A ∧ B) ∧ Q) := by
  rw [← h]; constructor
  · rintro (⟨a, p, b⟩ | ⟨a, p, b⟩)
    · exact ⟨⟨a, b⟩, Or.inl p⟩
    · exact ⟨⟨a, b⟩, Or.inr p⟩
  · rintro ⟨⟨a, b⟩, p | p⟩
    · exact Or.inl ⟨a, p, b⟩
    · exact Or.inr ⟨a, p, b⟩

theorem allDiffs_mem (x : List Nat) : ∀ (ds : List Diff) (d : Diff), allDiffs ds x = true → d ∈ ds → diffHolds d x = true
  | [], _, _, h => absurd h List.not_mem_nil
  | d' :: ds, d, hd, hm => by
    simp only [allDiffs] at hd
    split at hd
    · rename_i h
      cases List.mem_cons.mp hm with
      | inl q => rw [q]; exact h
      | inr q => exact allDiffs_mem x ds d hd q
    · simp at hd

abbrev Zone := Box × List Diff

def inZone (z : Zone) (x : List Nat) : Bool := inBox z.1 x && allDiffs z.2 x

/-! ## A zone with no request: the closure of its constraints -/

/-- A request's value at a node: node 0 is the number 0, node `f + 1` is field `f`. -/
def val (x : List Nat) (n : Nat) : Int := if n = 0 then 0 else (get x (n - 1) : Int)

/-- `val v - val u ≥ w`. -/
structure Edge where
  u : Nat
  v : Nat
  w : Int

def Implied (x : List Nat) (es : List Edge) : Prop := ∀ e ∈ es, e.w ≤ val x e.v - val x e.u

/-- The edge from `u` to `v` kept once, at its largest weight. -/
def addEdge : List Edge → Edge → List Edge
  | [], e => [e]
  | f :: fs, e => if f.u = e.u ∧ f.v = e.v then (if f.w < e.w then e :: fs else f :: fs) else f :: addEdge fs e

theorem mem_addEdge (e : Edge) : ∀ (es : List Edge) (e' : Edge), e' ∈ addEdge es e → e' ∈ es ∨ e' = e
  | [], e', h => by simp [addEdge] at h; exact Or.inr h
  | f :: fs, e', h => by
    simp only [addEdge] at h
    split at h
    · split at h
      · cases List.mem_cons.mp h with
        | inl q => exact Or.inr q
        | inr q => exact Or.inl (List.mem_cons_of_mem _ q)
      · exact Or.inl h
    · cases List.mem_cons.mp h with
      | inl q => exact Or.inl (q ▸ List.mem_cons_self ..)
      | inr q => cases mem_addEdge e fs e' q with
        | inl r => exact Or.inl (List.mem_cons_of_mem _ r)
        | inr r => exact Or.inr r

theorem implied_addEdge (x : List Nat) (es : List Edge) (e : Edge) (hs : Implied x es)
    (he : e.w ≤ val x e.v - val x e.u) : Implied x (addEdge es e) := fun e' h' => by
  cases mem_addEdge e es e' h' with
  | inl q => exact hs e' q
  | inr q => rw [q]; exact he

/-- Every edge into `c` composed with `out`, the edges out of `c`, added to `acc`. -/
def composeOut (out : List Edge) (e1 : Edge) : List Edge → List Edge
  | acc => out.foldl (fun acc2 e2 => addEdge acc2 ⟨e1.u, e2.v, e1.w + e2.w⟩) acc

def throughNode (es : List Edge) (c : Nat) : List Edge :=
  (es.filter (fun e => e.v = c)).foldl (fun acc e1 => composeOut (es.filter (fun e => e.u = c)) e1 acc) es

theorem implied_foldl_out (x : List Nat) (e1 : Edge) (h1 : e1.w ≤ val x e1.v - val x e1.u) :
    ∀ (out acc : List Edge), (∀ e2 ∈ out, e2.u = e1.v ∧ e2.w ≤ val x e2.v - val x e2.u) → Implied x acc →
    Implied x (out.foldl (fun acc2 e2 => addEdge acc2 ⟨e1.u, e2.v, e1.w + e2.w⟩) acc)
  | [], acc, _, ha => ha
  | e2 :: out, acc, ho, ha => by
    simp only [List.foldl]
    apply implied_foldl_out x e1 h1 out
    · exact fun e h => ho e (List.mem_cons_of_mem _ h)
    · apply implied_addEdge x acc _ ha
      obtain ⟨hu, hw⟩ := ho e2 (List.mem_cons_self ..)
      show e1.w + e2.w ≤ val x e2.v - val x e1.u
      rw [hu] at hw; omega

theorem implied_throughNode (x : List Nat) (es : List Edge) (c : Nat) (hs : Implied x es) :
    Implied x (throughNode es c) := by
  unfold throughNode
  have hin : ∀ e1 ∈ es.filter (fun e => e.v = c), e1.v = c ∧ e1.w ≤ val x e1.v - val x e1.u := fun e1 h => by
    have := List.mem_filter.mp h; exact ⟨by simpa using this.2, hs e1 this.1⟩
  have hout : ∀ e2 ∈ es.filter (fun e => e.u = c), e2.u = c ∧ e2.w ≤ val x e2.v - val x e2.u := fun e2 h => by
    have := List.mem_filter.mp h; exact ⟨by simpa using this.2, hs e2 this.1⟩
  generalize es.filter (fun e => e.v = c) = ins at hin
  generalize es.filter (fun e => e.u = c) = out at hout
  induction ins generalizing es with
  | nil => exact hs
  | cons e1 rest ih =>
    simp only [List.foldl]
    apply ih
    · unfold composeOut
      obtain ⟨hv, hw⟩ := hin e1 (List.mem_cons_self ..)
      exact implied_foldl_out x e1 hw out es (fun e2 h => ⟨(hout e2 h).1.trans hv.symm, (hout e2 h).2⟩) hs
    · exact fun e h => hin e (List.mem_cons_of_mem _ h)

/-- The closure through each node of `ns` in turn. -/
def closeAll (es : List Edge) : List Nat → List Edge
  | [] => es
  | c :: cs => closeAll (throughNode es c) cs

theorem implied_closeAll (x : List Nat) : ∀ (ns : List Nat) (es : List Edge), Implied x es → Implied x (closeAll es ns)
  | [], _, h => h
  | c :: cs, es, h => implied_closeAll x cs _ (implied_throughNode x es c h)

/-- The bounds of field `f` in a box, if it has one. -/
def boxAt : Box → Nat → Option (Nat × Nat)
  | [], _ => none
  | b :: _, 0 => some b
  | _ :: bs, f + 1 => boxAt bs f

theorem boxAt_bounds : ∀ (B : Box) (x : List Nat) (f l h : Nat), inBox B x = true → boxAt B f = some (l, h) →
    l ≤ get x f ∧ get x f ≤ h
  | [], _, _, _, _, _, hb => by simp [boxAt] at hb
  | (l', h') :: bs, v :: vs, 0, l, h, hx, hb => by
    simp only [boxAt, Option.some.injEq, Prod.mk.injEq] at hb
    obtain ⟨rfl, rfl⟩ := hb
    simp only [inBox_cons, Bool.and_eq_true, decide_eq_true_eq] at hx
    exact ⟨hx.1.1, hx.1.2⟩
  | (l', h') :: bs, v :: vs, f + 1, l, h, hx, hb => by
    simp only [boxAt] at hb
    simp only [inBox_cons, Bool.and_eq_true] at hx
    exact boxAt_bounds bs vs f l h hx.2 hb
  | _ :: _, [], _, _, _, hx, _ => by simp [inBox] at hx

/-- The edges a zone states: its constraints, and the bounds of the fields they name. -/
def boundEdges (B : Box) (f : Nat) : List Edge :=
  match boxAt B f with
  | some (l, h) => [⟨0, f + 1, (l : Int)⟩, ⟨f + 1, 0, -(h : Int)⟩]
  | none => []

def edgesOf (z : Zone) : List Edge :=
  z.2.flatMap (fun e => ⟨e.a + 1, e.b + 1, (e.k : Int) - (e.j : Int)⟩ :: (boundEdges z.1 e.a ++ boundEdges z.1 e.b))

def nodesOf (z : Zone) : List Nat := 0 :: z.2.flatMap (fun e => [e.a + 1, e.b + 1])

/-- The zone holds no request: its box is empty, or its constraints close to a field above itself. -/
def zEmpty (z : Zone) : Bool :=
  !nonEmpty z.1 || (closeAll (edgesOf z) (nodesOf z)).any (fun e => decide (e.u = e.v) && decide (0 < e.w))

theorem implied_edgesOf (z : Zone) (x : List Nat) (hz : inZone z x = true) : Implied x (edgesOf z) := by
  simp only [inZone, Bool.and_eq_true] at hz
  obtain ⟨hb, hd⟩ := hz
  intro e he
  simp only [edgesOf, List.mem_flatMap, List.mem_cons, List.mem_append] at he
  obtain ⟨d, hdm, he⟩ := he
  have hdh : diffHolds d x = true := allDiffs_mem x z.2 d hd hdm
  have bound : ∀ f, ∀ e ∈ boundEdges z.1 f, e.w ≤ val x e.v - val x e.u := fun f e h => by
    unfold boundEdges at h
    split at h
    · rename_i l hh hat
      have := boxAt_bounds z.1 x f l hh hb hat
      simp only [List.mem_cons, List.not_mem_nil, or_false] at h
      rcases h with rfl | rfl <;> simp [val] <;> omega
    · simp at h
  rcases he with rfl | h | h
  · simp only [diffHolds, decide_eq_true_eq] at hdh
    simp [val]; omega
  · exact bound d.a e h
  · exact bound d.b e h

theorem zEmpty_sound (z : Zone) (x : List Nat) (hz : inZone z x = true) : zEmpty z = false := by
  have hb : nonEmpty z.1 = true := by
    simp only [inZone, Bool.and_eq_true] at hz; exact nonEmpty_of_inBox _ _ hz.1
  have hc := implied_closeAll x (nodesOf z) _ (implied_edgesOf z x hz)
  simp only [zEmpty, hb, Bool.not_true, Bool.false_or, List.any_eq_false]
  intro e he
  have := hc e he
  by_cases h : e.u = e.v
  · rw [h] at this; simp [h]; omega
  · simp [h]

/-! ## Meet and difference -/

def meetZ (q w : Zone) : Zone := (meet q.1 w.1, q.2 ++ w.2)

theorem inZone_meetZ (q w : Zone) (x : List Nat) (hq : inZone q x = true) (hw : inZone w x = true) :
    inZone (meetZ q w) x = true := by
  simp only [inZone, Bool.and_eq_true] at hq hw
  simp only [inZone, meetZ, allDiffs_append, Bool.and_eq_true]
  exact ⟨inBox_meet _ _ x hq.1 hw.1, hq.2, hw.2⟩

/-- The part of a box inside another's, split by that one's constraints: each piece fails one, the first. -/
def diffPieces (m : Box) (ds : List Diff) : List Diff → List Diff → List Zone
  | _, [] => []
  | held, e :: es => (m, negDiff e :: held ++ ds) :: diffPieces m ds (held ++ [e]) es

/-- Zones that together cover every request of `a` outside `b`, none of them empty. -/
def subZ (a b : Zone) : List Zone :=
  ((sub a.1 b.1).map (fun p => (p, a.2)) ++ diffPieces (meet a.1 b.1) a.2 [] b.2).filter (fun z => !zEmpty z)

theorem diffPieces_cover (m : Box) (ds : List Diff) (x : List Nat) (hm : inBox m x = true) (hd : allDiffs ds x = true) :
    ∀ (held es : List Diff), allDiffs held x = true → allDiffs es x = false →
    ∃ p ∈ diffPieces m ds held es, inZone p x = true
  | _, [], _, he => by simp [allDiffs] at he
  | held, e :: es, hh, he => by
    simp only [allDiffs] at he
    by_cases h : diffHolds e x = true
    · rw [if_pos h] at he
      obtain ⟨p, hp, hpx⟩ := diffPieces_cover m ds x hm hd (held ++ [e]) es
        (by rw [allDiffs_append]; simp [hh, allDiffs, h]) he
      exact ⟨p, List.mem_cons_of_mem _ hp, hpx⟩
    · refine ⟨_, List.mem_cons_self .., ?_⟩
      have hn : diffHolds (negDiff e) x = true := by rw [diffHolds_neg]; simpa using h
      simp only [inZone, hm, Bool.true_and]
      show allDiffs (negDiff e :: (held ++ ds)) x = true
      simp only [allDiffs, hn, if_true, allDiffs_append, hh, hd, Bool.and_self]

theorem subZ_cover (a b : Zone) (x : List Nat) (ha : inZone a x = true) (hb : inZone b x = false) :
    ∃ p ∈ subZ a b, inZone p x = true := by
  simp only [inZone, Bool.and_eq_true] at ha
  have keep : ∀ p, inZone p x = true → p ∈ (sub a.1 b.1).map (fun p => (p, a.2)) ++ diffPieces (meet a.1 b.1) a.2 [] b.2 →
      ∃ p ∈ subZ a b, inZone p x = true := fun p hp hm =>
    ⟨p, List.mem_filter.mpr ⟨hm, by simp [zEmpty_sound p x hp]⟩, hp⟩
  cases hbb : inBox b.1 x
  · obtain ⟨p, hp, hpx⟩ := sub_cover a.1 b.1 x ha.1 hbb
    exact keep (p, a.2) (by simp [inZone, hpx, ha.2]) (List.mem_append_left _ (List.mem_map.mpr ⟨p, hp, rfl⟩))
  · have hbd : allDiffs b.2 x = false := by simpa [inZone, hbb] using hb
    obtain ⟨p, hp, hpx⟩ := diffPieces_cover (meet a.1 b.1) a.2 x (inBox_meet _ _ x ha.1 hbb) ha.2 [] b.2 rfl hbd
    exact keep p hpx (List.mem_append_right _ hp)

/-- `a` minus every zone of `bs`. -/
def subAllZ (a : Zone) : List Zone → List Zone
  | [] => if zEmpty a then [] else [a]
  | b :: bs => (subAllZ a bs).flatMap (fun p => subZ p b)

theorem subAllZ_cover (a : Zone) (x : List Nat) (ha : inZone a x = true) :
    ∀ bs : List Zone, (∀ b ∈ bs, inZone b x = false) → ∃ p ∈ subAllZ a bs, inZone p x = true
  | [], _ => ⟨a, by simp [subAllZ, zEmpty_sound a x ha], ha⟩
  | b :: bs, h => by
    obtain ⟨p, hp, hpx⟩ := subAllZ_cover a x ha bs (fun b' hb' => h b' (List.mem_cons_of_mem _ hb'))
    obtain ⟨q, hq, hqx⟩ := subZ_cover p b x hpx (h b (List.mem_cons_self ..))
    exact ⟨q, List.mem_flatMap.mpr ⟨p, hp, hq⟩, hqx⟩

theorem covered_of_subAllZ (a : Zone) (bs : List Zone) (h : subAllZ a bs = []) (x : List Nat)
    (ha : inZone a x = true) : ∃ b ∈ bs, inZone b x = true := by
  by_cases hc : ∃ b ∈ bs, inZone b x = true
  · exact hc
  · have : ∀ b ∈ bs, inZone b x = false := fun b hb => by
      cases hx : inZone b x
      · rfl
      · exact absurd ⟨b, hb, hx⟩ hc
    obtain ⟨p, hp, _⟩ := subAllZ_cover a x ha bs this
    rw [h] at hp; exact absurd hp List.not_mem_nil

/-! ## The zones of a list of conditions -/

/-- The condition's well formed: its field, and the field it compares with, are fields of a request. -/
def condOk (n : Nat) (c : Cond) : Bool := decide (c.field < n) && (!c.other || decide (c.value < n))

def condsOk (n : Nat) : List Cond → Bool
  | [] => true
  | c :: cs => condOk n c && condsOk n cs

/-- The zones of the requests of `z` that meet `c`. -/
def condZones (z : Zone) (c : Cond) : List Zone :=
  if c.other then
    (if c.op = 0 then [(z.1, ⟨c.field, 1, c.value, 0⟩ :: z.2)]
     else if c.op = 1 then [(z.1, ⟨c.field, 0, c.value, 0⟩ :: z.2)]
     else if c.op = 2 then [(z.1, ⟨c.value, 1, c.field, 0⟩ :: z.2)]
     else if c.op = 3 then [(z.1, ⟨c.value, 0, c.field, 0⟩ :: z.2)]
     else if c.op = 4 then [(z.1, ⟨c.field, 0, c.value, 0⟩ :: ⟨c.value, 0, c.field, 0⟩ :: z.2)]
     else [(z.1, ⟨c.field, 1, c.value, 0⟩ :: z.2), (z.1, ⟨c.value, 1, c.field, 0⟩ :: z.2)])
  else if c.op < 5 then [(condBox z.1 ⟨c.field, c.op, c.value⟩, z.2)]
  else (if c.value = 0 then [] else [(setHi z.1 c.field (c.value - 1), z.2)]) ++ [(setLo z.1 c.field (c.value + 1), z.2)]

theorem condZones_length (z : Zone) (c : Cond) : ∀ q ∈ condZones z c, q.1.length = z.1.length := by
  intro q hq
  unfold condZones at hq
  by_cases ho : c.other = true
  · simp only [ho, if_true] at hq
    by_cases h0 : c.op = 0 <;> by_cases h1 : c.op = 1 <;> by_cases h2 : c.op = 2 <;> by_cases h3 : c.op = 3 <;>
      by_cases h4 : c.op = 4 <;> simp [h0, h1, h2, h3, h4] at hq
    all_goals first | (subst hq; rfl) | (rcases hq with rfl | rfl <;> rfl)
  · simp only [ho, Bool.false_eq_true, if_false] at hq
    by_cases h5 : c.op < 5
    · simp [h5] at hq; subst hq; exact condBox_length _ _
    · by_cases hv : c.value = 0 <;> simp [h5, hv] at hq
      all_goals first | (subst hq; simp [setLo_length, setHi_length]) | (rcases hq with rfl | rfl <;> simp [setLo_length, setHi_length])

theorem condZones_spec (z : Zone) (c : Cond) (x : List Nat) (hc : condOk z.1.length c = true) :
    (∃ q ∈ condZones z c, inZone q x = true) ↔ (inZone z x = true ∧ condHolds c x = true) := by
  simp only [condOk, Bool.and_eq_true, decide_eq_true_eq, Bool.or_eq_true, Bool.not_eq_true'] at hc
  obtain ⟨hf, ho⟩ := hc
  unfold condZones condHolds
  by_cases hother : c.other = true
  · simp only [hother, if_true]
    have hop : c.op = 0 ∨ c.op = 1 ∨ c.op = 2 ∨ c.op = 3 ∨ c.op = 4 ∨ 5 ≤ c.op := by omega
    rcases hop with h | h | h | h | h | h
    all_goals simp only [h, opHolds, inZone, allDiffs_cons, diffHolds, Bool.and_eq_true, decide_eq_true_eq,
      List.mem_cons, List.not_mem_nil, or_false, exists_eq_left, if_true, if_false, Nat.reduceEqDiff, ite_true,
      ite_false, Bool.true_and]
    · exact iff_one (by rw [h] at *; split <;> simp_all <;> omega)
    · exact iff_one (by split <;> simp_all <;> omega)
    · exact iff_one (by split <;> simp_all <;> omega)
    · exact iff_one (by split <;> simp_all <;> omega)
    · exact iff_two (by split <;> simp_all <;> omega)
    · have n0 : ¬ c.op = 0 := by omega
      have n1 : ¬ c.op = 1 := by omega
      have n2 : ¬ c.op = 2 := by omega
      have n3 : ¬ c.op = 3 := by omega
      have n4 : ¬ c.op = 4 := by omega
      simp only [n0, n1, n2, n3, n4, if_false, List.mem_cons, List.not_mem_nil, or_false, exists_eq_or_imp,
        exists_eq_left, inZone, allDiffs_cons, diffHolds, Bool.and_eq_true, decide_eq_true_eq]
      exact iff_or (by split <;> simp_all <;> omega)
  · have hn : c.other = false := by simpa using hother
    simp only [hn, Bool.false_eq_true, if_false]
    by_cases hop : c.op < 5
    · simp only [hop, if_true, List.mem_cons, List.not_mem_nil, or_false, exists_eq_left]
      have := condHolds_number c hn x
      simp only [condHolds, hn, Bool.false_eq_true, if_false] at this
      rw [this]
      constructor
      · intro h
        simp only [inZone, Bool.and_eq_true] at h ⊢
        have := condBox_exact z.1 ⟨c.field, c.op, c.value⟩ x hf hop h.1
        exact ⟨⟨this.1, h.2⟩, this.2⟩
      · intro ⟨h, hh⟩
        simp only [inZone, Bool.and_eq_true] at h ⊢
        exact ⟨condBox_hull z.1 ⟨c.field, c.op, c.value⟩ x hf h.1 hh, h.2⟩
    · simp only [hop, if_false]
      have hne : opHolds c.op c.value (get x c.field) = !(decide (get x c.field = c.value)) := by
        simp only [opHolds]
        have : ¬ c.op = 0 := by omega
        have : ¬ c.op = 1 := by omega
        have : ¬ c.op = 2 := by omega
        have : ¬ c.op = 3 := by omega
        have : ¬ c.op = 4 := by omega
        by_cases e : get x c.field = c.value <;> simp_all
      rw [hne]
      have lo := inBox_setLo z.1 c.field (c.value + 1) x hf
      have hi := inBox_setHi z.1 c.field (c.value - 1) x hf
      by_cases hv : c.value = 0
      · simp only [hv, if_true, List.nil_append, List.mem_cons, List.not_mem_nil, or_false, exists_eq_left, inZone,
          Bool.and_eq_true] at lo ⊢
        rw [lo]; constructor
        · rintro ⟨⟨h1, h2⟩, h3⟩; exact ⟨⟨h1, h3⟩, by simp; omega⟩
        · rintro ⟨⟨h1, h3⟩, h2⟩; simp at h2; exact ⟨⟨h1, by omega⟩, h3⟩
      · simp only [hv, if_false, List.singleton_append, List.mem_cons, List.not_mem_nil, or_false, exists_eq_or_imp,
          exists_eq_left, inZone, Bool.and_eq_true] at lo hi ⊢
        rw [lo, hi]; constructor
        · rintro (⟨⟨h1, h2⟩, h3⟩ | ⟨⟨h1, h2⟩, h3⟩) <;> exact ⟨⟨h1, h3⟩, by simp; omega⟩
        · rintro ⟨⟨h1, h3⟩, h2⟩
          simp at h2
          by_cases lt : get x c.field < c.value
          · exact Or.inl ⟨⟨h1, by omega⟩, h3⟩
          · exact Or.inr ⟨⟨h1, by omega⟩, h3⟩

/-- The zones of the requests of `zs` that meet every condition of `cs`. -/
def zonesFrom (zs : List Zone) : List Cond → List Zone
  | [] => zs
  | c :: cs => zonesFrom (zs.flatMap (fun z => condZones z c)) cs

def zonesOf (B : Box) (cs : List Cond) : List Zone := zonesFrom [(B, [])] cs

theorem zonesFrom_spec (n : Nat) (x : List Nat) : ∀ (cs : List Cond) (zs : List Zone),
    (∀ z ∈ zs, z.1.length = n) → condsOk n cs = true →
    ((∃ q ∈ zonesFrom zs cs, inZone q x = true) ↔ ((∃ z ∈ zs, inZone z x = true) ∧ allHold cs x = true))
  | [], zs, _, _ => by simp [zonesFrom, allHold]
  | c :: cs, zs, hl, hc => by
    simp only [condsOk, Bool.and_eq_true] at hc
    have hl' : ∀ z ∈ zs.flatMap (fun z => condZones z c), z.1.length = n := fun q hq => by
      obtain ⟨z, hz, hq⟩ := List.mem_flatMap.mp hq
      rw [condZones_length z c q hq, hl z hz]
    rw [zonesFrom, zonesFrom_spec n x cs _ hl' hc.2]
    simp only [allHold]
    constructor
    · rintro ⟨⟨q, hq, hqx⟩, hall⟩
      obtain ⟨z, hz, hq⟩ := List.mem_flatMap.mp hq
      have := (condZones_spec z c x (by rw [hl z hz]; exact hc.1)).mp ⟨q, hq, hqx⟩
      exact ⟨⟨z, hz, this.1⟩, by rw [if_pos this.2]; exact hall⟩
    · rintro ⟨⟨z, hz, hzx⟩, hall⟩
      split at hall
      · rename_i hcx
        obtain ⟨q, hq, hqx⟩ := (condZones_spec z c x (by rw [hl z hz]; exact hc.1)).mpr ⟨hzx, hcx⟩
        exact ⟨⟨q, List.mem_flatMap.mpr ⟨z, hz, hq⟩, hqx⟩, hall⟩
      · simp at hall

theorem zonesOf_spec (B : Box) (cs : List Cond) (x : List Nat) (hc : condsOk B.length cs = true)
    (hx : inBox B x = true) : (∃ q ∈ zonesOf B cs, inZone q x = true) ↔ allHold cs x = true := by
  rw [zonesOf, zonesFrom_spec B.length x cs _ (by simp) hc]
  simp [inZone, hx, allDiffs]

/-! ## Facts -/

/-- The conditions are well formed over `B`, and `Qs` are their zones. -/
def ZonesOf (B : Box) (cs : List Cond) (Qs : List Zone) : Prop := condsOk B.length cs = true ∧ zonesOf B cs = Qs
def NotBad (a : Bool) (po o : Nat) : Prop := bad a po o = false
/-- The zones `bs` cover every request in both `q` and `w`. -/
def Covers (q w : Zone) (bs : List Zone) : Prop := subAllZ (meetZ q w) bs = []

theorem zonesOf_intro (B : Box) (cs : List Cond) (Qs : List Zone) (h1 : condsOk B.length cs = true)
    (h2 : zonesOf B cs = Qs) : ZonesOf B cs Qs := ⟨h1, h2⟩
theorem notBad_intro (a : Bool) (po o : Nat) (h : bad a po o = false) : NotBad a po o := h
theorem covers_intro (q w : Zone) (bs : List Zone) (h : subAllZ (meetZ q w) bs = []) : Covers q w bs := h

theorem zonesOf_exact (B : Box) (cs : List Cond) (Qs : List Zone) (h : ZonesOf B cs Qs) (x : List Nat)
    (hx : inBox B x = true) : (∃ q ∈ Qs, inZone q x = true) ↔ allHold cs x = true := by
  rw [← h.2]; exact zonesOf_spec B cs x h.1 hx

/-! ## Assembly -/

/-- The zones of a rule before those of the rules before it. Named, so a proof states the list it means once. -/
def cat (l r : List Zone) : List Zone := l ++ r

theorem mem_cat (q : Zone) (l r : List Zone) : q ∈ cat l r ↔ q ∈ l ∨ q ∈ r := List.mem_append

/-- Every zone of `bs` is one of `pre`. -/
def AllIn (bs pre : List Zone) : Prop := ∀ q ∈ bs, q ∈ pre

theorem inHere (q : Zone) (pre : List Zone) : q ∈ q :: pre := List.Mem.head _
theorem inThere (q r : Zone) (pre : List Zone) (h : q ∈ pre) : q ∈ r :: pre := List.Mem.tail _ h
theorem inLeft (q : Zone) (l r : List Zone) (h : q ∈ l) : q ∈ cat l r := (mem_cat q l r).mpr (Or.inl h)
theorem inRight (q : Zone) (l r : List Zone) (h : q ∈ r) : q ∈ cat l r := (mem_cat q l r).mpr (Or.inr h)
theorem allIn_nil (pre : List Zone) : AllIn [] pre := fun _ h => absurd h List.not_mem_nil
theorem allIn_cons (q : Zone) (bs pre : List Zone) (h : q ∈ pre) (hs : AllIn bs pre) : AllIn (q :: bs) pre :=
  fun q' h' => by
    cases List.mem_cons.mp h' with
    | inl e => rw [e]; exact h
    | inr e => exact hs q' e

/-- No request in `w` and `q`, in no zone of `pre`, may be answered `o`. -/
def Never (B : Box) (a : Bool) (po : Nat) (w : Zone) (pre : List Zone) (q : Zone) (o : Nat) : Prop :=
  ∀ x, inBox B x = true → inZone w x = true → (∀ q' ∈ pre, inZone q' x = false) → inZone q x = true →
    bad a po o = false

theorem never_ok (B : Box) (a : Bool) (po : Nat) (w : Zone) (pre : List Zone) (q : Zone) (o : Nat)
    (h : NotBad a po o) : Never B a po w pre q o := fun _ _ _ _ _ => h

theorem never_cover (B : Box) (a : Bool) (po : Nat) (w : Zone) (pre : List Zone) (q : Zone) (o : Nat)
    (bs : List Zone) (hf : Covers q w bs) (hin : AllIn bs pre) : Never B a po w pre q o := fun x _ hw hpre hq => by
  obtain ⟨q', hq', hqx⟩ := covered_of_subAllZ _ bs hf x (inZone_meetZ q w x hq hw)
  rw [hpre q' (hin q' hq')] at hqx
  exact absurd hqx (by simp)

/-- Each zone of `qs` is answered as `Never` asks. -/
def NeverAll (B : Box) (a : Bool) (po : Nat) (w : Zone) (pre : List Zone) (qs : List Zone) (o : Nat) : Prop :=
  ∀ q ∈ qs, Never B a po w pre q o

theorem neverAll_nil (B : Box) (a : Bool) (po : Nat) (w : Zone) (pre : List Zone) (o : Nat) :
    NeverAll B a po w pre [] o := fun _ h => absurd h List.not_mem_nil
theorem neverAll_cons (B : Box) (a : Bool) (po : Nat) (w : Zone) (pre : List Zone) (q : Zone) (qs : List Zone)
    (o : Nat) (h : Never B a po w pre q o) (hs : NeverAll B a po w pre qs o) : NeverAll B a po w pre (q :: qs) o :=
  fun q' h' => by
    cases List.mem_cons.mp h' with
    | inl e => rw [e]; exact h
    | inr e => exact hs q' e

/-- From the requests of `w` in no zone of `pre`, the rules `rs` and then `d` never answer against the guarantee. -/
def Safe (B : Box) (a : Bool) (po : Nat) (d : Nat) (w : Zone) (pre : List Zone) (rs : List Rule) : Prop :=
  ∀ x, inBox B x = true → inZone w x = true → (∀ q ∈ pre, inZone q x = false) → bad a po (judge rs d x) = false

theorem safe_nil (B : Box) (a : Bool) (po : Nat) (d : Nat) (w : Zone) (pre : List Zone)
    (hn : Never B a po w pre (B, []) d) : Safe B a po d w pre [] :=
  fun x hx hw hpre => hn x hx hw hpre (by simp [inZone, hx, allDiffs])

theorem safe_cons (B : Box) (a : Bool) (po : Nat) (d : Nat) (w : Zone) (pre : List Zone)
    (c : List Cond) (o : Nat) (rs : List Rule) (qs : List Zone) (hz : ZonesOf B c qs)
    (hn : NeverAll B a po w pre qs o) (hs : Safe B a po d w (cat qs pre) rs) :
    Safe B a po d w pre (⟨c, o⟩ :: rs) := fun x hx hw hpre => by
  have hiff := zonesOf_exact B c qs hz x hx
  cases hm : allHold c x
  · have hj : judge (⟨c, o⟩ :: rs) d x = judge rs d x := by simp [judge, hm]
    rw [hj]
    refine hs x hx hw (fun q hq => ?_)
    cases (mem_cat q qs pre).mp hq with
    | inl e =>
      cases hqx : inZone q x
      · rfl
      · have := hiff.mp ⟨q, e, hqx⟩; rw [hm] at this; exact absurd this (by simp)
    | inr e => exact hpre q e
  · have hj : judge (⟨c, o⟩ :: rs) d x = o := by simp [judge, hm]
    rw [hj]
    obtain ⟨q, hq, hqx⟩ := hiff.mpr hm
    exact hn q hq x hx hw hpre hqx

/-- Every zone of the guarantee's conditions is safe over all the rules. -/
def SafeAll (B : Box) (a : Bool) (po : Nat) (d : Nat) (ws : List Zone) (rules : List Rule) : Prop :=
  ∀ w ∈ ws, Safe B a po d w [] rules

theorem safeAll_nil (B : Box) (a : Bool) (po : Nat) (d : Nat) (rules : List Rule) : SafeAll B a po d [] rules :=
  fun _ h => absurd h List.not_mem_nil
theorem safeAll_cons (B : Box) (a : Bool) (po : Nat) (d : Nat) (w : Zone) (ws : List Zone) (rules : List Rule)
    (h : Safe B a po d w [] rules) (hs : SafeAll B a po d ws rules) : SafeAll B a po d (w :: ws) rules :=
  fun w' h' => by
    cases List.mem_cons.mp h' with
    | inl e => rw [e]; exact h
    | inr e => exact hs w' e

/-- A guarantee assembled over all the rules holds on every request in the bounds. -/
theorem tab_sound (B : Box) (a : Bool) (pw : List Cond) (po : Nat) (d : Nat) (rules : List Rule) (ws : List Zone)
    (hz : ZonesOf B pw ws) (h : SafeAll B a po d ws rules) (x : List Nat) (hx : inBox B x = true) :
    breaks rules d a pw po x = false := by
  unfold breaks
  cases hw : allHold pw x
  · rfl
  · obtain ⟨w, hwm, hwx⟩ := (zonesOf_exact B pw ws hz x hx).mpr hw
    simpa using h w hwm x hx hwx (fun _ h' => absurd h' List.not_mem_nil)

end PrismLive.Tab
