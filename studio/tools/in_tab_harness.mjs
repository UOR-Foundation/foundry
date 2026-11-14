// What the in-tab proof suites share: the Forge kernel guest the studio ships, asked as shell/kernel.js asks it,
// and the worker's protocol over the shell's real Lean kernel, without its storage. Nothing here stands in for
// either kernel. `lie` changes what the worker reports, to plant a fault.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { statementAddress } from '../shell/in-tab/spec-app.mjs';
import { proveInTab, closeInTabProof } from '../shell/in-tab/client.mjs';
import { prover } from '../shell/in-tab/prove.mjs';

export const at = (p) => new URL(p, import.meta.url);
export const bytesOf = (p) => fs.readFileSync(at(p));
export const sha = (b) => createHash('sha256').update(b).digest('hex');
export const manifest = JSON.parse(bytesOf('../shell/in-tab/manifest.json'));

const guestModule = await WebAssembly.compile(bytesOf('../shell/kernel/guest.wasm'));
export const guest = { dispatch: async (request) => {
  const { memory, holo_alloc, holo_run } = (await WebAssembly.instantiate(guestModule, {})).exports, where = holo_alloc(request.length);
  new Uint8Array(memory.buffer, where, request.length).set(request);
  const packed = BigInt.asUintN(64, BigInt(holo_run(where, request.length)));
  return new Uint8Array(memory.buffer, Number(packed >> 32n), Number(packed & 0xffffffffn)).slice();
} };

const factory = (await import(at('../shell/in-tab/lean-kernel.mjs').href)).default;
export function nodeWorker(lie = {}) {
  const listeners = new Set(), post = (data) => queueMicrotask(() => listeners.forEach((on) => on({ data })));
  let kernel = null, proving = null, addresses = null;
  const handed = [], lines = [];
  const call = (entry, text) => {
    handed.push(text); lines.length = 0; kernel.FS.writeFile('/in.ndjson', text);
    const t = performance.now(), exit = kernel.ccall(entry, 'number', ['string'], ['/in.ndjson']), ms = performance.now() - t;
    kernel.FS.unlink('/in.ndjson');
    const axioms = {};
    for (const line of lines) { const x = /^axioms ([^:]+): ?(.*)$/.exec(line); if (x) axioms[x[1]] = x[2] ? x[2].split(', ') : []; }
    return { exit, ms, axioms: exit === 0 ? axioms : {}, output: lines[lines.length - 1] ?? '' };
  };
  return { terminate() {}, addEventListener: (_, on) => listeners.add(on), removeEventListener: (_, on) => listeners.delete(on), async postMessage(message) {
    if (message.op === 'open') {
      if (!message.library) return post({ op: 'open', ok: false, need: 'library' });
      const wasm = new Uint8Array(message.wasm), library = new Uint8Array(message.library);
      addresses = { kernel: sha(wasm), library: sha(library) };
      kernel = await factory({ instantiateWasm: (imports, done) => { WebAssembly.instantiate(wasm, imports).then((r) => done(r.instance, r.module)); return {}; }, print: (s) => lines.push(s), printErr: (s) => lines.push(s) });
      assert.equal(kernel.ccall('checker_ready', 'number', [], []), 0);
      kernel.FS.writeFile('/in.ndjson', library); assert.equal(kernel.ccall('load_library', 'number', ['string'], ['/in.ndjson']), 0); kernel.FS.unlink('/in.ndjson');
      proving = prover(call, new TextDecoder().decode(library));
      post({ op: 'open', ok: true, via: 'library', ...addresses });
      return post({ op: 'kept', ok: true });
    }
    handed.length = 0;
    const app = lie.app ? lie.app(message.app) : message.app, r = proving.prove(app);
    const evidence = { ...addresses, statement: statementAddress(app), bundle: sha(Buffer.from(handed.join('\n'))), ...(lie.evidence || {}) };
    if (lie.axioms) for (const g of r.guarantees) if (g.accepted) g.axioms = lie.axioms;
    post({ id: message.id, ...r, evidence, residentFacts: proving.resident.size });
  } };
}
export const shell = (lie) => ({ start: () => nodeWorker(lie), bytes: async (file) => { const b = bytesOf('../shell/in-tab/' + file); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } });
/** One proof in a worker of its own. */
export const fresh = async (spec, lie) => { await closeInTabProof(); const r = await proveInTab(spec, { guest, worker: shell(lie) }); await closeInTabProof(); return r; };
