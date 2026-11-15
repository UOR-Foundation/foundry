<a id="top"></a>

<p align="center">
  <img src=".github/banner.png" alt="Prism AI Foundry" width="100%">
</p>

# Prism AI Foundry

<p align="center">
  <a href="https://uor-foundation.github.io/foundry/"><b>Start building</b></a> &nbsp;|&nbsp; <a href="openspec/specs/forge-kernel/spec.md">Spec</a> &nbsp;|&nbsp; <a href="CONFORMANCE.md">Conformance</a> &nbsp;|&nbsp; <a href="AGENTS.md">For AI agents</a> &nbsp;|&nbsp; <a href="https://discord.gg/ZwuZaNyuve">Community</a>
</p>

<p align="center">
  <a href="https://uor-foundation.github.io/foundry/"><img src="https://img.shields.io/badge/Runs%20in-your%20browser-111111?style=for-the-badge" alt="Runs in your browser"></a>
  <a href="app/src/ForgeKernelProofs.lex.tex"><img src="https://img.shields.io/badge/Proved%20in-Lean%204-5B8CFF?style=for-the-badge" alt="Proved in Lean 4"></a>
  <a href="https://github.com/UOR-Foundation/foundry/actions/workflows/bootstrap.yml"><img src="https://img.shields.io/github/actions/workflow/status/UOR-Foundation/foundry/bootstrap.yml?branch=main&style=for-the-badge&label=Gate" alt="Gate"></a>
  <a href="https://discord.gg/ZwuZaNyuve"><img src="https://img.shields.io/badge/Discord-join-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  <a href="LICENSE-MIT"><img src="https://img.shields.io/badge/License-MIT%20OR%20Apache--2.0-3FB950?style=for-the-badge" alt="License"></a>
</p>

> **Turn your ideas into apps you can prove.**
>
> Describe what you want to build. Prism AI Foundry builds it, proves it, and publishes it to a live URL.

AI can take you from prompt to production in minutes. What it can't tell you is whether the app does what you asked. A preview shows that it worked once. Tests show that it worked for the cases someone thought of.

Prism AI Foundry adds the step that settles it: **formal verification**. Every rule your app promises is proved mathematically, for every possible input, before it can go live. Not tested. Proved.

Building and previewing run in your browser, with no install and no sign-in. Publishing happens on your device too: the app becomes a holo, named by its contents, that you share as a file or a link. Proving does too: Lean's kernel, compiled to WebAssembly, proves an app's rules in your tab, and no server takes part. An app that keeps state between requests is still proved on a hosted verifier.

<p align="right">(<a href="#top">back to top</a>)</p>

## How it works

The same flow you already know, with one more step.

| Step | You | Prism AI Foundry |
|---|---|---|
| **1. Describe** | Say what you want, in plain words | Writes the app and the rules it must follow |
| **2. Iterate** | Chat, tweak, preview | Checks the rules are complete and consistent |
| **3. Prove** | Approve the rules | Proves every rule in Lean, for every input |
| **4. Publish** | Share one link | Ships the app with its proof inside, as one file named by its contents |

Edit anything after it is proved and Prism AI Foundry returns to step 2. The proof badge always describes the app you have, never an older version.

<p align="right">(<a href="#top">back to top</a>)</p>

## Why proof matters

| | Typical AI app builder | Prism AI Foundry |
|---|---|---|
| You describe | An app | An app |
| You get | Code that seems to work | Rules proved for every input |
| "Done" means | The preview looked right | The proof passed |
| After an edit | Hope nothing broke | Re-proved before it can ship |
| Network access | Whatever the code does | Off until you grant it |
| Why you trust it | It ran once | Anyone can verify it |

<p align="right">(<a href="#top">back to top</a>)</p>

## Start building

```
Open https://uor-foundation.github.io/foundry/ in any modern browser.
```

Type your first prompt. The model starts in your browser and the preview appears beside the chat. When you are ready, choose **Publish**.

