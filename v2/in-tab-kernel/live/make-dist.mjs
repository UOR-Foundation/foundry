// Assembles dist-live/ (not committed): the kernel, its loader, the proved checker's library, Verdant as data, and a
// manifest that names each by its SHA-256 with the record that this kernel judged this library whole.
//   node bind-library.mjs <built dist dir> <library.ndjson> evidence/live-binding.json      (first)
//   node live/make-dist.mjs <built dist dir> <library.ndjson> <VerdantRegions.lean>
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { appOf } from "./read-app.mjs";

const [built, libraryPath, verdantPath] = process.argv.slice(2);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), out = path.join(root, "dist-live");
fs.mkdirSync(out, { recursive: true });
const sha = (b) => createHash("sha256").update(b).digest("hex");
const entry = (file, bytes) => { fs.writeFileSync(path.join(out, file), bytes); return { file, sha256: sha(bytes), bytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length }; };
const manifest = {
  lean: { version: "4.32.1", commit: "f054605aea4b840552cca2e725580bffd1e1b704" },
  glue: entry("lean-kernel.mjs", fs.readFileSync(path.join(built, "lean-kernel.mjs"))),
  wasm: entry("lean-kernel.wasm", fs.readFileSync(path.join(built, "lean-kernel.wasm"))),
  library: entry("library.ndjson", fs.readFileSync(libraryPath)),
  apps: { verdant: entry("verdant.json", Buffer.from(JSON.stringify(appOf(fs.readFileSync(verdantPath, "utf8"), "Verdant")))) },
};
// A dist is not made without the record that this kernel judged this library whole.
const binding = JSON.parse(fs.readFileSync(path.join(root, "evidence", "live-binding.json"), "utf8"));
if (binding.kernel !== manifest.wasm.sha256 || binding.loader !== manifest.glue.sha256 || binding.library !== manifest.library.sha256) throw new Error("evidence/live-binding.json is for another kernel or library: run bind-library.mjs");
manifest.binding = binding;
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
console.log(JSON.stringify(manifest, null, 1));
