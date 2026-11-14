// Proving a rules app in the tab (shell/in-tab): the shell's own kernel and library, Lean's kernel judging what
// prove.mjs writes, and the pinned Forge kernel guest deciding the verdict. Nothing here stands in for either
// kernel. The worker's own file (storage, the address checks at open) runs only in a browser:
// tools/in_tab_prove_browser.mjs asks it there.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { appOfSpec, statementAddress } from '../shell/in-tab/spec-app.mjs';
import { proveInTab, inTabProofOn, closeInTabProof, SCHEMA, AXIOMS } from '../shell/in-tab/client.mjs';
import { prover } from '../shell/in-tab/prove.mjs';

const at = (p) => new URL(p, import.meta.url), bytesOf = (p) => fs.readFileSync(at(p)), sha = (b) => createHash('sha256').update(b).digest('hex');
const manifest = JSON.parse(bytesOf('../shell/in-tab/manifest.json'));

// The Forge kernel guest the studio ships, asked as shell/kernel.js asks it.
const guestModule = await WebAssembly.compile(bytesOf('../shell/kernel/guest.wasm'));
const guest = { dispatch: async (request) => {
  const { memory, holo_alloc, holo_run } = (await WebAssembly.instantiate(guestModule, {})).exports, where = holo_alloc(request.length);
  new Uint8Array(memory.buffer, where, request.length).set(request);
  const packed = BigInt.asUintN(64, BigInt(holo_run(where, request.length)));
  return new Uint8Array(memory.buffer, Number(packed >> 32n), Number(packed & 0xffffffffn)).slice();
} };

