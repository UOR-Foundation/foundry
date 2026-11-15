# Working in Prism AI Foundry

Read `AGENTS.md` first; its rules R1 to R6 bind every change.

Spend time and compute only on the change. Everything that did not change is referenced by its content address and reused.

- A workflow that a push or pull request starts must filter by path, key its output by `hashFiles(...)` and restore it from `actions/cache`, or carry `# reuse-exempt: <reason>`. `xtask validate` (`audit-reuse`) refuses anything else.
- A key names every input the work reads, including tool and SDK versions; write why beside it. A key that omits an input is wrong, not fast.
- Reuse is checked on read: an address is re-derived or its attestation resolved before the result is trusted. A failed check is a miss, and a miss does the work in full.
- Consult the cache before the work, never after.
- Only Prism is implemented: behavior goes in the Prism model (`*.lex.tex`). `audit-prism` refuses a new non-Prism file (Rust, TS/JS, Python, shell, CSS, HTML, host Lean) and any net growth in non-Prism lines over the parent commit. A fix in non-Prism code deletes at least as many lines as it adds; comments and blank lines are free.
- `v2/` holds prototypes that no published build reads; keep it out of the keys and path filters of work that does not read it.
- Proofs: reuse a Lean result only for identical inputs under an identical toolchain; say "proved" only for what Lean attested in that run or one it is addressed to.
