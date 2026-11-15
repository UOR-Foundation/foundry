# hologram-forge

An AI app builder in any browser, 100 percent serverless, as one PrismPM module.

The vendored upstream renderer (`vendor/dyad`, pinned at `00d5f5af7fd0`, v1.15.0-beta.1) supplies the product: its React renderer, its typed IPC contracts, its state machines, its prompts, its scaffold. PrismPM supplies the authority: one Lean verified model in `src/*.lex.tex` that owns every rule, every address preimage and every visible word, projected by lean4-prod to Rust and wasm32 and shipped as a `.holo` v4. Hologram supplies the substrate: kappa addressing, a service worker that is the kernel of the page origin, and the contracts hologram-live already enforces, so an application built here runs unchanged on Hologram Desktop and Server.

Nothing runs but the browser and a static file host. No Electron, no Node process, no database process, no relay, no proxy.

## How it is built

- `tools/author.py` writes `src/*.lex.tex`, the only files LexLean and PrismPM read. `lexlean.lock` pins them.
- `scripts/lane.sh` replays the whole lane on Linux x86_64 (WSL or CI) at the PrismPM commit in `PRISMPM_REV`: LexLean lock, check, build, verify under Lean 4.32.1 with leanchecker replay and exact per declaration axiom sets (`tools/axioms.json`, pinned by `tools/pin_axioms.py`); lean4-prod exports every root in `model/roots.txt` to kernel LCNF twice, byte identical, and generates Rust twice, byte identical, into `generated/hologram_forge_core.rs`; the core crate builds for the host and for wasm32; `core/src/bin/project_shell.rs` renders `shell/index.html` from the generated `view()`. Compare mode refuses drift in any committed artifact.
- `tools/corpus.py` pins the bytes Lean cannot: the snapshot preimage and the capability decision on a fixed corpus, checked by `core/tests/corpus.rs` against the generated functions.
- `vendor/dyad/` is the upstream renderer at the pinned commit with `src/pro` removed (Functional Source License; not reused). Every change to a reused file is listed in `vendor/dyad/VENDORED.md`.

## The homepage is the app builder

https://uor-foundation.github.io/foundry/ opens the renderer's own UI, whole: its home with the first prompt, its apps, chats, previews, settings, library, templates, plugins and the Publish panel, built from the vendored renderer by Vite into `shell/assets/` (`vendor/dyad/vite.shell.config.mts`, fixed names) and mounted by the projected `shell/index.html`, which the core writes from the verified View. The host (`shell/host.js`) runs first and is `window.electron` on the page. The appearance switch stays at the top right: Immersive (a curated photo behind the renderer's panels, made translucent through the renderer's own colour variables), Dark and Light, kept as Hologram OS keeps it (`holo.theme.v1`) and mirrored into the renderer's theme class both ways (`shell/appearance.js`, `shell/appearance.css`). The previous landing page (the hero, the who pill, the relay sheet) is retired; the providers are chosen inside the app builder, and the OpenAI compatible endpoint still answers on this origin through the worker. Cloud inference requires the visitor's configured device credential and per-request approval. The local model can answer without a cloud credential; cloud warmup uses only the visitor's credential. Public site credential files are rejected during assembly. On the page the product is called Hologram: the build replaces the upstream name and logo (`vendor/dyad/VENDORED.md`), Electron's title bar is hidden, and when a new shell is deployed the worker reloads open pages once so no page runs two closures.

## The brand is the kit's tokens

Every colour, font and radius on the page is the Hologram brand kit's (Hologram-Technologies/hologram-brand-kit at the commit `BRAND_KIT_REV` pins, vendored under `vendor/hologram-brand-kit/`). `tools/brand_kit.py` generates `shell/brand.css` (the web fonts, the light and dark variables, the Immersive layer, the display and mono rules), `vendor/dyad/hologram.theme.css` (spliced into the renderer's stylesheet at build: the same variables and a Tailwind theme that remaps every palette family the renderer's screens name onto the kit's warm ramp, floors small text at 14 px and names the display face) and `shell/brand.json` (the colours the pages and the web manifest name outside a stylesheet). The lane's Brand gate refuses a build whose vendored kit files or generated stylesheets drifted, or that names a colour by hand anywhere in the shell. Light is the kit's paper, Dark its warm dark, Immersive the warm dark as glass over the unfaded photo; the accent is used once per view.

## The components are shadcn/ui, as the kit vendors it