Want to see the proof engine on its own? The [kernel page](https://uor-foundation.github.io/foundry/app/) runs the core that decides when an app may move to the next step and what it may access. Before it answers, it checks that the bytes are authentic, the proof is attached, and every example gives its proved answer. Type `drafting check` and it answers `checked`.

<p align="right">(<a href="#top">back to top</a>)</p>

## What's inside

| Part | What it is | Where |
|---|---|---|
| Studio | The app builder: chat, preview, publish | [`studio/`](studio/) |
| Kernel | The proved core that governs every step | [`app/`](app/) |
| Promises | Every rule, registered with a scenario and a test | [`model/`](model/), [`features/`](features/) |

<p align="right">(<a href="#top">back to top</a>)</p>

## What Prism AI Foundry proves about itself

Prism AI Foundry holds itself to the same standard. Lean proves each of these for every request:

| Promise | ID |
|---|---|
| Never says proved without a proof | FK-01 |
| Never publishes an unproved app | FK-02 |
| Every edit sends the app back to drafting | FK-03 |
| Never proves rules that skipped the check | FK-04 |
| With no grant, only Prism AI Foundry itself may act | FK-05 |
| With no grant, nothing reaches the network | FK-06 |
| A denial always wins | FK-07 |
| A preview or published app needs an explicit grant | FK-08 |
| A preview never fetches without a grant | FK-09 |

<p align="right">(<a href="#top">back to top</a>)</p>

## Verify it yourself

Every published app is one file, a holo, that holds the app, its rules, its proof, and how it was built. Its name comes from its contents, so changing one byte changes the name. Open any holo on any device with [`holo.html`](https://uor-foundation.github.io/foundry/holo.html), or check one offline:

```bash
npx prism-code inspect app/.prism/build/*/*.holo
```

Words used here:

* **Formal verification** is proving code correct with mathematics.
* **Lean** is the proof checker that does it.
* **Holo** is a self-verifying app in one file.
* **Grant** is your explicit permission for one action.

<p align="right">(<a href="#top">back to top</a>)</p>

## Build from source

You need Git, Docker with Buildx, and a devcontainer client.

```bash
git clone https://github.com/UOR-Foundation/foundry
cd forge
# open in the devcontainer, then:
just vv      # the whole gate: format, model, lint, tests, audits, proved build
```

No Docker? Push a commit. [`build.yml`](.github/workflows/build.yml) builds on GitHub and hands back a signed holo, which you verify instead of trusting:

```bash
npx prism-code build --remote github
```

| Command | What it does |
|---|---|
| `just vv` | The whole gate, the same locally and in CI |
| `just app` | Build and verify the holo |
| `just new-capability <ID> <level> <suite> "<statement>"` | Add a promise with its scenario and failing test |
| `just model-write` | Regenerate `CONFORMANCE.md` |

The studio builds on its own lane: see [`studio/README.md`](studio/README.md).

<p align="right">(<a href="#top">back to top</a>)</p>

## Contributing

A change is done when it can prove itself.

1. Read [AGENTS.md](AGENTS.md). It is short.
2. Add a promise with `just new-capability`.
3. Make its test pass, then plant the bug it should catch and watch it fail.
4. Run `just vv` until it is green.
5. Open a pull request that says why the change matters.

Spend time and compute only on what changed. Work whose inputs did not change is referenced by its content address and reused, never redone: a new workflow either filters by path, keys its output by `hashFiles(...)`, or states why it must run every time. `just vv` checks this (`audit-reuse`).

Only Prism is implemented. Behavior is written in the Prism model (`*.lex.tex`); hand-written Rust, TypeScript, JavaScript, Python, shell, CSS and HTML may only shrink. `audit-prism`, part of `just vv`, measures them against the parent commit and refuses a new non-Prism file or any net growth in non-Prism lines, so every removal lowers the ceiling for good.

<p align="right">(<a href="#top">back to top</a>)</p>

## Documentation

| Document | What is inside |
|---|---|
| [Spec](openspec/specs/forge-kernel/spec.md) | Every promise, with its reason and example |
| [Conformance](CONFORMANCE.md) | The generated list of claims |
| [Agent rules](AGENTS.md) | The six rules and the order of work |
| [Verification](VERIFICATION.md) | What the gate accepts |
| [Template contract](TEMPLATE-CONTRACT.md) | Inherited policy files |
| [Identity](identity/README.md) | Passkey sign-in with no server to trust |

<p align="right">(<a href="#top">back to top</a>)</p>

## Community and acknowledgments

Join the [Discord](https://discord.gg/ZwuZaNyuve), or open an issue on GitHub. Prism AI Foundry is built with [PrismPM](https://github.com/UOR-Foundation/PrismPM), [LexLean](https://github.com/UOR-Foundation/LexLean) and [prism-code](https://www.npmjs.com/package/prism-code), on the work of the [UOR Foundation](https://uor.foundation/), and opens in the same frame as [Hologram OS](https://github.com/Hologram-Technologies/hologram-os).

## License

Licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE).

---

<p align="center"><i>Describe it. Prove it. Share it.</i></p>
