# M10-R6 Complex-Site Offline Acceptance

Date: 2026-08-04

## Scope

This run exercises the real Chrome MV3 extension pipeline against three public sites with distinct
resource shapes: a multi-origin Webflow/WebGL page, a hydrated documentation site, and a Three.js
manual page. Each case creates and downloads a real ZIP, audits every archived HTML/CSS resource
reference, opens the extracted `index.html` in a strictly offline Chromium context, records network
requests, and compares online/offline structure and screenshots.

The reproducible command is:

```bash
pnpm test:r6-acceptance
```

The checked-in baseline is `tests/baselines/r6-complex-sites.json`. Raw reports, screenshots,
downloads, and extracted archives are written under `test-results/public-acceptance/<run-id>/` and
are intentionally excluded from Git.

## Result

The final unified run `2026-08-04T050038-254Z` produced three ZIPs with no integrity failure,
external request, extension-protocol request, or missing local file request:

| Case | ZIP bytes | Entries | ZIP audit | Strict offline | Visual result |
|---|---:|---:|---|---|---|
| United Carriers | 25,999,983 | 445 | Pass | 0 external / 0 extension / 0 missing | Allowed degradation, score 0.632 |
| TypeScript docs | 4,637,664 | 125 | Pass | 0 external / 0 extension / 0 missing | Pass, score 1.00 |
| Three.js fundamentals | 474,278 | 17 | Pass | 0 external / 0 extension / 0 missing | Allowed degradation, score 1.00 |

The final run includes the local-CSS fix. Its United Carriers archive passed integrity and
strict-offline checks with zero external, extension, or missing-local requests. Manual screenshot
review confirmed that the offline page retains the dark theme, custom font, navigation, content
hierarchy, and principal hero composition. The original screenshot was captured during the site's
branded loading state, so its automated continuity score is not treated as exact pixel equivalence.

## Product Changes Proven

- Uncaptured resource references are removed or neutralized instead of silently retaining HTTP,
  HTTPS, Blob, or unsupported dependencies.
- Executable scripts in the offline entry are frozen after final-DOM capture; JSON data scripts and
  packaged script files remain available for inspection.
- Preconnect, prefetch, prerender, and module-preload hints are removed so a static snapshot cannot
  start background network work.
- Rewritten local resources no longer retain source-origin `integrity` or `crossorigin` attributes
  that would block modified CSS, fonts, or scripts under a local origin.
- The acceptance harness rejects missing archive metadata, failed ZIP integrity, external network
  traffic, extension-protocol traffic, and missing local file requests.

## Accepted Degradation

Canvas and WebGL pixel state is not represented by serialized DOM. United Carriers therefore keeps
its static hero composition but not a live GPU scene, and the Three.js manual retains captured
content without executing its interactive examples. Backend APIs, client routing, form submission,
live data, and source-site interactions are outside the current-page archive contract.

These are explicit limitations, not silent success: ZIP integrity and network isolation must still
pass, while dynamic behavior is reported as allowed degradation.
