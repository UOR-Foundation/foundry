import Lean
import Lean.Compiler.NameMangling
open Lean

/-! The names Lean's interpreter can ask the WebAssembly symbol table for and must find: every `extern` declaration
of Init, Std and Lean. An extern has no IR to fall back on, so a miss is an error, never a slower path. Each is
printed in both forms the interpreter tries, boxed first (`lookup_symbol` in `ir_interpreter.cpp`), with Lean's own
mangling (`getSymbolStem`, `mkMangledBoxedName`). Run natively; `gen-symtab.py` keeps the names the link defines. -/

unsafe def main : IO Unit := do
  enableInitializersExecution
  let sysroot : System.FilePath := (← IO.getEnv "LEAN_SYSROOT").getD "/"
  searchPathRef.set (← getBuiltinSearchPath sysroot)
  let env ← importModules #[{ module := `Init }, { module := `Std }, { module := `Lean }] {} (level := .private)
  for (n, _) in env.constants.toList do
    if isExtern env n then
      let stem := getSymbolStem env n
      IO.println (mkMangledBoxedName stem)
      IO.println stem
      if let some e := getExportNameFor? env n then IO.println e.toString
