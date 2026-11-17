# App covers

Authority: `FA-28` in `model/ids.toml`, scenario `features/suites/app-covers.feature`.
Every app card in the gallery showed the first letter of the app's name: the browser host never answered
`app:list-thumbnails`, and a preview served in the worker's sandbox has an opaque origin the page cannot
read. FA-28 gives each app a cover taken from its own preview and a card sentence and tag written by
the visitor's model.

The capture runs inside the preview. `studio/shell/covers.mjs` adds the renderer's locked
`html-to-image` (copied beside the renderer by `scripts/stamp_shell.py`) and a responder to every
preview the host builds and to the live frame. When a preview is ready and its version has no cover,
the host loads it once more in a transparent 1280 by 640 frame, asks it for a picture, and accepts an
answer only from that frame's own window. A near-uniform frame is blank: it is asked once more after
2.5 s and otherwise yields no cover. Passing elements (toasts, cookie bars, small fixed elements low on
the screen) are hidden first. The cover is stored as a 1600 by 800 WebP in the page's `covers` cache
with the version it shows, so a new version is captured again and an unchanged one is not.

The card's words are asked once per app through this origin's own `v1/chat/completions`, so the
request is routed, sealed and paid as a turn is. They are stored only when the sentence is 84 to 92
characters, ends with a period and uses no technical or praising word, and the tag is one of the fixed
list; a refused answer is asked again once with its reasons. The renderer's `AppShowcaseCard` and
`useAppThumbnails` are replaced (`vendor/prism/hologram.screens/`) to read the cache and draw the card:
the cover at 2:1, the name, the tag, and the sentence held to exactly two rows.

The registered ID, scenario and failing test preceded the conformance oracle. Eight Node controls cover
the sentence band, the final period, technical and praising words, the tag list, reading an answer
through prose, fences and thinking, the retry message, blank detection and responder placement.
Chromium serves a preview under the worker's own policy text (read from `sw.template.js`) and checks
the picture crosses the sandbox, the toast is hidden, the cover is a 1600 by 800 WebP, a blank preview
and a preview without the responder yield no cover, and a second frame answering every request id with
a valid picture of its own is ignored.

Mutation: dropping the `e.source !== frame.contentWindow` check makes
`node studio/tools/covers_browser.mjs` fail with `forged: 'accepted'`; dropping the technical word check
makes `node --test studio/tools/covers.test.mjs` fail on "technical words and praise are refused".
Restoring each passes. A capture first placed the frame off screen; Chromium stops rendering such a
frame and the capture never answered, which the browser check caught before the frame was moved into
the viewport at zero opacity.

This is not a judgement of what an app is: the words are the model's, checked only for form. A cover
exists only for an app whose preview has been opened since this change, in the browser that opened it;
covers do not travel between devices. The card call costs one short model request per app.
