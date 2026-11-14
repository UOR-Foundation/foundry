# FA-88: every rule a spec can state, proved in the tab

FA-87 proved a rules app in the tab only when every rule was a box: each field a range, each condition narrowing one
field. A spec may say more, and the shipped fixtures do. RSVP compares two fields (`party > seats`); the parking fee
says `is not`; a number may have no maximum. Those went to the hosted verifier. Now they are proved in the tab.

## The theorem

`v2/in-tab-kernel/live/Tab.lean`, `PrismLive.Tab.tab_sound`, compiled by Lean 4.32.1, on `propext` and `Quot.sound`.

- **Semantics.** `Tab.Cond` carries whether its value is a number or another field; `condHolds`, `judge` and `breaks`
  are stated beside the checker. For a condition on a number they are `PrismLive.Kernel`'s (`condHolds_number`).
- **Zones.** A region is a list of zones: a box and difference constraints `x_a + k ≤ x_b + j`. `zonesOf` gives the
  zones of a list of conditions exactly (`zonesOf_spec`, both directions). `is not` splits a zone in two; a
  comparison of fields adds a constraint, or splits for `!=`.
- **Empty zones.** A zone holds no request when its box is empty or its constraints close, by Floyd and Warshall's
  closure over the fields they name, to a field above itself (`zEmpty_sound`). Only that direction is proved: an empty
  answer is never wrong. That the closure finds every empty zone is a fact of integer difference constraints, not
  proved here; a miss could only make a true guarantee fail to prove.
- **Assembly.** As in `linked_sound`, a guarantee is assembled from facts by lemma application, and the kernel
  evaluates nothing while assembling. Facts are `ZonesOf` (a list of conditions and its zones), `NotBad`, and
  `Covers` (earlier zones cover the meet of a rule's zone and the guarantee's).

`live/zones.mjs` computes the same definitions on numbers, step for step, so the tab knows each fact before it asks.
Bounds are BigInt: a number with no maximum is bounded by `10^18 - 1`, the largest a request can carry
(`MAX_DIGITS`, 18 digits, in `prism/spec.mjs`).

## Evidence

- **Library.** `studio/shell/in-tab/library.ndjson`, 8,917,947 bytes, 1,412,960 gzip, now with `tab_sound`. The
  WebAssembly kernel judged it whole, 2,258 declarations, in 1.9 s (`evidence/live-binding.json`). The kernel itself
  is unchanged.
- **Node suite** (`studio/tools/in_tab_every_rule.test.mjs`, four tests), the fixtures' own specs:
  - the data the tab proves answers all 168 sampled requests of RSVP, the parking fee and the library fee as
    `prism/spec.mjs`'s `judge` does;
  - each of the three is proved and the guest says `proved`; so is RSVP with no maximum on seats, and a spec comparing
    two fields by `=` and `!=`;
  - RSVP without its waitlist rule is refused, the guarantee about seats named; the parking fee with its `is not`
    guarantee turned around is refused, that guarantee named;
  - proved again, no fact is judged; with one bound widened, only the facts it changed.
- **Under Node** (`live/tab-run.mjs`, one run, `evidence/tab.json`):

  | | Facts | Judged | Total |
  | --- | --- | --- | --- |
  | Verdant, 35 rules, 15 guarantees, first | 381 | 381 | 1.29 s |
  | Verdant again | 381 | 0 | 0.27 s |
  | Verdant, one rule edited (5 edits) | 381 | 8 to 18 | 0.33 to 0.64 s |
  | RSVP | 7 | 5 | 0.24 s |
  | RSVP, both numbers with no maximum | 7 | 5 | 0.22 s |
  | Parking with `is not` | 12 | 10 | 0.04 s |
  | Two fields by `=` and `!=` | 8 | 6 | 0.88 s |

  Through `linked_sound`, Verdant took 1.66 s first and about 0.3 s after an edit; the zone path is not slower on
  boxes. A comparison of fields costs more: each emptiness is a closure the kernel evaluates.
- **A refusal checked.** Of the five Verdant edits, one (rule 31) was refused for guarantee 14. The request
  `1 2 0 1 1 0 0`, the lowest corner of what is left uncovered, answers 8, which guarantee 14 forbids.
- **Faults under Node**: a covering said to cover a region with requests in it by nothing; zones for a rule that are not
  its zones (the comparison's constraint dropped); a proof naming another rule's zones fact. Each refused by the
  kernel. A covering with one of its named zones left out was first tried and accepted: every earlier zone that
  touches the region is named, needed or not, so it was still true.
- **Planted defects** (`node studio/tools/in_tab_every_rule_defects.mjs`), eight, each refused and restored after: a
  comparison of two fields read the other way round; `is not` read as `is`; a number with no maximum bounded at
  10^9; the zones of `is not` leaving out the values above; the zones of `<`, and of `>`, not strict; the zones of `=`
  keeping one direction; a covering that names no earlier zone. The first run let two through, both gaps in the
  suite: the bound was compared with the constant the defect changed, and no spec compared fields by `<`. The suite
  now compares with eighteen nines and proves a spec comparing two fields by all six operators.

## Not established

- That the closure decides every empty zone (completeness) is not proved; it bounds only whether a true guarantee
  proves.
- The statement is about the rules as data. That the published module answers as the data does is checked here on
  168 sampled requests, not proved.
- A browser run of a spec with a comparison of fields.
