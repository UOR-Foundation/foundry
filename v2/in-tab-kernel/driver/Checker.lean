/-
Lean 4.32.1's own kernel over a lean4export file, with nothing of Lean but what the kernel needs.

The replay is `Lean.Environment.replay` (src/Lean/Replay.lean at v4.32.1, Apache-2.0, Kim Morrison), unchanged in what
it sends to the kernel. It differs only in imports: it holds a `Kernel.Environment` and names a refusal by its kind
and constant, so it needs `Lean.Environment` and not `Lean.CoreM`, the elaborator's monad, whose closure is most of
Lean. Every declaration is judged by `Kernel.Environment.addDeclCore`, which is `lean_add_decl`, the C++ kernel.
-/
import Export.Parse
import Lean.Environment
import Lean.Util.FoldConsts

open Lean

namespace Checker

structure Context where
  newConstants : Std.HashMap Name ConstantInfo
  /-- False only for the pinned library, admitted by its address: see `loadLibrary`. -/
  check : Bool := true

structure State where
  env : Kernel.Environment
  remaining : NameSet := {}
  pending : NameSet := {}
  postponedConstructors : NameSet := {}
  postponedRecursors : NameSet := {}
  added : Nat := 0

abbrev M := ReaderT Context <| StateRefT State IO

def isTodo (name : Name) : M Bool := do
  let r := (← get).remaining
  if r.contains name then
    modify fun s => { s with remaining := s.remaining.erase name, pending := s.pending.insert name }
    return true
  else
    return false

/-- The kernel's refusal, by kind and constant. Pretty-printing terms needs the elaborator's printer. -/
def describe : Kernel.Exception → String
  | .unknownConstant _ n => s!"(kernel) unknown constant '{n}'"
  | .alreadyDeclared _ n => s!"(kernel) constant has already been declared '{n}'"
  | .declTypeMismatch .. => "(kernel) declaration type mismatch"
  | .declHasMVars _ n _ => s!"(kernel) declaration has metavariables '{n}'"
  | .declHasFVars _ n _ => s!"(kernel) declaration has free variables '{n}'"
  | .funExpected .. => "(kernel) function expected"
  | .typeExpected .. => "(kernel) type expected"
  | .letTypeMismatch .. => "(kernel) let-declaration type mismatch"
  | .exprTypeMismatch .. => "(kernel) type mismatch"
  | .appTypeMismatch .. => "(kernel) application type mismatch"
  | .invalidProj .. => "(kernel) invalid projection"
  | .thmTypeIsNotProp _ n _ => s!"(kernel) type of theorem '{n}' is not a proposition"
  | .other msg => s!"(kernel) {msg}"
  | .deterministicTimeout => "(kernel) deterministic timeout"
  | .excessiveMemory => "(kernel) excessive memory consumption detected"
  | .deepRecursion => "(kernel) deep recursion detected"
  | .interrupted => "(kernel) interrupted"

def addDecl (d : Declaration) : M Unit := do
  let env := (← get).env
  let r : Except Kernel.Exception Kernel.Environment :=
    if (← read).check then env.addDeclCore 0 d (cancelTk? := none) else env.addDeclWithoutChecking d
  match r with
  | .ok env => modify fun s => { s with env := env, added := s.added + 1 }
  | .error ex => throw <| .userError (describe ex)