Every button, field, menu, dialog, sidebar and card on the page is a shadcn/ui new-york-v4 component, the file the Hologram brand kit vendors from shadcn's registry, verbatim (`vendor/shadcn-ui/`, digests in `VENDORED.sha256`). One copy serves the renderer and the live frame. The renderer resolves each `@/components/ui/*` it imports to that copy at build (`vendor/dyad/hologram.ui.mjs`) and refuses a bundle holding Base UI or upstream's own copy of a component; upstream's screens, written for shadcn on Base UI, are rewritten to Radix's props at build (`vendor/dyad/hologram.radix.mjs`) and typechecked as rewritten (`vendor/dyad/hologram.typecheck.mjs`). To take a newer kit: set `kit` in `live-src/style.json`, run `node tools/live_components.mjs --vendor` and `--build`, and build the renderer; nothing else is edited.

## An app's source can be its canonical LexLean module

The live preview projects an app from its spec; the spec can itself be read from the app's canonical LexLean module (`shell/live/lexlean.mjs`): one semantic module holding the choice and answer codes, `Request`, `inBounds`, the rules, the first-match `judge`, and each guarantee as `breaks…` with its `…Holds` theorem, the same declarations prism-code renders. A chat turn's `<prism-lexlean>` is projected as it streams, declaration by declaration, and stored at the end of the turn as `prism/<Module>.lex.tex`, the source the spec is read from. Every guarantee is checked by local obligations (`shell/live/obligations.mjs`), each keyed by the BLAKE3 of exactly what it depends on, so an edit recomputes only what it changed; the table remains the check for what obligations do not cover. `tools/live_lexlean.mjs --check` is the gate; `tools/live_lab/` hosts the live frame on a LexLean module for measurement.

## The host answers the renderer's own contracts

The renderer declares every channel with a zod schema and validates nothing it receives, so an answer of the wrong shape reaches a screen and crashes it far from the cause. The build publishes those schemas on the page (`vendor/dyad/hologram.contracts.ts`) and `shell/host.js` parses every answer against the channel's contract: a disagreement names the channel in the console, and a screen that will iterate an array is handed an empty one rather than a value it cannot walk. `tools/contract_shapes.mjs --check` refuses a build whose host answers a channel with a literal of the wrong shape, and runs in the Pages build where the renderer's dependencies are installed.

## Publish: every application is a `.holo` cooked through PrismPM

The renderer's Publish panel offers "Publish as a Hologram application". The host builds the project's page with every dependency bundled in (a portable View has no network), encodes it as a HOLOVIEW v1 bundle, takes this very core as the Core-Wasm guest, asks the core for the model document and the source manifest bytes, and hands all of it to PrismPM's own archive composer, `compose_application`, which runs in the core: `core/src/holo/` and `core/src/error.rs` are PrismPM's files verbatim at the pinned commit (the lane refuses a build whose copy drifted, `tools/prismpm_vendor.sha256`). The result is a `.holo` v4 in PrismPM's closed Holo/1 profile, kept in the device store at its BLAKE3 address, served by the worker under `holo/<kappa>/`, downloadable as `holo/<kappa>.holo`, and loadable unchanged by hologram-live. `holo.html` runs any such file on any device, desktop or phone: PrismPM's validator in the core accepts the bytes, every blob re-derives to its address, the View unpacks under its address and opens. The core decides before anything is composed (`publishDecision`): the page's shell closure must be the closure the lane recorded beside the core in `shell/provenance.json`, and the lane's attestation must be present; otherwise the View's refusal word. The decisions and measurements are in `HOLOGRAM/FORGE-PUBLISH-HOLO-EVAL.md`.

## The model: five LexLean modules

`Workspace` (records, the snapshot preimage, restore, capabilities, versions, preview), `Inference` (the transcript, memo, the route table, the OpenAI wire, the OpenRouter request), `Object` (the kappa object addressing rule, pool and stage tables, pack, ladder, loader), `Publish` (the published application's model document, source manifest, decision and path) and `Forge` (the one View of every visible word). `tools/author.py` writes them from `tools/model_workspace.py`, `tools/model_inference.py` and `tools/model_publish.py`.

## Module 1, workspace (the first commit)

Records: `Entry {path, kappa, bytes}`, `Project {label, entries}`, `Grant {endpoint}`, `Capabilities {endpoints}`, `View`. Rules: `snapshotPreimage` (the bytes a project state is addressed by; the model owns preimages, the host derives the BLAKE3 address), `restoreDecision` (stored bytes must re-derive to their address or are refused), `networkDecision` (an origin is admitted only when a grant lists it; the empty baseline admits nothing, as hologram-live decides). Theorems by reflexivity: `view_headline`, `admits_nothing_without_grants`, `refuses_without_grants`, `empty_project_preimage`.

The spikes that decided the design, with measurements, are in the HOLOGRAM workspace: `FORGE-BROWSER-FIRST-EVAL.md`.

## Licence

This repository: MIT or Apache 2.0. `vendor/dyad`: Apache 2.0 (see `vendor/dyad/LICENSE` and `NOTICE`).
