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
    ("imports", toJson (env.header.imports.map (toString ·.module))),
    ("replayRefused", toJson replayed), ("elabMs", t1 - t0), ("replayMs", t3 - t2), ("decls", Json.arr decls)]

/-- A stored result, checked on read: the module's own artifacts are imported from the search path, and every
constant they define is replayed into a fresh kernel environment over the module's imports. The answer has the same
shape as `one`'s, so the two can be compared declaration by declaration. -/
unsafe def checkStored (mod : String) : IO Json := do
  let modName := mod.toName
  let t0 ← msNow
  -- The kernel reads constants only, so no extension is loaded and no initializer runs. Everything is read at the
  -- private level, as elaboration reads it: the axioms a declaration rests on are collected through library proofs,
  -- and lower levels drop some of those, which would report extra axioms.
  let env ← importModules #[{ module := modName }] {} (loadExts := false)
  let some idx := env.getModuleIdx? modName
    | return Json.mkObj [("module", mod), ("elaborated", false), ("checkRefused", "module not found")]
  let imports := env.header.moduleData[idx.toNat]!.imports
  let added := env.constants.map₁.toList.filter fun (n, _) => env.getModuleIdxFor? n == some idx
  let tLoad ← msNow
  let mut decls : Array Json := #[]
  for (n, ci) in added.toArray.qsort (fun a b => a.1.lt b.1) do
    let ax ← axiomsOf env n
    decls := decls.push <| Json.mkObj [
      ("name", toString n), ("kind", kindOf ci),
      ("type", toString ci.type.hash), ("value", toString ((ci.value? (allowOpaque := true)).map (·.hash) |>.getD 0)),
      ("axioms", toJson (ax.map toString))]
  let t1 ← msNow
  let base ← importModules imports {} (level := .exported) (loadExts := false)
  let replayed ← (do let _ ← base.replay (Std.HashMap.ofList added); pure (none : Option String))
    |>.catchExceptions (fun e => pure (some (toString e)))
  let t2 ← msNow
  return Json.mkObj [("module", mod), ("elaborated", true), ("checked", true), ("declarations", decls.size),
    ("imports", toJson (imports.map (toString ·.module))),
    ("replayRefused", toJson replayed), ("loadMs", tLoad - t0), ("axiomsMs", t1 - tLoad), ("replayMs", t2 - t1),
    ("decls", Json.arr decls)]

/-- Each command's lints, paired with its syntax: `collectCommandLints` from `Lean.Elab.Frontend`, private there. -/
partial def collectCommandLints (t : Language.SnapshotTree) (cmdStx? : Option Syntax)
    (acc : Array (Option Syntax × MessageLog)) : Array (Option Syntax × MessageLog) :=
  let acc := acc.push (cmdStx?, t.element.diagnostics.msgLog)
  t.children.foldl (init := acc) fun acc child => collectCommandLints child.get (child.stx? <|> cmdStx?) acc

/-! The resident mode: one process, many requests, nothing repeated that has not changed.

A module's key is the hash of its source mixed with its imports' keys, so it changes exactly when anything in its
source closure changes. Five things are kept, all in memory for the life of the worker:
- the module's last snapshot, handed back to Lean's own incremental processing (`Language.Lean.process` with `old?`),
  which skips the import when the header is unchanged and reuses every command before the first edit;
- the import environment of the second kernel pass, keyed by the imports' keys, dropped once no module uses it;
- the second pass's verdict, reused only under the same module key;
- the declarations the second pass accepted, so after an edit only the declarations that changed, or that use one
  that changed, are checked again (`splitUnchanged`);
- the written `.olean`, rewritten only when the key changes.
The hash is Lean's 64-bit `hash`, valid for one worker's lifetime; κ (BLAKE3) replaces it once results leave it. -/

structure Resident where
  keys : Std.HashMap Name UInt64 := {}
  snaps : Std.HashMap Name (UInt64 × Language.Lean.InitialSnapshot) := {}
  bases : Std.HashMap UInt64 Environment := {}
  verdicts : Std.HashMap Name (UInt64 × Option String) := {}
  accepted : Std.HashMap Name (UInt64 × Std.HashMap Name ConstantInfo) := {}

instance : Nonempty Resident := ⟨{}⟩

/-- Lean's own unchecked insert into a kernel environment (`Kernel.Environment.add`: private, exported to C). -/
@[extern "lean_environment_add"] opaque kernelAdd (env : Kernel.Environment) (ci : ConstantInfo) : Kernel.Environment

/-- Everything the kernel reads from a declaration: kind, level parameters, type, value, safety, reducibility hints
and mutual group. An inductive's constructors and recursors are separate constants, compared on their own. -/
def sameConst (a b : ConstantInfo) : Bool :=
  kindOf a == kindOf b && a.name == b.name && a.levelParams == b.levelParams && a.type == b.type &&
  a.value? (allowOpaque := true) == b.value? (allowOpaque := true) && a.isUnsafe == b.isUnsafe &&
  a.isPartial == b.isPartial && a.all == b.all &&
  match a, b with
  | .defnInfo x, .defnInfo y => x.hints == y.hints
  | .inductInfo x, .inductInfo y => x.numParams == y.numParams && x.numIndices == y.numIndices && x.ctors == y.ctors
  | .ctorInfo x, .ctorInfo y => x.induct == y.induct && x.cidx == y.cidx && x.numParams == y.numParams && x.numFields == y.numFields
  | _, _ => true

