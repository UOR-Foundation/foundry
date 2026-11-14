// FA-88: the tab proves a rules app whatever its conditions say. The fixtures' own specs, the shell's own Lean kernel
// and library, and the pinned Forge kernel guest; nothing stands in for either kernel (in_tab_harness.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { validateSpec, judge, sampleRequests } from '../shell/prism/spec.mjs';
import { appOfSpec } from '../shell/in-tab/spec-app.mjs';
import { proveInTab, closeInTabProof } from '../shell/in-tab/client.mjs';
import { guest, shell, fresh } from './in_tab_harness.mjs';

const fixture = (p) => { const s = JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8')); return validateSpec(s.spec || s); };
const rsvp = fixture('./fixtures/live/rsvp.json'), parkingFee = fixture('./fixtures/specs/parking-fee.json'), libraryFee = fixture('./fixtures/specs/library-fee.json');

// PrismLive.Tab's semantics (live/Tab.lean), on the data the tab writes its statements from.
const opHolds = (op, c, x) => (op === 0 ? x < c : op === 1 ? x <= c : op === 2 ? c < x : op === 3 ? c <= x : op === 4 ? x === c : x !== c);
const condHolds = ([f, op, v, other], x) => opHolds(op, other ? x[v] : BigInt(v), x[f]);
const tabJudge = (app, x) => { for (const r of app.rules) if (r.when.every((c) => condHolds(c, x))) return r.outcome; return app.otherwise; };

test('the data the tab proves answers every sampled request as the rules do', () => {
  let asked = 0;
  for (const spec of [rsvp, parkingFee, libraryFee]) {
    const { app } = appOfSpec(spec);
    for (const request of sampleRequests(spec)) {
      // A request is one value per field: a number, or a choice's word.
      const x = spec.fields.map((f, i) => BigInt(f.kind === 'choice' ? f.values.indexOf(request[f.name] ?? request[i]) : (request[f.name] ?? request[i])));
      assert.ok(x.every((v, i) => app.bounds[i][0] <= v && v <= app.bounds[i][1]), 'a sampled request is in the bounds');
      assert.equal(spec.outcomes[tabJudge(app, x)], judge(spec, request).outcome, spec.title + ': ' + Object.values(request).join(' '));
      asked++;
    }
  }
  // The sampler takes each field's boundary values (prism/spec.mjs candidates): 168 requests over the three specs.
  assert.equal(asked, 168);
});

test('every shape of condition is proved in the tab, and the kernel guest says proved', async () => {
  // RSVP compares two fields (party > seats); the parking fee says `is not`; the library fee is boxes.
  for (const spec of [rsvp, parkingFee, libraryFee]) {
    const r = await fresh(spec);
    assert.equal(r.ok, true, spec.title + ': ' + r.why);
    assert.deepEqual([r.record.verdict, r.record.axioms], ['proved', ['Quot.sound', 'propext']]);
  }
  // A number with no maximum: seats bounded only by the largest number a request can carry.
  const open = { ...rsvp, fields: rsvp.fields.map((f) => (f.name === 'seats' ? { name: 'seats', kind: 'number', min: 0 } : f)) };
  // 18 nines: the largest number a request of at most MAX_DIGITS digits carries (prism/spec.mjs).
  assert.deepEqual(appOfSpec(open).app.bounds[2], [0n, 999999999999999999n]);
  const big = await fresh(open);
  assert.equal(big.ok, true, big.why);
  // Two fields compared by every operator: =, !=, <, <=, > and >=.
  const pair = validateSpec({ title: 'Pair', purpose: 'Says whether two counts differ.', fields: [{ name: 'left', kind: 'number', min: 0, max: 9 }, { name: 'right', kind: 'number', min: 0, max: 9 }],
    outcomes: ['same', 'differ'], otherwise: 'same',
    rules: [{ when: [{ field: 'left', op: '!=', value: { field: 'right' } }], then: 'differ', why: 'counts that differ' }],
    properties: [{ kind: 'always', when: [{ field: 'left', op: '=', value: { field: 'right' } }], then: 'same', why: 'equal counts are the same' },
      { kind: 'never', when: [{ field: 'left', op: '>', value: { field: 'right' } }], then: 'same', why: 'a larger left differs' },
      { kind: 'never', when: [{ field: 'left', op: '<', value: { field: 'right' } }], then: 'same', why: 'a smaller left differs' },
      { kind: 'always', when: [{ field: 'left', op: '<=', value: { field: 'right' } }, { field: 'left', op: '>=', value: { field: 'right' } }], then: 'same', why: 'neither larger nor smaller is the same' }], examples: [], limits: [] });
  const both = await fresh(pair);
  assert.equal(both.ok, true, both.why);
});

test('a guarantee the rules break through a comparison or an is not is refused, and named', async () => {
  // Without its waitlist rule, RSVP confirms a party larger than the seats left.
  const noWaitlist = { ...rsvp, rules: rsvp.rules.filter((r) => !r.when.some((c) => c.value && typeof c.value === 'object')) };
  const broken = await fresh(noWaitlist);
  assert.equal(broken.ok, false);
  const bySeats = rsvp.properties.find((p) => p.when.some((c) => c.value && typeof c.value === 'object')).id;
  assert.match(broken.why, new RegExp('said refused: Lean\'s kernel refused ' + bySeats + '$'));
  // The parking fee's guarantee about `is not`, turned around.
  const isNot = parkingFee.properties.findIndex((p) => p.when.some((c) => c.op === 'is not' || c.op === '!='));
  assert.ok(isNot >= 0);
  const turned = { ...parkingFee, properties: parkingFee.properties.map((p, i) => (i === isNot ? { ...p, kind: p.kind === 'always' ? 'never' : 'always' } : p)) };
  const r = await fresh(turned);
  assert.equal(r.ok, false); assert.match(r.why, new RegExp('Lean\'s kernel refused ' + parkingFee.properties[isNot].id));
});

test('the facts of one shape serve the next proof: an edit to RSVP judges only what it changed', async () => {
  await closeInTabProof();
  const worker = shell();
  const first = await proveInTab(rsvp, { guest, worker });
  assert.equal(first.ok, true, first.why);
  const again = await proveInTab(rsvp, { guest, worker });
  assert.equal(again.record.factsJudged, 0);
  const seats = rsvp.fields.findIndex((f) => f.name === 'seats');
  const wider = { ...rsvp, fields: rsvp.fields.map((f, i) => (i === seats ? { ...f, max: f.max + 1 } : f)) };
  const edited = await proveInTab(wider, { guest, worker });
  assert.equal(edited.ok, true, edited.why);
  assert.ok(edited.record.factsJudged > 0 && edited.record.factsJudged <= edited.record.facts);
  await closeInTabProof();
});
