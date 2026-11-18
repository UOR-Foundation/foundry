// The prover's blobs and manifest. Reads the files elaboration opened natively (one path per line on stdin, from an
// open log), maps each to where the prover's file system puts it (/lean for the toolchain, /rt for LexLean's
// runtime), and writes each blob gzip-compressed as `blobs/<hex>`, where <hex> is the BLAKE3 κ of the decoded bytes:
// the encoding is storage and transport only, never identity (spec/src/KappaBlob.lex.tex). A reader decodes, then
// re-derives κ before a byte is used. Manifest entries: { path, kappa, bytes, encoding: "gzip", encodedBytes }.
//   node make-manifest.mjs TOOLCHAIN RT DIST OUT < opened.txt
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { kappa } from "../../../../studio/shell/prism-code/src/blake3.mjs";

const [toolchain, rt, dist, out] = process.argv.slice(2);
const opened = [...new Set(readFileSync(0, "utf8").split("\n").filter(Boolean))].sort();
mkdirSync(join(out, "blobs"), { recursive: true });
// gzip at level 9; Node writes no file name and a zero time, so the same bytes give the same blob.
const place = (bytes) => {
  const k = kappa(bytes), f = join(out, "blobs", k.slice(7));
  if (!existsSync(f)) writeFileSync(f, gzipSync(bytes, { level: 9 }));
  return { kappa: k, bytes: bytes.length, encoding: "gzip", encodedBytes: statSync(f).size };
};
const files = [];
let raw = 0, encoded = 0;
for (const path of opened) {
  const at = path.startsWith(toolchain + "/") ? "/lean" + path.slice(toolchain.length)
    : path.startsWith(rt + "/") ? "/rt" + path.slice(rt.length) : null;
  if (!at || !existsSync(path)) continue;
  const entry = { path: at, ...place(readFileSync(path)) };
  raw += entry.bytes; encoded += entry.encodedBytes;
  files.push(entry);
}
const engine = {};
for (const name of ["lean-elab.mjs", "lean-elab.wasm"]) engine[name] = place(readFileSync(join(dist, name)));
writeFileSync(join(out, "manifest.json"), JSON.stringify({ schema: "lean-wasm-prover/1", lean: "4.32.2", lean_commit: "f3b06c705e6c85f5314019d5d3baab0fec5b580c", engine, files }));
const mb = (n) => (n / 1048576).toFixed(1);
console.log(`library: ${files.length} files, ${mb(raw)} MB, ${mb(encoded)} MB gzip; engine ${mb(engine["lean-elab.wasm"].bytes)} MB, ${mb(engine["lean-elab.wasm"].encodedBytes)} MB gzip`);
