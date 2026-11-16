// Keep the shell on the newest prism-code, without giving up the pin.
//
// The shell carries prism-code's journey and browser files byte for byte at one version
// (tools/prism_journey.mjs), and three tools name that version. This re-pins all three to the
// version npm calls `latest`, copies the files at it, and holds the result to what a re-pin must
// keep true: every file is that version's, and every import the copied files make resolves inside
// the shell, so a file a new version started to import is noticed here and not in a browser.
//
//   node tools/prism_code_update.mjs            re-pin to npm's latest, if it is newer
//   node tools/prism_code_update.mjs --check    say whether the pin is behind; exit 1 if it is
//   node tools/prism_code_update.mjs 0.9.2      re-pin to this version
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PINS = ["tools/prism_journey.mjs", "tools/kernel.mjs", "tools/prism_template.mjs"];
const PIN = /^const PRISM_CODE = "(\d+\.\d+\.\d+)";$/m;
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, encoding: "utf8", shell: process.platform === "win32", ...options });

const pinned = PINS.map((file) => {
  const found = PIN.exec(read(file));
  if (!found) throw new Error(`${file} names no prism-code version`);
  return found[1];
});
if (new Set(pinned).size !== 1) throw new Error(`the tools disagree on the prism-code version: ${PINS.map((f, i) => `${f} ${pinned[i]}`).join(", ")}`);
const current = pinned[0];
const wanted = /^\d+\.\d+\.\d+$/.test(process.argv[2] ?? "") ? process.argv[2] : run("npm", ["view", "prism-code", "version"]).trim();
if (!/^\d+\.\d+\.\d+$/.test(wanted)) throw new Error(`npm names no release of prism-code: ${wanted}`);
const older = (a, b) => a.split(".").map(Number).reduce((r, n, i) => r || n - Number(b.split(".")[i]), 0) < 0;

if (process.argv[2] === "--check") {
  console.log(older(current, wanted) ? `prism-code: pinned ${current}, npm has ${wanted}` : `prism-code: ${current} is the latest`);
  process.exit(older(current, wanted) ? 1 : 0);
}
if (!older(current, wanted)) {
  console.log(`prism-code: ${current} is the latest; nothing to do`);
  process.exit(0);
}
for (const file of PINS) fs.writeFileSync(path.join(root, file), read(file).replace(PIN, `const PRISM_CODE = "${wanted}";`));
run(process.execPath, ["tools/prism_journey.mjs"], { stdio: "inherit", shell: false });
run(process.execPath, ["tools/prism_journey.mjs", "--check"], { stdio: "inherit", shell: false });

// A new version may import a file the copy list does not name yet. The imports already unresolved
// before the re-pin are Node's branch of index.mjs, which no browser takes; anything else is new.
const KNOWN = new Set(["volumes.mjs", "session.mjs", "networks.mjs", "system.mjs", "verify-namespace.mjs", "errors-namespace.mjs", "node.mjs", "images-namespace.mjs"]);
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".mjs") ? [path.join(dir, e.name)] : []));
const missing = [];
for (const dir of ["shell/prism-code/src", "shell/prism"]) {
  for (const file of walk(path.join(root, dir))) {
    for (const found of fs.readFileSync(file, "utf8").matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) {
      const name = found[1];
      const where = path.relative(root, file).split(path.sep).join("/");
      if (name.startsWith("node:") && dir === "shell/prism") missing.push(`${where} imports ${name}: add its substitution to SUBSTITUTE in tools/prism_journey.mjs`);
      else if (name.startsWith(".") && !fs.existsSync(path.join(path.dirname(file), name)) && !(dir === "shell/prism-code/src" && KNOWN.has(path.basename(name)))) {
        missing.push(`${where} imports ${name}: add it to FILES in tools/prism_journey.mjs`);
      }
    }
  }
}
if (missing.length) {
  console.error(`prism-code ${wanted} needs files the shell does not carry:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}
console.log(`prism-code: re-pinned ${current} -> ${wanted}; every copied file's imports resolve inside the shell`);
