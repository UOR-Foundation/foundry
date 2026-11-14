import PrismLive.Regions
open PrismLive.Kernel

/-! The studio's parking-fee example (studio/shell/prism.js, PARKING), as the proved checker reads an app: a small
app beside Verdant, to time the kernel on. Fields: hours 0 to 24, vehicle car/motorcycle/truck. Outcomes: free 0,
standard 1, premium 2. Not part of any build. -/
namespace Parking

def rules : List Rule := [
  ⟨[⟨0, 4, 0⟩], 0⟩,
  ⟨[⟨1, 4, 2⟩], 2⟩,
  ⟨[⟨0, 2, 12⟩], 2⟩]

def props : List Property := [
  ⟨false, [⟨0, 4, 0⟩], 2⟩]

def d : Nat := 1

def B : Box := [(0, 24), (0, 2)]

theorem checked : regionCheck B rules props d = true := by decide +kernel

theorem all_hold : ∀ p ∈ props, ∀ x, inBox B x = true → breaks rules d p x = false :=
  fun p hp x hx => regionCheck_sound B rules props d checked p hp x hx

end Parking

/-! The same app with a guarantee that is false: it does answer premium for a truck. The kernel must refuse it. -/
namespace ParkingFalse

def props : List Property := [
  ⟨false, [⟨1, 4, 2⟩], 2⟩]

end ParkingFalse
