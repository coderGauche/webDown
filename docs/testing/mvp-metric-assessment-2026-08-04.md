# M10-R7 MVP metric assessment

## Decision

The P0 engineering-candidate gate is ready. The complete fixed public set produced 21 valid ZIPs
from 22 reachable cases (95.45%), every completed ZIP contains its report and manifests, and the
observed public-site resource failure is fully explained. No failed P0 metric remains.

This does not approve a public release. Versioning, changelog/demo work, and user-supervised final
acceptance remain in M10-T6 and M10-T7. The 95% primary-visual and two-second cancellation claims
remain explicitly unmeasured.

| Metric | Target | Result | Status |
| --- | ---: | ---: | --- |
| Basic-site archive success | >= 90% | 21 / 22 = 95.45% | Passed, P0 |
| Marketing primary-visual completeness | >= 95% | No valid critical-visual denominator | Not measured, P1 |
| Broken local-resource references | <= 5% | 0 / 941 = 0% | Passed, P1 |
| Single-resource failure explainability | 100% | 1 / 1 = 100% | Passed, P0 |
| User cancellation response | <= 2 seconds | Functional only; latency not measured | Not measured, P1 |
| Archive report generation | 100% | 21 / 21 = 100% | Passed, P0 |
| Content uploads to product server | 0 | 0 product-server paths found | Passed, P0 |

The machine-readable source is `tests/baselines/mvp-metrics.json`. Its test recomputes the archive
denominator, rejects unmeasured metrics as passing, and derives readiness only from failed P0
metrics.

## Remaining deviations

- NASA did not finish its media-heavy capture within 120 seconds. It remains the sole product
  failure; streaming or resumable packaging is post-MVP work.
- Visual continuity is recorded for all 21 completed archives, but no per-case inventory defines
  which marketing visuals are critical. No 95% claim is made.
- Cancellation works and timed-out public cases are now actively cancelled, but no delayed browser
  fixture measures click-to-cancelled latency. No two-second claim is made.
- The final 23-site run contained no failed resource inside a completed ZIP. Explainability uses the
  R6 United Carriers public failure, whose record includes URL, type, HTTP 403, structured cause,
  retryability, recommendation, and primary-visual impact.

## Evidence

- Public rerun summary: `docs/testing/public-acceptance-2026-08-04.md`
- Public rerun: `test-results/public-acceptance/2026-08-04T103008-427Z/report.json`
- Explainability sample: `test-results/public-acceptance/2026-08-04T050038-254Z/united-carriers-home/archive/_sitecapsule/failures.json`
- R6 summary: `docs/testing/m10-r6-complex-site-acceptance-2026-08-04.md`
