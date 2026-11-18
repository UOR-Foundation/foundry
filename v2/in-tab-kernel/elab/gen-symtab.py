"""The symbol table that stands in for dlsym in WebAssembly, where nothing can look a function up by name.

Lean's interpreter asks for a native function by name (`lookup_symbol_in_cur_exe`), and with
`interpreter.prefer_native` it asks for every compiled declaration it is about to run. A miss is safe for an ordinary
declaration (the interpreter runs its IR instead, more slowly) but an error for an `extern`, which has no IR.
So the table holds:
  every extern of Init, Std and Lean in both forms the interpreter tries (driver/SymList.lean): correctness;
  every name the native driver found with dlsym on the corpus (dlsym log): speed, nothing else.
Each function is declared with its own prototype, read from the C that defines it, because WebAssembly checks the
type of every indirect call. Sorted for a binary search; a name not in the table is a miss, as dlsym's NULL is.
Usage: python3 gen-symtab.py defined-symbols.txt c-dir externs.txt dlsym-log out.c
"""
import pathlib
import re
import sys

defined = {s.strip() for s in open(sys.argv[1])}
want = {s.strip() for s in open(sys.argv[3]) if s.strip()}
log = pathlib.Path(sys.argv[4])
if log.exists():
    want |= {line.split()[0] for line in open(log) if line.strip().endswith(" 1")}
want &= defined

proto = {}
pat = re.compile(r"^LEAN_EXPORT ([^(\n]*?)\s*\b([A-Za-z_][A-Za-z0-9_]*)\(([^)\n]*)\)\s*\{", re.M)
for c in sorted(pathlib.Path(sys.argv[2]).glob("*.c")):
    for m in pat.finditer(c.read_text(errors="replace")):
        if m.group(2) in want and m.group(2) not in proto:
            proto[m.group(2)] = (m.group(1), m.group(3))
missing = sorted(want - set(proto))
if missing:
    sys.exit(f"no prototype for {len(missing)} names, e.g. {missing[:5]}")

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
print(len(names), "symbols in the table")
