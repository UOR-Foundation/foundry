module
public import Init
set_option autoImplicit false
namespace Spike.Tactics

@[expose] public def clamp (lo hi x : Nat) : Nat := if x < lo then lo else if hi < x then hi else x

@[expose] public def total : List Nat → Nat
  | [] => 0
  | x :: xs => x + total xs

public theorem clamp_le (lo hi x : Nat) (h : lo ≤ hi) : clamp lo hi x ≤ hi := by
  unfold clamp
  split <;> (try split) <;> omega

public theorem clamp_ge (lo hi x : Nat) (h : lo ≤ hi) : lo ≤ clamp lo hi x := by
  simp only [clamp]
  split
  · omega
  · split <;> omega

public theorem total_append (xs ys : List Nat) : total (xs ++ ys) = total xs + total ys := by
  induction xs with
  | nil => simp [total]
  | cons x xs ih => simp [total, ih]; omega

public theorem small : (List.range 20).foldl (· + ·) 0 = 190 := by decide

public theorem leap_2000 : (2000 % 4 == 0 && 2000 % 100 != 0) || 2000 % 400 == 0 := by decide

end Spike.Tactics
