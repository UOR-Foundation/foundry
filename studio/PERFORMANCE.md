# Performance

What the shell costs a visitor, measured before and after the work on branch `forge-ux-perf`, and what is still open. The Performance gate (`tools/perf_budget.mjs`, row in `VERIFICATION.md`) holds the result. Its budgets are the Forge kernel's (FK-12 to FK-15), not a file of this tree: see "What the kernel decides" below.

## How it was measured

- The shell built from this tree, served under `/foundry/` by a stand-in for Pages: `404.html` for any other path, gzip, ETag, `max-age=600`.
- The baseline is the same build at `origin/forge-ui-shadcn` (6a6dd9b), served the same way.
- Chrome 157 was driven by Playwright (playwright-core) on a Windows workstation.
- Desktop profile: 1440x900, no throttling.
- Mobile profile: 390x844, DPR 3, touch, CPU slowed 4x through CDP, and Slow 4G as Lighthouse applies it (562 ms RTT, 1474 kbps). The throttling is done at the server, through one shared link, because CDP throttling misses the service worker's own fetches.
- LCP, CLS, long tasks and event timing come from PerformanceObservers. INP is the longest event with an interaction id in the journey.
- TBT is the sum of each long task's time over 50 ms.
- V8 compile and evaluation times come from a Chrome trace.
- Heap is `JSHeapUsedSize`.
- First token: the provider is mocked (Featherless's endpoint answers a canned stream at once), so the number is Forge's own path from Enter to the first token on screen. Photos are answered locally with the same bytes every run.
- Loads are medians of three runs. Interactions are one run each, and single runs are noisy: two desktop baseline rows ("appearance to Dark", "route to Settings") each caught one stray 1 to 2 s task.
- Playwright's request routing turns off Chrome's HTTP cache. In real Chrome, the warm load's background revalidation of `assets/index.js` is a 304. Paint never waits on it.
- The desktop baseline "Apps search" CLS (0.171) came from a programmatic fill, which Chrome does not count as input. The after run types like a person, so that row is not comparable.
- On a phone, the "open app (chat)" done condition (a visible Code control) is never met in either build, so that row has no response time.

## Desktop (1440x900, no throttling)

Loads, medians of three runs:

| Journey | LCP ms | FCP ms | TBT ms | Longest task ms | CLS | V8 compile ms | Script eval ms | JS heap MB |
|---|---|---|---|---|---|---|---|---|
| cold load | 1576 → 1336 | 832 → 792 | 346 → 192 | 259 → 174 | 0.011 → 0.011 | 147 → 123 | 419 → 243 | 63.1 → 36.7 |
| warm load | 460 → 300 | 52 → 48 | 45 → 30 | 95 → 80 | 0.044 → 0.045 | 46 → 55 | 178 → 87 | 62.8 → 66.2 |

Interactions, one run each (response = in-page time from the press to the journey's own done condition on a frame):

| Journey | Response ms | INP ms | TBT ms | Long tasks | CLS |
|---|---|---|---|---|---|
| type first prompt | 443 → 49 | 320 → 64 | 136 → 0 | 1 → 0 | 0 → 0 |
| open dropdown (model picker) | 81 → 85 | 112 → 112 | 0 → 0 | 0 → 0 | 0 → 0 |
| open dialog (Import App) | 67 → 73 | 80 → 88 | 0 → 0 | 0 → 0 | 0 → 0 |
| toggle sidebar (click) | 37 → 34 | 24 → 24 | 0 → 0 | 0 → 0 | 0 → 0 |
| toggle sidebar (Ctrl+B) | 26 → 14 | 32 → 16 | 0 → 0 | 0 → 0 | 0 → 0 |
| appearance to Dark | 1080 → 43 | 0 → 32 | 998 → 0 | 1 → 0 | 0 → 0 |
| appearance to Light | 47 → 42 | 40 → 32 | 0 → 0 | 0 → 0 | 0 → 0 |
| appearance to Immersive | 44 → 42 | 48 → 32 | 0 → 0 | 0 → 0 | 0 → 0 |
| route to Apps | 160 → 145 | 208 → 40 | 51 → 29 | 1 → 1 | 0 → 0 |
| Apps search | 34 → 119 | 0 → 24 | 0 → 0 | 0 → 0 | 0.171 → 0 |
| Apps select row | 51 → 29 | 32 → 24 | 0 → 0 | 0 → 0 | 0 → 0 |
| open app (details) | 132 → 105 | 144 → 32 | 26 → 0 | 1 → 0 | 0 → 0 |
| open app (chat) | 256 → 188 | 296 → 80 | 113 → 62 | 1 → 1 | 0 → 0 |
| tab Code | 264 → 118 | 48 → 40 | 0 → 0 | 0 → 0 | 0 → 0 |
| tab Publish | 66 → 343 | 40 → 32 | 0 → 0 | 0 → 0 | 0 → 0 |
| tab Preview | 101 → 85 | 64 → 56 | 0 → 0 | 0 → 0 | 0 → 0 |
| route to Settings | 1913 → 172 | 1832 → 32 | 1756 → 20 | 1 → 1 | 0 → 0 |
| Settings scroll, frames over 50 ms / worst frame | 0 / 22 → 0 / 17 | – | 0 → 0 | 0 → 0 | 0 → 0 |
| Enter to first streamed token (provider answers at once) | 2718 → 682 | 56 → 64 | 108 → 26 | 2 → 1 | 0.022 → 0 |

## Mobile (390x844, 4x CPU, Slow 4G)

Loads, medians of three runs:

| Journey | LCP ms | FCP ms | TBT ms | Longest task ms | CLS | V8 compile ms | Script eval ms | JS heap MB |
|---|---|---|---|---|---|---|---|---|
| cold load | 20216 → 9580 | 2744 → 2788 | 4450 → 1701 | 2126 → 1010 | 0.053 → 0.054 | 1140 → 524 | 3336 → 1053 | 69.8 → 38.5 |
| warm load | 11132 → 1792 | 1748 → 248 | 1729 → 1129 | 1071 → 823 | 0.102 → 0.103 | 78 → 445 | 1376 → 902 | 50.9 → 68.4 |

Interactions, one run each (response = in-page time from the press to the journey's own done condition on a frame):

| Journey | Response ms | INP ms | TBT ms | Long tasks | CLS |
|---|---|---|---|---|---|
| type first prompt | 334 → 203 | 144 → 88 | 68 → 1 | 2 → 1 | 0 → 0 |
| open dropdown (model picker) | 440 → 304 | 376 → 280 | 259 → 168 | 1 → 1 | 0 → 0 |
| open dialog (Import App) | 468 → 296 | 400 → 312 | 213 → 119 | 1 → 1 | 0 → 0 |
| toggle sidebar (click) | 647 → 372 | 504 → 272 | 391 → 180 | 1 → 1 | 0 → 0 |
| appearance to Dark | 172 → 159 | 152 → 120 | 24 → 29 | 1 → 1 | 0 → 0 |
| appearance to Light | 216 → 248 | 152 → 144 | 44 → 68 | 2 → 2 | 0 → 0 |
| appearance to Immersive | 421 → 186 | 264 → 144 | 164 → 41 | 3 → 2 | 0 → 0 |
| route to Apps | 2703 → 1396 | 968 → 168 | 1696 → 463 | 5 → 4 | 0 → 0 |
| Apps search | 567 → 419 | 136 → 96 | 141 → 36 | 5 → 4 | 0 → 0 |
| Apps select row | 187 → 152 | 120 → 104 | 47 → 39 | 1 → 1 | 0 → 0 |
| open app (details) | 595 → 718 | 400 → 200 | 324 → 328 | 1 → 4 | 0.005 → 0.005 |
| open app (chat) | not reached → not reached (harness condition, see below) | 1144 → 984 | 1302 → 1051 | 7 → 5 | 0 → 0 |
| tab Code, Publish, Preview | not measured on a phone: the harness found no visible Code control (before: the squeezed split; after: inside the Preview tab) | | | | |
| route to Settings | 2038 → 2511 | 920 → 360 | 1060 → 1118 | 3 → 6 | 0 → 0 |
| Settings scroll, frames over 50 ms / worst frame | 0 / 17 → 0 / 22 | – | 200 → 0 | 2 → 0 | 0 → 0 |
| Enter to first streamed token (provider answers at once) | 4772 → 2828 | 128 → 168 | 1529 → 1559 | 11 → 19 | 0.035 → 0.296 |

Bundle, from Vite's chunk graph:

| | Before | After |
|---|---|---|
| Entry `assets/index.js` | 5,225 KB (1,384 KB gzip) | 2,003 KB (618 KB gzip) |
| JS for home (entry and its static imports, gzip -9) | the entry, about 1.3 MB | 603 KB |
| JS for the chat route (with the entry) | in the entry | 913 KB |
| Third-party bytes on a home load | 914 KB: Monaco 747 KB from cdn.jsdelivr.net, PostHog x3, the photo | 158 KB: the photo |
| Worker install on a first visit | the whole 15.5 MB closure before it activates | the first-paint files, and the rest when idle |

What left the first load is shiki's 18 grammars (1.3 MB raw), four locales (391 KB), PostHog (189 KB), every page but home, and every preview panel but Preview. What is still in it is react-dom (532 KB raw), framer-motion and motion-dom (340 KB), zod (169 KB), lexical (187 KB), Prism's IPC contracts (183 KB), the markdown pipeline (about 300 KB) and the English locale.

## Findings, ranked by effect on perceived latency

Each finding gives the screen, viewport and appearance, the problem, the fix and the gain. "Fixed" means changed here and measured above. "Open" means it is not done, and the reason is given.

1. Fixed. Every screen, mobile, all appearances. One 5.2 MB script was parsed before the first paint, so the cold mobile LCP was 20.2 s with 4.45 s of TBT. Fix: route and panel split, with lazy grammars, locales and Monaco, and PostHog removed (`vendor/prism/hologram.lean.mjs`). Gain: LCP 20.2 to 9.6 s, TBT 4.45 to 1.70 s, longest task 2.1 to 1.0 s, compile and evaluation 4.5 to 1.6 s.
2. Fixed. Every screen on a repeat visit, both viewports. The worker revalidated the renderer with the network every time, and navigations went to the network too, so warm mobile LCP was 11.1 s. Fix: the worker serves navigations from the closure, puts the entry in its cache at install, and serves it stale-while-revalidate. Hashed chunks are kept for good. Pages still reload once when a newer shell is out. Gain: warm LCP 11.1 to 1.8 s on mobile, 0.46 to 0.30 s on desktop.
3. Fixed. Home to chat, both viewports. Enter waited Prism's 2,000 ms settle, and creating an app took about 190 IndexedDB round trips. Fix: settle 0 (Prism's test mode value), one transaction for an app's files, key-range reads, and the scaffold's objects stored once per page. Gain: Enter to first token 2,718 to 682 ms on desktop, 4,772 to 2,828 ms on mobile. `create-app` went from about 2 s to 107 ms.
4. Fixed. First visit, mobile. The worker installed 15.5 MB (the Q engine, Hollama and the photos) while the page loaded, and could not activate until it finished. Fix: install only the first-paint files, then fill the rest at idle with low priority. Each filled file is checked against its manifest SHA-256 before it joins the closure.
5. Fixed. Every load, both viewports. Monaco (747 KB) was fetched from cdn.jsdelivr.net with no editor on screen. Prism's PostHog project was contacted three times, receiving the visitor's IP even with telemetry off. Fix: Monaco's loader now runs on the first editor, and PostHog is a client that sends nothing. Gain: 756 KB and four third-party connections less per load, and no visitor data reaches Prism.
6. Fixed. Chat, mobile, all appearances. Chat and preview were squeezed side by side (95 px each), and the panels animated their width. Fix: one pane at a time under 768 px, now upstream's MobileBuild (merged from main) shown when the kernel answers `tabs` (FK-16, FK-17), and no width animation.
7. Partly fixed. Chat, mobile, all appearances. The split made the first prompt shift Home under the visitor while the chat chunk arrived (CLS 0.29). Fix: Home preloads the chat chunk when idle. Measured 0 in a fresh profile and on desktop. Still open on a phone that already has apps: CLS 0.296 in the harness, because Home re-renders for a few frames at `/chat` before the chat page mounts. The cause is not found.
8. Fixed. Sidebar, mobile. A link chosen in the Sheet left it open over the page, and the first Escape closed an invisible tooltip instead of the Sheet. Fix in `hologram.screens/AppSidebar.tsx`. Measured: one Escape closes it, and navigation closes it.
9. Fixed. Code and Publish tabs, desktop. The first switch paid a chunk fetch after the split (Code 374 ms, Publish 345 ms). Fix: the panels are preloaded when the chat page is idle. Code is now 118 ms. Publish stays at 343 ms, which may be the publish section's own work on mount; this was not separated.
10. Fixed, gain inferred. Streaming, both viewports. Every streamed delta re-walked the whole answer and redrew the message. Fix: coalesced to one update per animation frame. Not measured on its own, because the mocked stream arrives in one network chunk.
11. Open. Templates, both viewports. The page lists nothing. I answered `get-templates` with the React template every app is created from, but main's Foundry specification (FA-15, `unavailableBrowserQueries`) declares that query unavailable, so the host answers a typed unsupported error by design. Whether Templates should list the one scaffold is that model's decision; the handler was withdrawn in the merge.
12. Fixed. Apps, mobile. Four stacked figure cards pushed the list off the first screen. They now sit two by two, without footnotes.
13. Fixed. Touch, mobile, all screens. Kit buttons, switches, checkboxes and sidebar items were 16 to 32 px. Each now answers a 44 px hit area on coarse pointers (`shell/appearance.css`), with the kit's look unchanged. Controls under 44 px in the audit: home 11 to 1, chat 19 to 3, details 11 to 0, settings 10 to 3.
14. Fixed. Motion. The Sheet slid for 300 to 500 ms; it now takes 200 ms. `prefers-reduced-motion` stopped only the composer's glow; the stylesheet now stops all CSS animation and transition for it. Open: framer-motion's JS animations do not read that preference.
15. Fixed. Home, both viewports. The idea chips were hand-styled `<button>`s. They are now the kit's outline Button.
16. Open. Preview toolbars, both viewports. Eleven raw `<button>`s remain in `PreviewIframe.tsx` and `PreviewToolbar.tsx`, and the Neon and Supabase cards on app details are still Prism's own. Not converted for lack of time; each needs a retag patch like item 15.
17. Open. First app creation, mobile. Addresses are BLAKE3 from the 3.6 MB Q-engine wasm, so the first `create-app` on a new visit waits for that download. A smaller BLAKE3 would change a claim `VERIFICATION.md` imports from holospaces, so it is not done here.
18. Open. Code tab. Monaco still comes from cdn.jsdelivr.net when an editor opens. It should be served from this origin (`loader.config` with the bundled `monaco-editor`) to keep the site self-contained.
19. Open. Settings. Prism's Telemetry switch now changes nothing and should be removed.
20. Open. Cold load, mobile, CLS 0.05: Home's hero re-centres when the featured apps arrive. Warm load, CLS 0.10: the same, plus the sidebar's app list. Both are unchanged from the baseline.
21. Open. Settings, mobile, first visit to the page: 2.0 to 2.5 s in both builds, now partly the chunk's parse at 4x CPU.
22. Open. Home's remaining first load is 603 KB gzip. Most of it is libraries every screen uses: react-dom, framer-motion, zod, lexical and the markdown pipeline. The next step would be loading lexical and the markdown pipeline with the composer and the chat. Not attempted.

## What was not verified

- Real model latency. Cloud first token through Featherless or OpenRouter was not measured, because it would spend the site's shared key. The local model (BitNet 2B over WebGPU) was not measured either: its download and WebGPU were not run headless. The first-token numbers above are Forge's own path, with the provider answering at once.
- `visualViewport`: whether the composer stays above an on-screen keyboard. Headless Chrome shows no keyboard.
- WCAG contrast. The audit resolves every colour, including oklch, through a canvas and compares text against its first opaque background. It found 1 or 2 low-contrast text runs on mobile chat in Dark and Light, and none elsewhere. Text over Immersive glass is skipped, because its background is a photo. This is a heuristic, not a full audit.
- Cmd/Ctrl+K: not exercised. Cmd/Ctrl+B and Enter were.
- Other browsers. Everything was measured in Chrome. Safari and Firefox were not run.
- CI. The browser budgets were recorded on this workstation. A GitHub runner may be slower and need the budgets recalibrated on its first run.

## What the kernel decides

Foundry is a Prism app: its decisions are FK requirements in `app/src/ForgeKernel.lex.tex`, with theorems in `ForgeKernelProofs.lex.tex` that Lean proves for every request (`prismpm --project app verify`). The words the page shows stay in the View (`studio/src`). The kernel's guest runs in the page and in the worker, pinned by `KERNEL_REV`, and replays all 100 acceptance vectors before it answers anything.

| Rule | Kernel request and answer | Theorems (Lean) | Who asks |
|---|---|---|---|
| Performance budgets: mobile cold and warm LCP, INP, first token (ms; first token 5,000 since main's atomic project creation, measured 4.5 s); first-load JS per route (gzip KB) | `budget JOURNEY VALUE`: `within` or `over` | FK-12 never within when over, FK-13 never over when within, FK-14 INP budget at most 500 ms, FK-15 no route below the first load | the Performance gate, for every verdict; the numbers exist nowhere else |
| Chat and preview stack under 768 px | `layout WIDTH`: `tabs` or `split` | FK-16, FK-17 | the chat page, on load and on resize |
| Motion: at most 200 ms, none when reduced motion is asked | `motion MS REDUCED`: `allow` or `deny` | FK-18, FK-19 | the Experience gate, for every duration in `appearance.css` |
| Tap targets at least 44 px | `target PX`: `ok` or `small` | FK-20 | the Experience gate, for the touch hit area |
| "This week" on the Apps page: seven days | `recent SECONDS`: `yes` or `no` | FK-21 | the Apps page, for each date |

What stays outside the kernel, and why:

- Pixel layout, the hit area's CSS and the reduced-motion media query: a stylesheet cannot ask anything. They are adapters the Experience gate holds to the kernel's answers.
- The sidebar's active item and the breadcrumb trail: route matching is the router's, from its own route tree. A second copy in the kernel would be a second source.
- Which panels load lazily: a property of the build's chunk graph. The Performance gate measures it, through FK-12.
- The model ladder (warm-up and promote) and the sealed-answer cache: already decisions in the View model (`studio/src`, `Inference.warmup`, `Object.promote`, `Inference.route`), proved there. Moving them into the kernel was not attempted.
- The preview cache: admission is the kernel's gate already (FK-05 to FK-09).

## Hologram's lookup-table inference

Studied, not adopted. Hologram-Technologies/hologram's "O(1)" tables precompute 16-bit and 8-bit activation functions (128 KB per bf16 function) on the CPU, with bit-identical results. Matrix multiplication is still computed, and it dominates LLM decode on WebGPU. Its "KV-dispatch" reuses a graph's result for identical inputs, which Forge's sealed answers already serve faster. Its releases ship native binaries only. The npm packages (`@tryhologram/sdk`, `@tryhologram/wasm`) compile tensor graphs and are not an LLM runtime. Forge's Q engine wasm is byte for byte the one in Hologram-Technologies/hologram-apps. Nothing here would measurably cut Forge's first token, warm-up or cache. Adopting the inference code would also need a Git dependency, which R6 forbids. Nothing was measured in the browser, because there was no browser artifact to measure.
