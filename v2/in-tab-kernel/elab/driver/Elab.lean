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

/-! The resident mode: one process, many requests, nothing repeated that has not changed.

A module's key is the hash of its source mixed with its imports' keys, so it changes exactly when anything in its
source closure changes. Four things are kept, all in memory for the life of the worker:
- the module's last snapshot, handed back to Lean's own incremental processing (`Language.Lean.process` with `old?`),
  which skips the import when the header is unchanged and reuses every command before the first edit;
- the import environment of the second kernel pass, keyed by the imports' keys, dropped once no module uses it;
- the second pass's verdict, reused only under the same module key;
- the written `.olean`, rewritten only when the key changes.
The hash is Lean's 64-bit `hash`, valid for one worker's lifetime; κ (BLAKE3) replaces it once results leave it. -/

structure Resident where
  keys : Std.HashMap Name UInt64 := {}
  snaps : Std.HashMap Name (UInt64 × Language.Lean.InitialSnapshot) := {}
  bases : Std.HashMap UInt64 Environment := {}
  verdicts : Std.HashMap Name (UInt64 × Option String) := {}

def importsKey (r : Resident) (imports : Array Import) : UInt64 :=
  imports.foldl (fun h i => mixHash h (mixHash (hash i.module) (r.keys.getD i.module 0))) 7

unsafe def resident (st : IO.Ref Resident) (outDir mod path : String) : IO Json := do
  let input ← IO.FS.readFile path
  let modName := mod.toName
  let opts := Elab.async.set (Lean.internal.cmdlineSnapshots.set ({} : Options) false) false
  let olean : System.FilePath := outDir ++ "/" ++ (mod.replace "." "/") ++ ".olean"
  if let some dir := olean.parent then IO.FS.createDirAll dir
  let inputCtx := Parser.mkInputContext input path
  let setup stx := do
    return .ok { imports := stx.imports, isModule := stx.isModule, mainModuleName := modName, opts, trustLevel := 0 }
  let r ← st.get
  -- The old snapshot is offered only if the imports it was made against are unchanged.
  let old? := r.snaps[modName]?.bind fun (k, s) =>
    match s.processedResult.get with
    | some p => if importsKey r p.cmdState.env.header.imports == k then some s else none
    | _ => none
  let t0 ← msNow
  enableInitializersExecution  -- each import resets it
  let snap ← Language.Lean.process setup old? { inputCtx with }
  let _ ← (Language.toSnapshotTree snap).runAndReport opts false {}
  let t1 ← msNow
  let some cmdState := Language.Lean.waitForFinalCmdState? snap
    | return Json.mkObj [("module", mod), ("elaborated", false), ("elabMs", t1 - t0)]
  let env := cmdState.env
  if cmdState.messages.hasErrors then
    return Json.mkObj [("module", mod), ("elaborated", false), ("elabMs", t1 - t0)]
  let iKey := importsKey r env.header.imports
  let key := mixHash (hash input) iKey
  if r.keys[modName]? != some key then
    writeModule (writeIR := !Compiler.compiler.postponeCompile.get cmdState.scopes[0]!.opts) env olean
  st.modify fun r => { r with keys := r.keys.insert modName key, snaps := r.snaps.insert modName (iKey, snap) }
  let added := env.constants.map₂.toList
  let mut decls : Array Json := #[]
  for (n, ci) in added.toArray.qsort (fun a b => a.1.lt b.1) do
    let ax ← axiomsOf env n
    decls := decls.push <| Json.mkObj [
      ("name", toString n), ("kind", kindOf ci),
      ("type", toString ci.type.hash), ("value", toString ((ci.value? (allowOpaque := true)).map (·.hash) |>.getD 0)),
      ("axioms", toJson (ax.map toString))]
  -- The second kernel pass, over an import environment kept per imports key. Its verdict is reused only for the
  -- same module key: the same source closure, checked by the same kernel in this same worker.
  let t2 ← msNow
  let reusedVerdict? := (← st.get).verdicts[modName]?.bind fun (k, v) => if k == key then some v else none
  let replayed ← match reusedVerdict? with
    | some v => pure v
    | none => do
      let base ← match (← st.get).bases[iKey]? with
        | some b => pure b
        | none => do
          enableInitializersExecution
          let b ← importModules env.header.imports {} (level := .exported) (loadExts := true)
          st.modify fun r => { r with bases := r.bases.insert iKey b }
          pure b
      let v ← (do let _ ← base.replay (Std.HashMap.ofList added); pure (none : Option String))
        |>.catchExceptions (fun e => pure (some (toString e)))
      st.modify fun r => { r with verdicts := r.verdicts.insert modName (key, v) }
      pure v
  -- Keep only the import environments some module's current snapshot still uses.
  st.modify fun r =>
    let live := r.snaps.fold (fun (s : Std.HashSet UInt64) _ (k, _) => s.insert k) {}
    { r with bases := r.bases.filter fun k _ => live.contains k }
  let t3 ← msNow
  return Json.mkObj [("module", mod), ("elaborated", true), ("declarations", decls.size),
    ("reusedSnapshot", old?.isSome), ("reusedVerdict", reusedVerdict?.isSome), ("replayRefused", toJson replayed),
    ("elabMs", t1 - t0), ("replayMs", t3 - t2), ("decls", Json.arr decls)]

unsafe def main (args : List String) : IO UInt32 := do
  let (isResident, args) := match args with
    | "--resident" :: rest => (true, rest)
    | _ => (false, args)
  let st ← IO.mkRef ({} : Resident)
  let outDir :: specs := args | IO.eprintln "usage: elab [--resident] OUTDIR Module=path ..."; return 2
  enableInitializersExecution
  -- The library's root is given, not found: there is no `lean` executable to ask in a tab.
  let sysroot : System.FilePath := (← IO.getEnv "LEAN_SYSROOT").getD "/"
  let sp ← addSearchPathFromEnv (← getBuiltinSearchPath sysroot)
  searchPathRef.set (sp ++ [(outDir : System.FilePath)])
  for spec in specs do
    let [mod, path] := spec.splitOn "=" | return 2
    let j ← if isResident then resident st outDir mod path else one outDir mod path
    IO.println j.compress
  return 0
