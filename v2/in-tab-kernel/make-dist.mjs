// Assembles dist/ (not committed): the kernel, its loader, the pinned library, each input's suffix, and a manifest
// that names every file by its SHA-256 with the verdict native Lean gave (evidence/native.json).
//   node make-dist.mjs <built dist dir> <inputs dir> <library.ndjson>
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const [built, inputs, libraryPath] = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "dist");
fs.mkdirSync(out, { recursive: true });
const sha = (b) => createHash("sha256").update(b).digest("hex");
const native = JSON.parse(fs.readFileSync(path.join(here, "evidence", "native.json"), "utf8"));
const entry = (file, bytes) => { fs.writeFileSync(path.join(out, file), bytes); return { file, sha256: sha(bytes), bytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length }; };

const library = fs.readFileSync(libraryPath);
const manifest = {
  lean: { version: "4.32.2", commit: "f3b06c705e6c85f5314019d5d3baab0fec5b580c" },
  glue: entry("lean-kernel.mjs", fs.readFileSync(path.join(built, "lean-kernel.mjs"))),
  wasm: entry("lean-kernel.wasm", fs.readFileSync(path.join(built, "lean-kernel.wasm"))),
  library: entry("library.ndjson", library),
  inputs: [],
};
// The record that this kernel judged this library whole (bind-library.mjs). A dist is not made without it.
const binding = JSON.parse(fs.readFileSync(path.join(here, "evidence", "library-binding.json"), "utf8"));
if (binding.kernel !== manifest.wasm.sha256 || binding.loader !== manifest.glue.sha256 || binding.library !== manifest.library.sha256) throw new Error("evidence/library-binding.json is for another kernel or library: run bind-library.mjs");
manifest.binding = binding;
for (const f of fs.readdirSync(inputs).filter((f) => f.endsWith(".ndjson")).sort()) {
  const bytes = fs.readFileSync(path.join(inputs, f));
  const name = f.replace(/\.ndjson$/, "");
  if (!bytes.subarray(0, library.length).equals(library)) throw new Error(f + " does not begin with the library");
  const suffix = bytes.subarray(library.length);
  manifest.inputs.push({ sha256: name, file: name.slice(0, 16) + ".suffix.ndjson", suffixSha256: sha(suffix), suffixBytes: suffix.length, suffixGzipBytes: gzipSync(suffix, { level: 9 }).length, accepted: native[name].accepted });
  fs.writeFileSync(path.join(out, name.slice(0, 16) + ".suffix.ndjson"), suffix);
}
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
console.log(JSON.stringify({ glue: manifest.glue, wasm: manifest.wasm, library: manifest.library, inputs: manifest.inputs.length }, null, 1));
