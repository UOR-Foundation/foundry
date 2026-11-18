"""Makes Lean 4.32.2's C++ definitions match the C its own compiler emits for the same externs.

Native x86-64 tolerates a call with one argument more or fewer; WebAssembly does not (wasm-ld turns the call into a
trap). In every case the generated C, the caller, is the reference: the C++ drops the world argument the C no longer
passes, takes the unit argument the C passes, or returns the type the C expects. Three TCP functions newer than the
Emscripten stubs get stubs like their neighbours. Nothing here changes behaviour on a native build.
Usage: python3 make-abi-patch.py path/to/lean4/src
"""
import pathlib
import sys

src = pathlib.Path(sys.argv[1])


def swap(rel, old, new):
    p = src / rel
    t = p.read_text()
    assert t.count(old) == 1, (rel, old[:60])
    p.write_text(t.replace(old, new))


swap("library/ir_interpreter.cpp",
     "lean_run_init(object * env, object * opts, object * decl, object * init_decl, object *) {",
     "lean_run_init(object * env, object * opts, object * decl, object * init_decl) {")
swap("kernel/environment.cpp",
     'extern "C" uint8* lean_kernel_diag_is_enabled(object*);',
     'extern "C" uint8 lean_kernel_diag_is_enabled(object*);')
swap("runtime/io.cpp",
     "lean_io_create_tempfile(lean_object * /* w */) {", "lean_io_create_tempfile() {")
swap("runtime/io.cpp",
     "lean_io_create_tempdir(lean_object * /* w */) {", "lean_io_create_tempdir() {")
swap("library/module.cpp",
     "uint8 allow_closures_u8, object *) {", "uint8 allow_closures_u8) {")
swap("library/module.cpp",
     "lean_compacted_region_read(b_obj_arg ofname, b_obj_arg odep_regions, object *) {",
     "lean_compacted_region_read(b_obj_arg ofname, b_obj_arg odep_regions) {")
swap("library/module.cpp",
     "lean_compacted_region_free(obj_arg region, object *) {",
     "lean_compacted_region_free(obj_arg region) {")
swap("runtime/memory.cpp",
     "lean_internal_get_default_max_memory() {", "lean_internal_get_default_max_memory(lean_object *) {")
swap("runtime/interrupt.cpp",
     "lean_internal_get_default_max_heartbeat() {", "lean_internal_get_default_max_heartbeat(lean_object *) {")
swap("library/llvm.cpp",
     "lean_object *llvm_is_declaration(size_t ctx, size_t global) {",
     "uint8_t llvm_is_declaration(size_t ctx, size_t global) {")

# lean.h takes Emscripten to mean 32-bit pointers and splits each 64-bit scalar literal (the precomputed hash of a
# static Name) across two pointer slots. Under 64-bit WebAssembly that corrupts every static Name, and lookups miss.
swap("include/lean/lean.h",
     "#ifdef LEAN_EMSCRIPTEN\n#define LEAN_SCALAR_PTR_LITERAL",
     "#if defined(LEAN_EMSCRIPTEN) && UINTPTR_MAX == 0xffffffff\n#define LEAN_SCALAR_PTR_LITERAL")

# No dlsym in WebAssembly: the interpreter asks a table generated at link time (../gen-symtab.py) instead.
swap("library/ir_interpreter.cpp",
     "#else\n    return dlsym(RTLD_DEFAULT, sym);\n#endif",
     "#elif defined(LEAN_EMSCRIPTEN)\n    return lean_wasm_lookup_symbol(sym);\n#else\n    return dlsym(RTLD_DEFAULT, sym);\n#endif")
swap("library/ir_interpreter.cpp",
     "void * lookup_symbol_in_cur_exe(char const * sym) {",
     '#ifdef LEAN_EMSCRIPTEN\nextern "C" void * lean_wasm_lookup_symbol(char const * sym);\n#endif\nvoid * lookup_symbol_in_cur_exe(char const * sym) {')

# WebAssembly has no loaded shared libraries: the whole program is one module, at address 0.
swap("runtime/compact.cpp",
     "#else\n    // Linux: use dl_iterate_phdr",
     '#elif defined(LEAN_EMSCRIPTEN)\n    libs.push_back({0, ""});\n#else\n    // Linux: use dl_iterate_phdr')

stub = '''
extern "C" LEAN_EXPORT lean_obj_res {name}(b_obj_arg socket) {{
    lean_always_assert(
        false && ("Please build a version of Lean4 with libuv to invoke this.")
    );
}}
'''
for file, first, names in [
        ("tcp", "lean_uv_tcp_new", ["lean_uv_tcp_wait_readable", "lean_uv_tcp_cancel_recv", "lean_uv_tcp_try_accept"]),
        ("udp", "lean_uv_udp_new", ["lean_uv_udp_wait_readable", "lean_uv_udp_cancel_recv"])]:
    p = src / f"runtime/uv/{file}.cpp"
    t = p.read_text()
    marker = f'extern "C" LEAN_EXPORT lean_obj_res {first}() {{\n    lean_always_assert('
    assert t.count(marker) == 1, file
    t = t.replace(marker, "".join(stub.format(name=n) for n in names) + "\n" + marker)
    p.write_text(t)
