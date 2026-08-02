# United Carriers archive forensic record

Date: 2026-08-03

Classification: release-blocking product defect

Sample: locally extracted `sitecapsule-unitedcarriers.com-20260803`

## Scope

This record describes the structure of the user-provided extracted archive without copying the
page body, third-party identifiers, public API keys, or injected extension identifiers into the
repository. The source sample remains an ignored local artifact under `downloads/`.

## Observed result

- The extracted archive contains only `index.html`.
- `index.html` is 437,769 bytes and represents the browser's final serialized DOM, not the site's
  authored source tree.
- It contains 326 `src`, `href`, or `poster` occurrences covering 228 unique values.
- 229 occurrences, covering 186 unique values, still use `http:` or `https:` network URLs.
- One reference was rewritten to an `assets/` path, but that file is absent from the extracted
  archive.
- One `chrome-extension:` script reference from another installed browser extension is present.
- The snapshot contains 21 script elements, 16 style elements, two iframe elements, and five
  canvas elements, including third-party analytics, consent, and payment runtime state.

The mostly compact, difficult-to-read HTML is an expected property of DOM serialization and is
not itself the release blocker. The release blockers are missing packaged resources, unresolved
network dependencies, browser-extension contamination, and a successful completion state that
does not disclose those conditions.

## Root causes

1. Third-party resource capture defaults to off. Most visual resources on this page are hosted on
   CDN or application origins different from the document origin, so they are deliberately marked
   skipped before download.
2. Packaging includes only resources that finished with both a saved body and a local path, but no
   final invariant checks that every rewritten local reference has a matching ZIP entry.
3. The final DOM snapshot can contain runtime nodes and URLs injected by consent/payment widgets or
   other browser extensions. The sanitizer currently focuses on sensitive form values, not archive
   ownership.
4. Runtime archive metadata and `report.html` are not yet connected to packaging, so the user
   cannot inspect saved, failed, skipped, external, or removed resources.

## Required outcome

The defect is resolved only when a real downloaded ZIP, not an in-memory model, demonstrates all
of the following:

- every rewritten local resource reference resolves to an entry in the ZIP;
- archive-critical cross-origin CSS, images, fonts, scripts, and media are explicitly authorized
  and downloaded, or are visibly reported as missing before download;
- opening the extracted archive offline produces no unexplained HTTP, HTTPS, WebSocket, or
  browser-extension request;
- extension-injected and unsupported volatile runtime nodes are removed or reported using general
  rules rather than a site-specific patch;
- `_sitecapsule/report.html` and structured metadata list saved, failed, skipped, removed, and
  unresolved resources;
- the Side Panel never presents a structurally incomplete archive as an ordinary successful
  completion.

## Release impact

M10-T6 and all public-release work remain paused. The existing `0.1.0` ZIP is still an engineering
candidate for controlled testing only. M10-R1 through M10-R7 must complete before the release
sequence resumes.

## Regression baseline

M10-R1 now reproduces this failure shape without retaining or requesting the original website:

- `tests/fixtures/archive-integrity-broken/index.html` expands to a final DOM larger than 100 KiB
  while its test ZIP contains only `index.html` and one resource;
- `auditArchiveOfflineIntegritySync()` scans the extracted ZIP's HTML, SVG, inline CSS, and
  standalone CSS resource-loading references;
- the fixture deterministically fails for missing local entries, residual network references, and
  extension-protocol contamination;
- ordinary anchor/area links and form actions are counted as navigation but excluded from resource
  integrity failures;
- a fully local counterexample passes, preventing a test that only knows how to reject archives.

This is a test red line, not the runtime fix. M10-R2 through M10-R5 must still change permission,
sanitization, packaging, and reporting behavior before real archives can pass it.
