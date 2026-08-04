# M10-R7 public acceptance rerun

## Result

The fixed 23-site public baseline was rerun in isolated Chromium 151.0.7922.34 against commit
`35b24f7b962b706d09a6d1bb07d07626d33f5666`. Of 23 cases, 22 were reachable and one
(Smithsonian) was externally unavailable. Twenty-one reachable cases produced a real ZIP that
passed archive integrity and offline browser verification; NASA did not finish within the fixed
120-second capture limit.

| Classification | Count |
| --- | ---: |
| Pass | 12 |
| Allowed degradation | 9 |
| Product failure | 1 |
| External unavailable | 1 |
| Total | 23 |

The 21 completed ZIPs contain 1,157 entries and 40,612,426 bytes in total. Every ZIP contains
`index.html`, `_sitecapsule/report.html`, the four JSON manifests, and the offline README. Static
audits found 941 local-present references and zero missing local, external-network, extension-
protocol, unsupported-protocol, or invalid blocking references. Offline Chromium observed zero
external requests, zero extension requests, and zero missing local requests for every completed
archive.

## R7 corrections

- Next.js `link[rel=preload][imagesrcset]` candidates now use the same discovery, download,
  rewriting, and integrity-audit path as ordinary `srcset`. The React case changed from one missing
  local request to zero and passed offline verification.
- A timed-out case is actively cancelled before the next baseline case starts. NASA remains an
  honest product timeout, while the following Library of Congress case now independently archives
  and passes offline verification.

## Evidence and limits

- Run ID: `2026-08-04T103008-427Z`
- Raw ignored evidence: `test-results/public-acceptance/2026-08-04T103008-427Z/`
- Machine report: `test-results/public-acceptance/2026-08-04T103008-427Z/report.json`
- Settings: 5,000 ms render wait, concurrency 6, media off, archive-critical third-party resources
  on, 1440 x 900 viewport
- Visual continuity scores are diagnostic only. They do not establish the PRD's 95 percent
  critical-visual completeness metric.
- NASA remains a bounded large-page failure and is not reclassified as external unavailability.
