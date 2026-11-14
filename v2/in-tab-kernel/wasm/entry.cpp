/*
The WebAssembly entry of the checker. It stands where `lean_initialize` (src/initialize/init.cpp) and the `main` lake
generates stand in the native build, and initializes only what the checker links: the runtime, util, the Lean modules
the driver imports, and the C++ kernel. The elaborator, the IR interpreter and the library module are not linked, so
they are not initialized.

  check_whole(path)    judges the export file at `path` in the module's file system, every declaration.
  load_library(path)   makes the pinned library resident, admitted by its address (see `loadLibrary` in the driver).
  check_suffix(path)   judges a file that continues the resident library's, every declaration it adds.
  check_keep(path)     the same, and an accepted file stays resident for the files that follow.
Each returns 0 accepted, 1 refused, 2 failed; the verdict line goes to stdout.
*/
#include <lean/lean.h>
#include "runtime/stackinfo.h"
#include "runtime/io.h"
#include "runtime/object.h"
#include "util/init_module.h"
#include "kernel/init_module.h"
#include <emscripten.h>

extern "C" lean_object * initialize_checker_Checker(uint8_t builtin);
// The driver's entries (driver/Checker.lean): each takes a path and returns IO UInt32, 0 accepted, 1 refused.
extern "C" lean_object * checker_check_whole(lean_object * path);
extern "C" lean_object * checker_load_library(lean_object * path);
extern "C" lean_object * checker_check_suffix(lean_object * path);
extern "C" lean_object * checker_check_keep(lean_object * path);
extern "C" void lean_io_mark_end_initialization();

static bool g_ready = false;

static int ready() {
    if (g_ready) return 0;
    lean::save_stack_info();
    lean::initialize_util_module();
    lean_object * res = initialize_checker_Checker(1);
    if (!lean_io_result_is_ok(res)) { lean_io_result_show_error(res); lean_dec_ref(res); return 2; }
    lean_dec_ref(res);
    lean::initialize_kernel_module();
    lean_io_mark_end_initialization();
    g_ready = true;
    return 0;
}

extern "C" {

EMSCRIPTEN_KEEPALIVE int checker_ready() { return ready(); }

static int run(lean_object * (*entry)(lean_object *), const char * path) {
    if (int e = ready()) return e;
    lean_object * res = entry(lean_mk_string(path));
    if (lean_io_result_is_ok(res)) {
        int code = lean_unbox_uint32(lean_io_result_get_value(res));
        lean_dec_ref(res);
        return code;
    }
    lean_io_result_show_error(res);
    lean_dec_ref(res);
    return 2;
}

EMSCRIPTEN_KEEPALIVE int check_whole(const char * path) { return run(checker_check_whole, path); }
EMSCRIPTEN_KEEPALIVE int load_library(const char * path) { return run(checker_load_library, path); }
EMSCRIPTEN_KEEPALIVE int check_suffix(const char * path) { return run(checker_check_suffix, path); }
EMSCRIPTEN_KEEPALIVE int check_keep(const char * path) { return run(checker_check_keep, path); }

}
