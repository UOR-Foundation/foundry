// Proving a rules app in the tab (shell/in-tab): the shell's own kernel and library, Lean's kernel judging what
// prove.mjs writes, and the pinned Forge kernel guest deciding the verdict. Nothing here stands in for either
// kernel. The worker's own file (storage, the address checks at open) runs only in a browser:
// tools/in_tab_prove_browser.mjs asks it there.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { appOfSpec, statementAddress, LARGEST } from '../shell/in-tab/spec-app.mjs';
import { proveInTab, inTabProofOn, closeInTabProof, SCHEMA, AXIOMS } from '../shell/in-tab/client.mjs';
import { at, bytesOf, sha, manifest, guest, shell, fresh } from './in_tab_harness.mjs';

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
  for (const file of ['emit.mjs', 'certs.mjs', 'prove.mjs', 'zones.mjs']) assert.ok(bytesOf('../shell/in-tab/' + file).equals(bytesOf('../../v2/in-tab-kernel/live/' + file)), file);
});

test('a spec is read as data, every condition as it is written', () => {
  const read = appOfSpec(parking);
  assert.deepEqual(read, { ok: true, app: { name: 'Tab', bounds: [[0n, 24n], [0n, 2n]], otherwise: 1,
    rules: [{ when: [[0, 4, 0, false]], outcome: 0 }, { when: [[1, 4, 2, false]], outcome: 2 }, { when: [[0, 2, 12, false]], outcome: 2 }],
    properties: [{ always: false, when: [[0, 4, 0, false]], outcome: 2 }, { always: true, when: [[0, 2, 12, false], [1, 5, 2, false]], outcome: 2 }] } });
  const withRule = (when, fields = parking.fields) => appOfSpec({ ...parking, fields, rules: [{ id: 'REQ-001', when, then: 'free' }] });
  assert.deepEqual(withRule([{ field: 'vehicle', op: 'is not', value: 'car' }]).app.rules[0].when, [[1, 5, 0, false]]);
  const two = [{ name: 'hours', kind: 'number', min: 0, max: 24 }, { name: 'vehicle', kind: 'choice', values: ['car', 'van', 'truck'] }, { name: 'paid', kind: 'number' }];
  assert.deepEqual(withRule([{ field: 'hours', op: '<', value: { field: 'paid' } }], two).app.rules[0].when, [[0, 0, 2, true]]);
  assert.deepEqual(withRule([], two).app.bounds[2], [0n, LARGEST]);
  assert.equal(LARGEST, 999999999999999999n);
  // What a validated spec cannot hold is still refused.
  assert.match(withRule([{ field: 'vehicle', op: 'is', value: 'bus' }]).why, /cannot read/);
  assert.match(withRule([{ field: 'vehicle', op: '<', value: { field: 'hours' } }]).why, /compares with a field/);
  assert.match(appOfSpec({ ...parking, fields: [{ name: 'hours', kind: 'number', min: -1, max: 24 }, parking.fields[1]] }).why, /whole numbers/);
  assert.match(appOfSpec({ ...parking, otherwise: 'gold' }).why, /not an outcome/);
  // The address is of the whole statement: any part changed is another statement.
  const a = statementAddress(read.app);
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
  for (const other of [{ ...read.app, otherwise: 0 }, { ...read.app, bounds: [[0n, 25n], [0n, 2n]] }, { ...read.app, rules: read.app.rules.slice(1) }, { ...read.app, properties: read.app.properties.slice(1) }, { ...read.app, rules: read.app.rules.map((r, k) => (k ? r : { ...r, when: [[0, 4, 0, true]] })) }]) assert.notEqual(statementAddress(other), a);
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
  // A guest that cannot answer, and a spec the tab cannot read: no verdict, and the caller is told why.
  await closeInTabProof();
  const silent = await proveInTab(parking, { guest: { dispatch: async () => new TextEncoder().encode('invalid') }, worker: shell() });
  assert.equal(silent.ok, false); assert.match(silent.why, /gave no verdict \(invalidVerdictResponse\)/);
  await closeInTabProof();
  const outside = await proveInTab({ ...parking, rules: [{ id: 'REQ-001', when: [{ field: 'vehicle', op: 'is', value: 'bus' }], then: 'free' }] }, { guest, worker: { start: () => assert.fail('no worker is started'), bytes: () => assert.fail() } });
  assert.equal(outside.ok, false); assert.match(outside.why, /cannot read/);
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
