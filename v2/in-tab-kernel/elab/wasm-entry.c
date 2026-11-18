/*
The browser worker's entry. It does once what the driver's generated `main` does on every run (initialize Lean, the
driver's module and the task manager), and then serves requests for the life of the tab, so the resident worker's
state (driver/Elab.lean, `residentRef`) survives between them.

  elab_ready()          0 when Lean is initialized, 2 when an initializer failed.
  elab_request(json)    one request to `serve` in driver/Elab.lean; returns its JSON answer, valid until the next call.
*/
#include <lean/lean.h>
#include <emscripten.h>
#include <stdlib.h>
#include <string.h>

lean_object * initialize_elab_Elab(uint8_t builtin);
lean_object * elab_serve(lean_object * req);
void lean_initialize(void);
void lean_init_task_manager(void);
void lean_io_mark_end_initialization(void);

static int g_ready = 0;
static char * g_answer = 0;

EMSCRIPTEN_KEEPALIVE int elab_ready(void) {
  if (g_ready) return 0;
  lean_initialize();
  lean_object * res = initialize_elab_Elab(1);
  lean_io_mark_end_initialization();
  if (!lean_io_result_is_ok(res)) { lean_io_result_show_error(res); lean_dec_ref(res); return 2; }
  lean_dec_ref(res);
  lean_init_task_manager();
  g_ready = 1;
  return 0;
}

EMSCRIPTEN_KEEPALIVE const char * elab_request(const char * req) {
  free(g_answer);
  if (elab_ready() != 0) return g_answer = strdup("{\"error\":\"Lean did not initialize\"}");
  lean_object * res = elab_serve(lean_mk_string(req));
  if (lean_io_result_is_ok(res)) g_answer = strdup(lean_string_cstr(lean_io_result_get_value(res)));
  else { lean_io_result_show_error(res); g_answer = strdup("{\"error\":\"the request failed; see the console\"}"); }
  lean_dec_ref(res);
  return g_answer;
}
