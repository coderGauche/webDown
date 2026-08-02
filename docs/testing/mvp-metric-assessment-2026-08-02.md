# M10-T3 MVP metric assessment

## Decision

The current build does **not** meet the PRD MVP release gate. It remains suitable for restricted
engineering trials, but it must not be presented as having met all MVP metrics.

This assessment uses the complete M10-T1 fixed set attempted by M10-T2. The one externally
unavailable Smithsonian case is excluded from product-rate denominators: 22 cases were reachable,
18 produced ZIP files, and 4 did not produce a usable archive result.

## PRD metrics

| Metric                                     |       Target |                                    Result | Status           | Release effect   |
| ------------------------------------------ | -----------: | ----------------------------------------: | ---------------- | ---------------- |
| Basic-site archive success                 |       >= 90% |                          18 / 22 = 81.82% | Failed, P0       | Blocks release   |
| Marketing-page primary visual completeness |       >= 95% |                      No valid denominator | Not measured, P1 | Claim blocked    |
| Broken local-resource request rate         |        <= 5% |      No local request/failure denominator | Not measured, P1 | Claim blocked    |
| Single-resource failure explainability     |         100% | Unit path exists; runtime evidence absent | Not measured, P0 | Claim blocked    |
| User cancellation response                 | <= 2 seconds |     Functional only; latency not measured | Not measured, P1 | Claim blocked    |
| Archive report generation                  |         100% |                               0 / 18 = 0% | Failed, P0       | Blocks release   |
| Content uploads to product server          |            0 |              0 product-server paths found | Passed, P0       | No blocker found |

The machine-readable assessment is `tests/baselines/mvp-metrics.json`; its test prevents a missing
measurement from being converted into a pass and recomputes percentage denominators.

## Blocking deviations

### P0: archive success is below target

The reachable-case rate is 81.82%, 8.18 percentage points below the 90% target. MDN, Next.js, and
Wikipedia reached a completed task but did not surface the downloadable result within 120 seconds.
NASA remained in downloading for 120 seconds. These four cases are product failures regardless of
the separately recorded TypeScript offline navigation defect.

Release decision: fix completed-job result delivery and bound or resumably handle long downloads,
then rerun all 23 fixed cases. At least 20 of the 22 reachable cases must produce valid ZIP files to
meet 90% (`ceil(22 * 0.90) = 20`).

### P0: runtime archives omit the report

All 18 downloaded ZIPs lacked `_sitecapsule/report.html`; the observed generation rate is 0%.
Report and manifest builders are unit tested, but `entrypoints/background.ts` packages only
`index.html` and saved assets. This is an integration gap, not a test-data problem.

Release decision: runtime packaging must include `_sitecapsule/archive.json`, `resources.json`,
`failures.json`, `original-urls.json`, `report.html`, and `README_OFFLINE.md`. A controlled failed
resource must then prove that the counts and structured error agree with the ZIP contents.

## Measurement gaps

- Visual completeness needs critical visual resources or screenshot regions defined per relevant
  marketing case. Nonblank screenshots and loaded-image counts do not establish 95% fidelity.
- Local failure rate needs all offline local requests and failed local requests, not only the 167
  attempted external requests currently retained by M10-T2.
- Explainability needs a runtime ZIP containing a failure manifest and report. Unit tests alone do
  not establish a 100% delivery rate.
- Cancellation needs a delayed fixture and a browser measurement from cancel click to visible
  `cancelled` state. Functional AbortController tests do not prove the two-second target.
- The zero-upload result is supported by source and production-package inspection: the runtime has
  no product endpoint, beacon, XHR, or WebSocket upload path, and the only background fetch retrieves
  the discovered resource URL. A release-time Service Worker network audit remains required.

## Evidence

- Public result: `docs/testing/public-acceptance-2026-08-02.md`
- Raw ignored evidence: `test-results/public-acceptance/2026-08-01T162528-376Z/`
- Tested baseline commit: `40e30dd5158f82d578cf847fa26480f5c43d59fc`
- Assessment source: `tests/baselines/mvp-metrics.json`

M10-T4 may document these limits, but M10-T5 must not be treated as a releasable MVP package until
the two failed P0 metrics are corrected and the fixed set is rerun.
