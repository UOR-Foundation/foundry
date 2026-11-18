// The library a tab needs, named by κ. Reads the files elaboration opened natively (one path per line on stdin, from
// an open log), maps each to where the tab's file system puts it (/lean for the toolchain, /rt for LexLean's
// runtime), and writes the manifest: the engine's κ and, per file, its path and κ. The served copy of each file is
// `blobs/<hex>`, so any static host can serve it, and the worker re-derives every κ before Lean reads a byte.
//   node make-manifest.mjs TOOLCHAIN RT DIST OUT < opened.txt
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { kappa } from "../../../../studio/shell/prism-code/src/blake3.mjs";

const [toolchain, rt, dist, out] = process.argv.slice(2);
const opened = [...new Set(readFileSync(0, "utf8").split("\n").filter(Boolean))].sort();
mkdirSync(join(out, "blobs"), { recursive: true });
const place = (path, bytes) => { const k = kappa(bytes); const f = join(out, "blobs", k.slice(7)); if (!existsSync(f)) writeFileSync(f, bytes); return k; };
const files = [];
let total = 0;
for (const path of opened) {
  const at = path.startsWith(toolchain + "/") ? "/lean" + path.slice(toolchain.length)
    : path.startsWith(rt + "/") ? "/rt" + path.slice(rt.length) : null;
  if (!at || !existsSync(path)) continue;
  const bytes = readFileSync(path);
  total += bytes.length;
  files.push({ path: at, kappa: place(path, bytes), bytes: bytes.length });
}
const engine = {};
for (const name of ["lean-elab.mjs", "lean-elab.wasm"]) {
  const bytes = readFileSync(join(dist, name));
  engine[name] = { kappa: place(join(dist, name), bytes), bytes: bytes.length };
}
writeFileSync(join(out, "manifest.json"), JSON.stringify({ lean: "4.32.2 f3b06c705e6c85f5314019d5d3baab0fec5b580c", engine, files }));
console.log(`${files.length} files, ${(total / 1048576).toFixed(1)} MB; engine ${(engine["lean-elab.wasm"].bytes / 1048576).toFixed(1)} MB`);