// The worker's protocol over the shell's real kernel, without its storage. `lie` changes what it reports.
const factory = (await import(at('../shell/in-tab/lean-kernel.mjs').href)).default;
function nodeWorker(lie = {}) {
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
const shell = (lie) => ({ start: () => nodeWorker(lie), bytes: async (file) => { const b = bytesOf('../shell/in-tab/' + file); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } });
const fresh = async (spec, lie) => { await closeInTabProof(); const r = await proveInTab(spec, { guest, worker: shell(lie) }); await closeInTabProof(); return r; };

const parking = {
  title: 'Parking', fields: [{ name: 'hours', kind: 'number', min: 0, max: 24 }, { name: 'vehicle', kind: 'choice', values: ['car', 'van', 'truck'] }],
  outcomes: ['free', 'standard', 'premium'], otherwise: 'standard',
  rules: [{ id: 'REQ-001', when: [{ field: 'hours', op: '=', value: 0 }], then: 'free' }, { id: 'REQ-002', when: [{ field: 'vehicle', op: 'is', value: 'truck' }], then: 'premium' }, { id: 'REQ-003', when: [{ field: 'hours', op: '>', value: 12 }], then: 'premium' }],
  properties: [{ id: 'INV-001', kind: 'never', when: [{ field: 'hours', op: '=', value: 0 }], then: 'premium' }, { id: 'INV-002', kind: 'always', when: [{ field: 'hours', op: '>', value: 12 }, { field: 'vehicle', op: 'is not', value: 'truck' }], then: 'premium' }],
};

test('the shell ships the kernel and the library its manifest and binding name', () => {
  for (const part of ['glue', 'wasm', 'library']) { const b = bytesOf('../shell/in-tab/' + manifest[part].file); assert.equal(sha(b), manifest[part].sha256, part); assert.equal(b.length, manifest[part].bytes, part); }
  assert.deepEqual([manifest.binding.kernel, manifest.binding.loader, manifest.binding.library], [manifest.wasm.sha256, manifest.glue.sha256, manifest.library.sha256]);
  assert.equal(manifest.lean.commit, 'f054605aea4b840552cca2e725580bffd1e1b704');
  // The prover the shell runs is the one measured in v2/in-tab-kernel, byte for byte.
  for (const file of ['emit.mjs', 'certs.mjs', 'prove.mjs']) assert.ok(bytesOf('../shell/in-tab/' + file).equals(bytesOf('../../v2/in-tab-kernel/live/' + file)), file);
});

test('a spec is read as boxes, and one that is not boxes is not read', () => {
  const read = appOfSpec(parking);
  assert.deepEqual(read, { ok: true, app: { name: 'Tab', bounds: [[0, 24], [0, 2]], otherwise: 1,
    rules: [{ when: [[0, 4, 0]], outcome: 0 }, { when: [[1, 4, 2]], outcome: 2 }, { when: [[0, 2, 12]], outcome: 2 }],
    properties: [{ always: false, when: [[0, 4, 0]], outcome: 2 }, { always: true, when: [[0, 2, 12], [1, 5, 2]], outcome: 2 }] } });
  const withRule = (when) => ({ ...parking, rules: [{ id: 'REQ-001', when, then: 'free' }] });
  assert.match(appOfSpec(withRule([{ field: 'vehicle', op: 'is not', value: 'car' }])).why, /says `is not`/);
  assert.match(appOfSpec(withRule([{ field: 'hours', op: '<', value: { field: 'hours' } }])).why, /compares two fields/);
  assert.match(appOfSpec({ ...parking, properties: [{ ...parking.properties[0], when: [{ field: 'hours', op: '<', value: { field: 'hours' } }] }] }).why, /compares two fields/);
  assert.match(appOfSpec(withRule([{ field: 'vehicle', op: 'is', value: 'bus' }])).why, /cannot read/);
  assert.match(appOfSpec({ ...parking, fields: [{ name: 'hours', kind: 'number', min: -1, max: 24 }, parking.fields[1]] }).why, /whole numbers/);
  assert.match(appOfSpec({ ...parking, otherwise: 'gold' }).why, /not an outcome/);
  // The address is of the whole statement: any part changed is another statement.
  const a = statementAddress(read.app);
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
  for (const other of [{ ...read.app, otherwise: 0 }, { ...read.app, bounds: [[0, 25], [0, 2]] }, { ...read.app, rules: read.app.rules.slice(1) }, { ...read.app, properties: read.app.properties.slice(1) }]) assert.notEqual(statementAddress(other), a);
});

test('Lean\'s kernel proves the guarantees and the kernel guest says proved; an edit judges only what changed', async () => {
  await closeInTabProof();
  const worker = shell(), first = await proveInTab(parking, { guest, worker });
  assert.equal(first.ok, true, first.why);
  assert.deepEqual([first.record.schema, first.record.verdict, first.record.axioms, first.record.properties], [SCHEMA, 'proved', [...AXIOMS].sort(), ['INV-001', 'INV-002']]);
  assert.deepEqual([first.record.kernel, first.record.library, first.record.lean.version], ['sha256:' + manifest.wasm.sha256, 'sha256:' + manifest.library.sha256, '4.32.1']);
  assert.equal(first.record.statement, statementAddress(appOfSpec(parking).app));
  assert.equal('attestation_id' in first.record, false);
  assert.ok(first.record.factsJudged === first.record.facts && first.record.facts > 0);
  const again = await proveInTab(parking, { guest, worker });
  assert.deepEqual([again.ok, again.record.factsJudged], [true, 0]);
  const edited = await proveInTab({ ...parking, rules: parking.rules.map((r, k) => (k === 2 ? { ...r, when: [{ field: 'hours', op: '>', value: 11 }] } : r)) }, { guest, worker });
  assert.equal(edited.ok, true, edited.why);
  assert.ok(edited.record.factsJudged > 0 && edited.record.factsJudged < first.record.facts);
  assert.notEqual(edited.record.statement, first.record.statement);
  await closeInTabProof();
});

test('nothing but the guest\'s word proved is a proof', async () => {
  // A guarantee the rules break: Lean's kernel refuses it, and the guest refuses the proof.
  const broken = await fresh({ ...parking, properties: [parking.properties[0], { ...parking.properties[1], kind: 'never' }] });
  assert.equal(broken.ok, false); assert.match(broken.why, /said refused: Lean's kernel refused INV-002/);
  // A worker that proved some other app: the statement it checked is not the spec's. Here every guarantee of the
  // other app holds, so only the comparison of statements can refuse it.
  const other = await fresh(parking, { app: (a) => ({ ...a, otherwise: 0 }) });
  assert.equal(other.ok, false); assert.match(other.why, /^the kernel guest said refused$/);
  const fewer = await fresh(parking, { app: (a) => ({ ...a, properties: a.properties.slice(0, 1) }) });
  assert.equal(fewer.ok, false); assert.match(fewer.why, /said refused/);
  // Another kernel, another library, or an axiom outside the declared two.
  for (const lie of [{ evidence: { kernel: '0'.repeat(64) } }, { evidence: { library: 'f'.repeat(64) } }, { axioms: ['propext', 'Quot.sound', 'sorryAx'] }, { axioms: ['propext', 'Quot.sound', 'Classical.choice'] }, { axioms: ['propext'] }]) {
    const r = await fresh(parking, lie);
    assert.equal(r.ok, false, JSON.stringify(lie)); assert.match(r.why, /said refused/, JSON.stringify(lie));
  }
  // A guest that cannot answer, and a spec outside the fragment: no verdict, and the caller is told why.
  await closeInTabProof();
  const silent = await proveInTab(parking, { guest: { dispatch: async () => new TextEncoder().encode('invalid') }, worker: shell() });
  assert.equal(silent.ok, false); assert.match(silent.why, /gave no verdict \(invalidVerdictResponse\)/);
  await closeInTabProof();
  const outside = await proveInTab({ ...parking, rules: [{ id: 'REQ-001', when: [{ field: 'vehicle', op: 'is not', value: 'car' }], then: 'free' }] }, { guest, worker: { start: () => assert.fail('no worker is started'), bytes: () => assert.fail() } });
  assert.equal(outside.ok, false); assert.match(outside.why, /says `is not`/);
});

test('the switch is off unless asked for, and remembers what it was told', () => {
  const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
  const s = store();
  assert.equal(inTabProofOn({ search: '' }, s), false);
  assert.equal(inTabProofOn({ search: '?proof=tab' }, s), true);
  assert.equal(inTabProofOn({ search: '' }, s), true);
  assert.equal(inTabProofOn({ search: '?proof=hosted' }, s), false);
  assert.equal(inTabProofOn({ search: '?proof=anything' }, s), false);
  assert.equal(inTabProofOn({ search: '' }, s), false);
  assert.equal(inTabProofOn({ search: '?proof=tab' }, { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }), false);
});

test('the host asks the tab first only when the switch is on, and the hosted verifier whenever the tab does not prove', async () => {
  const vm = await import('node:vm');
  const host = fs.readFileSync(at('../shell/host.js'), 'utf8'), start = host.indexOf('async function proveRules(');
  const source = host.slice(start, host.indexOf('\n}\n', start) + 3) + '\nproveRules';
  const run = async ({ on, tab }) => {
    const rule = { phase: 'proving', specKappa: 'k', spec: parking }, log = { tab: 0, hosted: 0, events: [], saved: null, guest: null };
    const proveRules = vm.runInNewContext(source, {
      rulesOf: async () => rule, sameRuleReservation: (a, b) => a === b, saveRules: async (_, next) => { log.saved = next; return true; }, now: () => 'now',
      nextPhase: async (_, event) => { log.events.push(event); return event === 'attest' ? 'proved' : 'checked'; },
      put: async () => {}, get: async () => undefined, refreshLive: async () => {}, kernelReady: 'the guest',
      inTab: { inTabProofOn: () => on, proveInTab: async (spec, options) => { log.tab++; log.guest = options.guest; assert.equal(spec, parking); return tab; } },
      prism: { prove: async () => { log.hosted++; return { ok: true, record: { attestation_id: 'a'.repeat(64) }, axioms: { t: '[propext]' } }; } },
    });
    return { result: await proveRules(1, 'k', () => {}), log };
  };
  const proved = await run({ on: true, tab: { ok: true, seconds: 0.4, record: { schema: SCHEMA, verdict: 'proved' } } });
  assert.deepEqual([proved.log.tab, proved.log.hosted, proved.log.events, proved.log.guest], [1, 0, ['attest'], 'the guest']);
  assert.deepEqual([proved.log.saved.phase, proved.log.saved.proof.schema, 'attestation_id' in proved.log.saved.proof], ['proved', SCHEMA, false]);
  const fell = await run({ on: true, tab: { ok: false, why: 'rule REQ-001 says `is not`' } });
  assert.deepEqual([fell.log.tab, fell.log.hosted, fell.log.events], [1, 1, ['attest']]);
  assert.deepEqual([fell.result.inTab, fell.log.saved.proof.attestation_id], ['rule REQ-001 says `is not`', 'a'.repeat(64)]);
  const off = await run({ on: false, tab: { ok: true, record: {} } });
  assert.deepEqual([off.log.tab, off.log.hosted, off.result.inTab], [0, 1, undefined]);
  // Publish asks the hosted verifier before it builds rules that carry no attestation.
  const publish = host.slice(host.indexOf('async function publishTurn('));
  const body = publish.slice(0, publish.indexOf('\n}\n'));
  assert.ok(body.indexOf('if (rules.proof && !rules.proof.attestation_id) {') > 0 && body.indexOf('if (rules.proof && !rules.proof.attestation_id) {') < body.indexOf('buildOnGitHub('));
});