/-- Splits a module's declarations into those whose second-pass verdict is reused and those checked again. A
declaration is reused only if it is identical to one this kernel accepted under the same imports and every module
constant it uses is itself reused. An inductive family is never split: if any part changed, all of it is checked. -/
def splitUnchanged (prev? : Option (Std.HashMap Name ConstantInfo)) (added : Std.HashMap Name ConstantInfo) :
    Std.HashMap Name ConstantInfo × Std.HashMap Name ConstantInfo := Id.run do
  let some prev := prev? | return ({}, added)
  let isInd : ConstantInfo → Bool | .inductInfo _ | .ctorInfo _ | .recInfo _ => true | _ => false
  let mut keep : NameSet := added.fold (fun s n ci => match prev[n]? with
    | some p => if sameConst p ci then s.insert n else s
    | none => s) {}
  if added.toList.any fun (n, ci) => isInd ci && !keep.contains n then
    keep := added.fold (fun s n ci => if isInd ci then s.erase n else s) keep
  let mut changed := true
  while changed do
    changed := false
    for n in keep do
      let some ci := added[n]? | continue
      if ci.getUsedConstantsAsSet.toList.any fun u => added.contains u && !keep.contains u then
        keep := keep.erase n
        changed := true
  return (added.filter fun n _ => keep.contains n, added.filter fun n _ => !keep.contains n)

def importsKey (r : Resident)(imports : Array Import) : UInt64 :=
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
  let snaps := Language.toSnapshotTree snap
  let hasErrors ← snaps.runAndReport opts false {}
  let t1 ← msNow
  let some cmdState := Language.Lean.waitForFinalCmdState? snap
    | return Json.mkObj [("module", mod), ("elaborated", false), ("elabMs", t1 - t0)]
  -- As `runFrontend` does before writing: the lints go into the `.olean`, so it is byte for byte native's.
  let env ← Linter.recordLints inputCtx.fileMap cmdState.env (collectCommandLints snaps none #[])
  if hasErrors then
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
  let addedMap := Std.HashMap.ofList added
  let prev? := (← st.get).accepted[modName]?.bind fun (k, m) => if k == iKey then some m else none
  let (keep, check) := splitUnchanged prev? addedMap
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
      -- Reused declarations go in unchecked, as this kernel accepted them; only the rest is checked on top.
      let v ← (do
          let kenv := keep.fold (fun e _ ci => kernelAdd e ci) base.toKernelEnv
          let _ ← (Environment.ofKernelEnv kenv).replay check
          pure (none : Option String))
        |>.catchExceptions (fun e => pure (some (toString e)))
      let r ← st.get
      let accepted := if v.isNone then r.accepted.insert modName (iKey, addedMap) else r.accepted.erase modName
      st.modify fun r => { r with verdicts := r.verdicts.insert modName (key, v), accepted }
      pure v
  -- Keep only the import environments some module's current snapshot still uses.
  st.modify fun r =>
    let live := r.snaps.fold (fun (s : Std.HashSet UInt64) _ (k, _) => s.insert k) {}
    { r with bases := r.bases.filter fun k _ => live.contains k }
  let t3 ← msNow
  return Json.mkObj [("module", mod), ("elaborated", true), ("declarations", decls.size),
    ("reusedSnapshot", old?.isSome), ("reusedVerdict", reusedVerdict?.isSome),
    ("rechecked", if reusedVerdict?.isSome then 0 else check.size),("replayRefused", toJson replayed),
    ("elabMs", t1 - t0), ("replayMs", t3 - t2), ("decls", Json.arr decls)]

/-- The library's root is given, not found: there is no `lean` executable to ask in a tab. -/
def setSearchPath (outDir : String) : IO Unit := do
  let sysroot : System.FilePath := (← IO.getEnv "LEAN_SYSROOT").getD "/"
  let sp ← addSearchPathFromEnv (← getBuiltinSearchPath sysroot)
  searchPathRef.set (sp ++ [(outDir : System.FilePath)])

/-- The browser worker's resident state, for the life of the tab. -/
initialize residentRef : IO.Ref Resident ← IO.mkRef {}

/-- The browser worker's entry (`wasm/elab-entry.c`): one JSON request, one JSON answer. A request is
`{"op": "elaborate", "outDir", "module", "path"}`, served by the resident worker, or `{"op": "check", "outDir",
"module"}`, a stored result checked on read. -/
@[export elab_serve] unsafe def serve (req : String) : IO String := do
  let fail (why : String) := pure (Json.mkObj [("error", why)]).compress
  let .ok j := Json.parse req | fail "the request is not JSON"
  let get (k : String) := (j.getObjValAs? String k).toOption
  let (some op, some outDir, some mod) := (get "op", get "outDir", get "module") | fail "op, outDir and module are needed"
  enableInitializersExecution
  setSearchPath outDir
  match op, get "path" with
  | "elaborate", some path => return (← resident residentRef outDir mod path).compress
  | "check", _ => return (← checkStored mod).compress
  | _, _ => fail s!"unknown request {op}"

unsafe def main (args : List String) : IO UInt32 := do
  let (isResident, isCheck, args) := match args with
    | "--resident" :: rest => (true, false, rest)
    | "--check" :: rest => (false, true, rest)
    | _ => (false, false, args)
  let st ← IO.mkRef ({} : Resident)
  let outDir :: specs := args | IO.eprintln "usage: elab [--resident | --check] OUTDIR Module=path ..."; return 2
  enableInitializersExecution
  setSearchPath outDir
  for spec in specs do
    if isCheck then IO.println (← checkStored spec).compress; continue
    let [mod, path] := spec.splitOn "=" | return 2
    let j ← if isResident then resident st outDir mod path else one outDir mod path
    IO.println j.compress
  return 0
