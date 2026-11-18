"""The symbol table that stands in for dlsym in WebAssembly, where nothing can look a function up by name.

Lean's interpreter asks for a native function by name (`lookup_symbol_in_cur_exe`), and with
`interpreter.prefer_native` it asks for every compiled declaration it is about to run. A miss is safe for an ordinary
declaration (the interpreter runs its IR instead, more slowly) but an error for an `extern`, which has no IR.
So the table holds, derived from the build and from Lean's environment, never from a run:
  every extern of Init, Std and Lean in both forms the interpreter tries (driver/SymList.lean): correctness;
  every function the linked archive defines (its module initializers and every compiled declaration, plain and
  boxed): import-time attributes and `evalConst` find native code for anything they run, and nothing is interpreted.
With SYMTAB=log instead, the second set is the names a native run found with dlsym (the earlier, run-dependent table).
Each function is declared with its own prototype, read from the C that defines it, because WebAssembly checks the
type of every indirect call. Sorted for a binary search; a name not in the table is a miss, as dlsym's NULL is.
Usage: [SYMTAB=all|log] python3 gen-symtab.py defined-symbols.txt c-dir externs.txt dlsym-log out.c
"""
import os
import pathlib
import re
import sys

defined = {s.strip() for s in open(sys.argv[1])}
externs = {s.strip() for s in open(sys.argv[3]) if s.strip()} & defined
if os.environ.get("SYMTAB", "all") == "log":
    log = pathlib.Path(sys.argv[4])
    extra = {line.split()[0] for line in open(log) if line.strip().endswith(" 1")} if log.exists() else set()
else:
    extra = set(defined)
want = externs | (extra & defined)

proto = {}
pat = re.compile(r"^LEAN_EXPORT ([^(\n]*?)\s*\b([A-Za-z_][A-Za-z0-9_]*)\(([^)\n]*)\)\s*\{", re.M)
for c in sorted(pathlib.Path(sys.argv[2]).glob("*.c")):
    for m in pat.finditer(c.read_text(errors="replace")):
        if m.group(2) in want and m.group(2) not in proto:
            proto[m.group(2)] = (m.group(1), m.group(3))
missing = sorted(externs - set(proto))
if missing:
    sys.exit(f"no prototype for {len(missing)} externs, e.g. {missing[:5]}")
skipped = len(want - set(proto))

names = sorted(proto)
with open(sys.argv[5], "w") as out:
    out.write("#include <stdint.h>\n#include <string.h>\n#include <lean/lean.h>\n")
    for n in names:
        ret, params = proto[n]
        out.write(f"{ret} {n}({params});\n")
    out.write("struct lean_wasm_sym { const char * name; void * addr; };\n")
    out.write("static const struct lean_wasm_sym g_syms[] = {\n")
    out.write("".join(f'  {{"{n}", (void *)&{n}}},\n' for n in names))
    out.write("};\n")
    out.write(f"""void * lean_wasm_lookup_symbol(const char * name) {{
  size_t lo = 0, hi = {len(names)};
  while (lo < hi) {{
    size_t mid = (lo + hi) / 2;
    int c = strcmp(name, g_syms[mid].name);
    if (c == 0) return g_syms[mid].addr;
    if (c < 0) hi = mid; else lo = mid + 1;
  }}
  return 0;
}}
""")
print(len(names), "symbols in the table;", skipped, "defined names without a LEAN_EXPORT prototype left out")
