import Lean
open Lean Elab

/-! The spike's driver, the same source native and as WebAssembly. For each `Module=path` it elaborates the file with
Lean's own frontend, writes the module's `.olean` so later modules can import it, then sends every declaration the
module added to a second, fresh kernel environment (`Environment.replay`). It prints one JSON line per module: the
messages, each declaration's kind and structural hashes, its axioms, and the timings. Native and WebAssembly agree
when these lines are equal. -/

def kindOf : ConstantInfo → String
  | .axiomInfo _ => "axiom" | .defnInfo _ => "def" | .thmInfo _ => "theorem" | .opaqueInfo _ => "opaque"
  | .quotInfo _ => "quot" | .inductInfo _ => "inductive" | .ctorInfo _ => "ctor" | .recInfo _ => "rec"

def msNow : IO Nat := return (← IO.monoNanosNow) / 1000000

def axiomsOf (env : Environment) (n : Name) : IO (Array Name) := do
  let ctx : Core.Context := { fileName := "", fileMap := default }
  let (r, _) ← (collectAxioms n : CoreM _).toIO ctx { env }
  return r.qsort Name.lt

unsafe def one (outDir mod path : String) : IO Json := do
  let input ← IO.FS.readFile path
  let opts := Elab.async.set ({} : Options) false
  let modName := mod.toName
  let olean : System.FilePath := outDir ++ "/" ++ (mod.replace "." "/") ++ ".olean"
  if let some dir := olean.parent then IO.FS.createDirAll dir
  enableInitializersExecution
  let t0 ← msNow
  let env? ← runFrontend input opts path modName (oleanFileName? := some olean)
  let t1 ← msNow
  let some env := env? | return Json.mkObj [("module", mod), ("elaborated", false), ("elabMs", t1 - t0)]
  -- What the module added: the constants of its own stage, not the imported ones.
  let added := env.constants.map₂.toList
  let mut decls : Array Json := #[]
  for (n, ci) in added.toArray.qsort (fun a b => a.1.lt b.1) do
    let ax ← axiomsOf env n
    decls := decls.push <| Json.mkObj [
      ("name", toString n), ("kind", kindOf ci),
      ("type", toString ci.type.hash), ("value", toString ((ci.value? (allowOpaque := true)).map (·.hash) |>.getD 0)),
      ("axioms", toJson (ax.map toString))]
  -- A second kernel pass, over the imports alone.
  let t2 ← msNow
  enableInitializersExecution  -- each import resets it
  let base ← importModules (env.header.imports) {} (level := .exported) (loadExts := true)
  let replayed ← (do let _ ← base.replay (Std.HashMap.ofList added); pure (none : Option String))
    |>.catchExceptions (fun e => pure (some (toString e)))
  let t3 ← msNow
  return Json.mkObj [("module", mod), ("elaborated", true), ("declarations", decls.size),
    ("replayRefused", toJson replayed), ("elabMs", t1 - t0), ("replayMs", t3 - t2), ("decls", Json.arr decls)]

unsafe def main (args : List String) : IO UInt32 := do
  let outDir :: specs := args | IO.eprintln "usage: elab OUTDIR Module=path ..."; return 2
  enableInitializersExecution
  -- The library's root is given, not found: there is no `lean` executable to ask in a tab.
  let sysroot : System.FilePath := (← IO.getEnv "LEAN_SYSROOT").getD "/"
  let sp ← addSearchPathFromEnv (← getBuiltinSearchPath sysroot)
  searchPathRef.set (sp ++ [(outDir : System.FilePath)])
  for spec in specs do
    let [mod, path] := spec.splitOn "=" | return 2
    let j ← one outDir mod path
    IO.println j.compress
  return 0
