# M10-R8 Offline Runtime Verification

Date: 2026-08-04

## Outcome

SiteCapsule now has two explicit archive runtime modes:

- Static snapshot is the default. Executable page scripts remain frozen for the most predictable
  offline result.
- Offline animations and interactions is an experimental opt-in. Saved page scripts can run under
  an archive Content Security Policy that blocks external origins and limits runtime capabilities to
  local archive resources.

The opt-in is intentionally not the default. Running arbitrary application code can re-enable
client-side routers, dynamic data dependencies, computed URLs, workers, WebSocket clients, and
backend calls that cannot be reconstructed by a single-page archive.

## Implementation Evidence

- The archive CSP is installed after removing source-site CSP metadata. Static and interactive
  policies are separate and auditable through `data-sitecapsule-offline-policy`.
- Known inline analytics, consent, payment, and tracking loaders are frozen even in interactive mode.
- Saved JavaScript rewrites statically resolvable imports, dynamic imports, workers, `importScripts`,
  `fetch`, `Request`, and `new URL` references to archive-relative paths.
- The versioned Side Panel to Background to Content protocol carries the runtime selection into the
  final HTML rewrite.
- Speculative preload hints are removed in both modes.

## Browser Verification

The deterministic Chromium extension E2E creates a ZIP from a page with an external
`requestAnimationFrame` script and an inline tracking loader. It proves that:

1. the external script resource reaches the persisted job as `saved`;
2. the ZIP contains the rewritten local script;
3. the tracking loader uses the disabled script type;
4. the extracted `file:` archive executes the saved script and advances its animation frame; and
5. the offline page emits no HTTP, HTTPS, WS, or WSS requests.

Result: 5 extension E2E cases passed; the public acceptance case was skipped outside its dedicated
environment.

## United Carriers Observation

An interactive United Carriers archive was also opened through a loopback HTTP server. The document
retained its title and long-form body, exposed six canvases, loaded local images, accepted scrolling,
and ran archived JavaScript. This demonstrates that packaged animation runtimes can execute, but it
is not a claim of pixel-perfect parity. The application still attempted same-origin analytics and
backend endpoints, including a CSRF route, which are unavailable in an offline archive. Known
tracking loaders are now selectively frozen, while application-specific backend behavior remains a
documented limitation.

## Automated Gates

- ESLint: passed
- TypeScript: passed
- Vitest: 74 files, 655 tests passed
- Playwright extension E2E: 5 passed, 1 public-only case skipped
- Production Chrome MV3 build: 1.56 MB, no install-time `host_permissions`

## Remaining Boundary

Interactive mode improves animation and client-side interaction fidelity when all required scripts
and assets are statically discoverable. It does not reproduce servers, authenticated APIs, live
feeds, arbitrary computed requests, route trees outside the captured page, closed Shadow DOM,
ephemeral Blob state, or every Canvas/WebGL runtime. These cases remain eligible for visible
degradation and are not represented as fully solved.
