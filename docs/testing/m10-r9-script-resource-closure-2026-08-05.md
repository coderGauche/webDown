# M10-R9 Script Resource Closure - 2026-08-05

## Scope

This regression started from the user archive
`downloads/sitecapsule-unitedcarriers.com-20260805/` with offline animations and interactions enabled.
The source page was compared with `https://unitedcarriers.com/`; the user archive itself was not
modified or committed.

## Root cause

- Saved same-directory ES modules were emitted as bare specifiers such as
  `chunk-J3PPETVR.js` and `rolldown-runtime-QTnfLwEv.js`. Chromium rejects them because local module
  references require `./` or `../`.
- Vite/Rolldown lazy dependencies were stored in generated string tables and an interpolation-free
  template `import()`. The old AST visitor handled only ordinary import literals, leaving a missing
  `chunks/Home-*.js` request.
- The page stores hundreds of AVIF frame URLs inside a JSON string passed to `JSON.parse`. A one-second
  Performance snapshot observed only the frames requested at capture time, so later scroll frames were
  neither downloaded nor rewritten.
- Runtime asset strings assigned to `Image.src` resolve against the document, while module imports
  resolve against the importing script. Treating both as script-relative produced a valid file in the
  ZIP but the wrong runtime URL.

## Implementation

- JavaScript archive references now preserve valid relative module syntax and prefix same-directory
  module targets with `./`.
- Static Vite/Rolldown dependency-table strings and interpolation-free template literals are parsed,
  while ordinary text, empty strings, and extensionless routes are excluded.
- Static resource URLs nested in valid `JSON.parse` data are discovered and rewritten structurally.
- Background performs at most eight script-dependency rounds and reuses existing host permission,
  concurrency, retry, byte-budget, pause/cancel, redirect, and network-safety controls.
- Module references remain script-relative; embedded runtime asset references are relative to the root
  `index.html`.

## Verification

- Unit coverage includes ordinary imports, same-directory and parent-directory references, generated
  dependency maps, template imports, non-resource strings, and `JSON.parse` asset data.
- A copied United Carriers archive removed the bare-module and missing Home chunk errors. Chromium
  reported the Lenis runtime class, scrolled from 0 to 1,800, and 441 of 2,000 observed elements changed
  computed transform, opacity, or visibility state.
- The extension E2E fixture embeds an SVG URL in JSON but deliberately does not request it on the live
  fixture page. The final test proves crawler discovery, incremental download, ZIP inclusion, JSON local
  rewriting, offline `Image.onload`, continuing animation frames, and zero external requests.

## Remaining boundary

Computed URLs assembled from runtime state, extensionless implicit assets, backend APIs, WebSockets,
client-side routes, closed Shadow DOM, and source-session Canvas/WebGL state are not claimed as generally
reconstructable. They remain visible experimental-mode limitations.
