// Under Node, the driver reads the library root and search path from the host's environment, which Emscripten does
// not pass through by itself.
Module.preRun = Module.preRun || [];
Module.preRun.push(() => {
  for (const k of ["LEAN_SYSROOT", "LEAN_PATH"]) if (process.env[k]) ENV[k] = process.env[k];
});
