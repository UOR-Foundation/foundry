// FA-89: approving or publishing a rules app asks no hosted verifier. The host's own functions are run with every
// effect replaced by a recorder; the hosted prover is a function that fails the test if it is called.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { appJson } from '../shell/prism/template.mjs';
import { SCHEMA } from '../shell/in-tab/client.mjs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const host = read('../shell/host.js');
const body = (name) => { const start = host.indexOf(name); assert.ok(start >= 0, name); return host.slice(start, host.indexOf('\n}\n', start) + 3); };
const spec = { title: 'Parking', rules: [{ id: 'REQ-001' }], properties: [{ id: 'INV-001' }] };

test('approval proves in the tab only, and a refusal there leaves the rules unproved', async () => {
  const run = async (tab, beforeSubmit) => {
    const rule = { phase: 'proving', specKappa: 'k', spec }, log = { tab: 0, events: [], saved: null, guest: null, submitted: 0, committedBeforeAnswer: false };
    const proveRules = vm.runInNewContext(body('async function proveRules(') + '\nproveRules', {
      rulesOf: async () => rule, sameRuleReservation: (a, b) => a === b, saveRules: async (_, next) => { log.saved = next; return true; }, now: () => 'now',
      nextPhase: async (_, event) => { log.events.push(event); return event === 'attest' ? 'proved' : 'checked'; },
      put: async () => {}, get: async () => undefined, refreshLive: async () => {}, kernelReady: 'the guest',
      // The stand-in answers, then commits, as client.mjs does: nothing may be committed before the answer is in.
      inTab: { proveInTab: async (s, options) => { log.tab++; log.guest = options.guest; assert.equal(s, spec); log.committedBeforeAnswer = log.submitted > 0; await Promise.resolve(); options.commit(); return tab; } },
      prism: new Proxy({}, { get: (_, key) => () => assert.fail('the host asked prism.' + String(key)) }),
      fetch: () => assert.fail('the host fetched'),
    });
    const result = await proveRules(1, 'k', () => {}, { beforeSubmit: beforeSubmit ?? (() => log.submitted++) }).catch((e) => ({ thrown: e.code }));
    return { result, log };
  };
  const proved = await run({ ok: true, seconds: 0.4, record: { schema: SCHEMA, verdict: 'proved' } });
  assert.deepEqual([proved.log.tab, proved.log.submitted, proved.log.events, proved.log.guest], [1, 1, ['attest'], 'the guest']);
  // What the host saved, read across the realm the host's code ran in.
  const saved = JSON.parse(JSON.stringify(proved.log.saved));
  assert.deepEqual([saved.phase, saved.proof.schema, 'attestation_id' in saved.proof, saved.axioms], ['proved', SCHEMA, false, {}]);
  const refused = await run({ ok: false, why: "the kernel guest said refused: Lean's kernel refused INV-001" });
  assert.deepEqual([refused.log.tab, refused.log.events, refused.log.saved.phase, refused.log.saved.proof], [1, ['fail'], 'checked', null]);
  assert.equal(refused.log.saved.proofError, "the kernel guest said refused: Lean's kernel refused INV-001");
  assert.deepEqual([proved.log.committedBeforeAnswer, refused.log.committedBeforeAnswer], [false, false]);
  // An approval cancelled while the tab proved: the commit refuses, the proof is dropped, and nothing is saved.
  const cancelled = await run({ ok: true, seconds: 0.4, record: { schema: SCHEMA } }, () => { throw Object.assign(new Error('Generation cancelled'), { code: 'generationCancelled' }); });
  assert.deepEqual([cancelled.result.thrown, cancelled.log.saved, cancelled.log.events], ['generationCancelled', null, []]);
});

test('publishing asks no hosted verifier, and the published app says where its proof ran', () => {
  const publish = body('async function publishTurn(');
  for (const word of ['prism.prove(', 'prism.proveFiles(', 'attestingMessage', 'mcp.uor.foundation']) assert.equal(publish.includes(word), false, word);
  // The build is handed the attestation the rules carry, which a proof in the tab does not have.
  assert.ok(publish.includes('attestation: rules.proof && rules.proof.attestation_id'));
  // Rules over the SDK's limit are proved here and not published.
  assert.ok(publish.includes('rules.spec.rules.length > prism.PROVE_RULES_MAX ? prism.publishTooLarge(rules.spec)'));
  const site = JSON.parse(appJson({ name: 'parking', title: 'Parking', purpose: 'Says what parking costs.', fields: [], outcomes: ['free'], otherwise: 'free', rules: [], properties: [], examples: [], limits: [] }, null, { repository: 'someone/prism-parking', attestation: null }));
  assert.match(site.attestations.proof.id, /^not recorded: the proof ran in the SDK image/);
  assert.equal(site.attestations.proof.url, 'https://github.com/someone/prism-parking/actions/workflows/bootstrap.yml');
});

test('no rules path in the host names the hosted prover, and the words say what happens', async () => {
  for (const name of ['async function proveRules(', 'async function approveRules(', 'async function publishTurn(']) {
    const b = body(name);
    for (const word of ['prism.prove(', 'prism.proveFiles(', 'inTabProofOn', 'hosted verifier']) assert.equal(b.includes(word), false, name + ' ' + word);
  }
  const prism = read('../shell/prism.js');
  const fn = (name) => prism.slice(prism.indexOf(name), prism.indexOf('\n}\n', prism.indexOf(name)));
  for (const name of ['export function provingMessage(', 'export function proofMessage(', 'export function card(']) assert.equal(/hosted verifier/.test(fn(name)), false, name);
  const { provingMessage, proofMessage, publishTooLarge } = await import('../shell/prism.js');
  assert.match(provingMessage({ properties: [{}, {}] }), /^Proving 2 guarantees in this tab with Lean's kernel\. Nothing is sent to a server\.$/);
  assert.match(proofMessage({ properties: [{}] }, { ok: true, seconds: 0.4, record: { lean: { version: '4.32.1' }, facts: 7, factsJudged: 5 } }), /^\*\*Proved in this tab by Lean's kernel\.\*\* 1 of 1 guarantee hold.*No server took part\./);
  assert.match(proofMessage({ properties: [{}] }, { ok: true, seconds: 0.4, record: { lean: { version: '4.32.1' }, facts: 7, factsJudged: 5 } }), /judged 5 of the 7 facts the proof rests on; the rest it had judged before\./);
  // A first proof judges every fact: there is no rest to have judged before.
  assert.match(proofMessage({ properties: [{}] }, { ok: true, seconds: 1, record: { lean: { version: '4.32.1' }, facts: 20, factsJudged: 20 } }), /Lean 4\.32\.1's kernel judged all 20 facts the proof rests on\. No server took part\./);
  assert.match(proofMessage({ properties: [{}] }, { ok: false, error: 'the kernel guest said refused' }), /^\*\*Not proved\.\*\* the kernel guest said refused\. The rules are back to checked/);
  assert.match(publishTooLarge({ rules: Array(30).fill({}) }), /^These 30 rules are proved in this tab, but the published repository proves its model again with the Prism SDK, which proves at most 24 rules today/);
});