mutual
partial def replayConstant (name : Name) : M Unit := do
  if ← isTodo name then
    let some ci := (← read).newConstants[name]? | unreachable!
    replayConstants ci.getUsedConstantsAsSet
    if (← get).pending.contains name then
      try
        match ci with
        | .defnInfo   info => addDecl (Declaration.defnDecl info)
        | .thmInfo    info =>
          if let some (.thmInfo info') := (← get).env.find? ci.name then
            if info.name == info'.name &&
              info.type == info'.type &&
              info.levelParams == info'.levelParams &&
              info.all == info'.all
            then
              return
          addDecl (Declaration.thmDecl info)
        | .axiomInfo  info => addDecl (Declaration.axiomDecl info)
        | .opaqueInfo info => addDecl (Declaration.opaqueDecl info)
        | .inductInfo info =>
          let lparams := info.levelParams
          let nparams := info.numParams
          let all ← info.all.mapM fun n => do pure <| ((← read).newConstants[n]!)
          for o in all do
            modify fun s =>
              { s with remaining := s.remaining.erase o.name, pending := s.pending.erase o.name }
          let ctorInfo ← all.mapM fun ci => do
            pure (ci, ← ci.inductiveVal!.ctors.mapM fun n => do
              pure ((← read).newConstants[n]!))
          for (_, ctors) in ctorInfo do
            for ctor in ctors do
              replayConstants ctor.getUsedConstantsAsSet
          let types : List InductiveType := ctorInfo.map fun ⟨ci, ctors⟩ =>
            { name := ci.name
              type := ci.type
              ctors := ctors.map fun ci => { name := ci.name, type := ci.type } }
          addDecl (Declaration.inductDecl lparams nparams types false)
        | .ctorInfo info =>
          modify fun s => { s with postponedConstructors := s.postponedConstructors.insert info.name }
        | .recInfo info =>
          modify fun s => { s with postponedRecursors := s.postponedRecursors.insert info.name }
        | .quotInfo _ =>
          replayConstant `Eq
          addDecl (Declaration.quotDecl)
        modify fun s => { s with pending := s.pending.erase name }
      catch ex =>
        throw <| .userError s!"while replaying declaration '{name}':\n{ex}"

partial def replayConstants (names : NameSet) : M Unit := do
  for n in names do replayConstant n
end

def checkPostponedConstructors : M Unit := do
  for ctor in (← get).postponedConstructors do
    match (← get).env.find? ctor, (← read).newConstants[ctor]? with
    | some (.ctorInfo info), some (.ctorInfo info') =>
      if ! (info == info') then throw <| IO.userError s!"Invalid constructor {ctor}"
    | _, _ => throw <| IO.userError s!"No such constructor {ctor}"

def checkPostponedRecursors : M Unit := do
  for ctor in (← get).postponedRecursors do
    match (← get).env.find? ctor, (← read).newConstants[ctor]? with
    | some (.recInfo info), some (.recInfo info') =>
      if ! (info == info') then throw <| IO.userError s!"Invalid recursor {ctor}"
    | _, _ => throw <| IO.userError s!"No such recursor {ctor}"

/-- Replays `newConstants` into `env`; returns the environment and how many declarations the kernel judged. -/
def replay (newConstants : Std.HashMap Name ConstantInfo) (env : Kernel.Environment) (check := true) :
    IO (Kernel.Environment × Nat) := do
  let mut remaining : NameSet := ∅
  for (n, ci) in newConstants.toList do
    if !ci.isUnsafe && !ci.isPartial then
      remaining := remaining.insert n
  let (_, s) ← StateRefT'.run (s := { env, remaining }) do
    ReaderT.run (r := { newConstants, check }) do
      for n in remaining do
        replayConstant n
      checkPostponedConstructors
      checkPostponedRecursors
  return (s.env, s.added)

/-- The kernel adds Quot.mk, Quot.lift and Quot.ind together with Quot; adding them again is an error. -/
def withoutQuotParts (m : Std.HashMap Name ConstantInfo) : Std.HashMap Name ConstantInfo :=
  m.erase `Quot.mk |>.erase `Quot.lift |>.erase `Quot.ind

/-- Judges a whole export file: every declaration goes to the kernel. -/
def checkWhole (path : String) : IO String := do
  let handle ← IO.FS.Handle.mk path .read
  let exported ← Export.parseStream (.ofHandle handle)
  let env := (← Lean.mkEmptyEnvironment).toKernelEnv
  let constMap := withoutQuotParts exported.constMap
  let (_, judged) ← replay constMap env
  return s!"Accepted {constMap.size} declarations ({judged} sent to the kernel)."

/--
The pinned library, held between checks: the reader's tables, so a suffix can continue the file, and the environment
with every library declaration in it.
-/
structure Resident where
  reader : Export.Parse.State
  env : Kernel.Environment

initialize resident : IO.Ref (Option Resident) ← IO.mkRef none

/-- What each library constant met so far rests on. Emptied when a library is made resident. -/
initialize axiomCache : IO.Ref (Std.HashMap Name NameSet) ← IO.mkRef {}

/--
Reads the library and enters its declarations without type checking them (`addDeclWithoutChecking`, the kernel's own
entry; inductive types are still checked, the kernel has no other way to add them). This is sound only for bytes this
same kernel has already judged whole with `checkWhole`: the caller admits the library by its address, and that address
is recorded with the kernel's when the library is checked at build time.
-/
def loadLibrary (path : String) : IO String := do
  let t0 ← IO.monoMsNow
  let handle ← IO.FS.Handle.mk path .read
  let (_, reader) ← Export.Parse.M.run Export.Parse.parseFile (.ofHandle handle)
  let t1 ← IO.monoMsNow
  let env := (← Lean.mkEmptyEnvironment).toKernelEnv
  let (env, _) ← replay (withoutQuotParts reader.constMap) env (check := false)
  let t2 ← IO.monoMsNow
  resident.set (some { reader, env })
  axiomCache.set {}
  return s!"Library resident: {reader.constMap.size} declarations (read {t1 - t0} ms, entered {t2 - t1} ms)."

/--
Every axiom a constant rests on, through everything it refers to, read from the kernel's environment after the
kernel accepted it. The kernel itself admits any declared axiom, so this is what an audit compares with the axioms a
theorem declares. Answers are kept by constant, so what the library's constants rest on is worked out once.
-/
partial def axiomsOf (env : Kernel.Environment) (n : Name) : StateM (Std.HashMap Name NameSet) NameSet := do
  if let some known := (← get)[n]? then return known
  -- The environment has no cycles; the entry made first only keeps a malformed one from looping.
  modify (·.insert n {})
  let mut found : NameSet := {}
  if let some ci := env.find? n then
    if ci matches .axiomInfo _ then found := found.insert n
    for c in ci.getUsedConstantsAsSet do
      for a in (← axiomsOf env c) do
        found := found.insert a
  modify (·.insert n found)
  return found

/--
Judges a suffix that continues the resident file: every declaration it adds goes to the kernel. With `keep`, an
accepted suffix stays resident: its declarations are in the environment, and its terms in the reader's tables, for
the suffixes that follow. Nothing refused is ever kept.
-/
def checkSuffix (path : String) (keep : Bool := false) : IO String := do
  let some r ← resident.get | throw <| .userError "no library is resident"
  let handle ← IO.FS.Handle.mk path .read
  let (_, reader) ← StateT.run Export.Parse.parseItems { r.reader with stream := .ofHandle handle }
  let mut added : Std.HashMap Name ConstantInfo := {}
  for n in reader.constOrder.extract r.reader.constOrder.size reader.constOrder.size do
    added := added.insert n reader.constMap[n]!
  let (env, judged) ← replay (withoutQuotParts added) r.env
  -- One line per theorem the suffix adds, in the suffix's order, before the verdict line.
  let mut cache ← axiomCache.get
  for n in reader.constOrder.extract r.reader.constOrder.size reader.constOrder.size do
    if let some (.thmInfo _) := added[n]? then
      let (found, next) := (axiomsOf env n).run cache
      cache := next
      let names := (found.toList.map toString).toArray.qsort (· < ·)
      IO.println s!"axioms {n}: {", ".intercalate names.toList}"
  -- Only what stays resident is the same at the next check.
  if keep then
    resident.set (some { reader, env })
    axiomCache.set cache
  else
    axiomCache.set (cache.filter fun n _ => r.reader.constMap.contains n)
  return s!"Accepted {added.size} declarations over the resident library ({judged} sent to the kernel){if keep then ", kept" else ""}."

def report (act : IO String) : IO UInt32 := do
  try
    IO.println (← act)
    return 0
  catch ex =>
    IO.println s!"Refused: {ex}"
    return 1

@[export checker_check_whole] def checkWholeEntry (path : String) : IO UInt32 := report (checkWhole path)
@[export checker_load_library] def loadLibraryEntry (path : String) : IO UInt32 := report (loadLibrary path)
@[export checker_check_suffix] def checkSuffixEntry (path : String) : IO UInt32 := report (checkSuffix path)
@[export checker_check_keep] def checkKeepEntry (path : String) : IO UInt32 := report (checkSuffix path (keep := true))

end Checker

def main (args : List String) : IO UInt32 := do
  match args with
  | [whole] => Checker.checkWholeEntry whole
  | [library, suffix] => do
    let r ← Checker.loadLibraryEntry library
    if r != 0 then return r
    Checker.checkSuffixEntry suffix
  | _ => throw <| .userError "usage: checker <export.ndjson> | checker <library.ndjson> <suffix.ndjson>"
