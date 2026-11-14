# FA-87 — Prism R4 route

Authority: the Prism R4 decision, `studio/shell/r4/spec.json`, which is afflom/me's `app/specs/r4/spec.json` at 28dca52, byte for byte (SHA-256 `808b936a…b254`). There its seven guarantees are proved by Lean in `app/src/PrismR4.lex.tex`.

The idea box and the chat answer with Foundry's own language and reasoning only: the model in Prism on this device. `studio/shell/r4.mjs` states the facts of a turn as an R4 request and decides it with prism-code's `judge`, first match. It holds no rule of its own.

- Before any request is looked up or made, the route is decided. Foundry's grant is empty, so a route to any other model is `routed … ungranted` and refused. No cloud request, consent dialog or provider key step is reached.
- After the device model answers and before its answer is sealed or applied, R4 decides again with the weights fact (the loader read the weights back by their verified image address, `loaded.imageKappa`) and the engine's own address from the receipt.
- The studio lists and defaults to the device model only. A stored cloud selection is moved to the device model by one write of the settings record when the settings are read; the chat route itself never substitutes a model (FA-81).

The cloud warm-up, the paid branch and the paid-model repair turn are gone from a chat turn, with the two tests of that repair turn.

## Local evidence

`node --test studio/tools/prism_r4_route.test.mjs`: 5 of 5 pass. Every one of the spec's 18 examples is judged as stated.

Planted defects, each refused, then restored:

- A grant naming `featherless`: test 2 fails, the routed turn is no longer refused.
- The pre-request R4 decision removed from `chatTurn`: test 4 fails.

The suites that read the host's text and were touched pass: `browser_telemetry_isolation`, `generation_patch`, `live_main_integration`, `notation_host_integration`, `read_only_chat_execution`.
