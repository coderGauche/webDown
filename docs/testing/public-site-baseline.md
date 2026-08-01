# Public site baseline

M10-T1 defines the public-page test inventory. It does not claim that SiteCapsule has
captured or visually passed these pages; those execution results belong to M10-T2.

The machine-readable source of truth is
[`tests/baselines/public-sites.json`](../../tests/baselines/public-sites.json).

## Baseline contract

- The baseline contains 23 public HTTPS pages and excludes login, account, private,
  localhost, and local-network pages.
- Each case records the URL and redirect target, page type, runtime profile, key resource
  families, expected offline outcome, known limitations, and the most recent availability
  check.
- `availability.status` describes only whether the external page was reachable at the
  recorded time. It is not a SiteCapsule pass/fail result.
- `captureExpectation.outcome` is the product expectation to evaluate later. A page can be
  externally unavailable without causing a product regression, and a reachable page can
  still reveal a product regression.
- Public content changes are expected. M10-T2 should compare structural invariants and
  documented key resources, not mutable headlines, timestamps, or exact resource counts.

## Distribution

| Page type               |  Cases | Primary risk represented                          |
| ----------------------- | -----: | ------------------------------------------------- |
| Minimal static          |      2 | Basic HTML, inline CSS, links                     |
| Standards document      |      2 | Long content and fragment links                   |
| Technical documentation |      9 | Hydration, code content, fonts, scripts, SVG      |
| Project homepage        |      2 | Redirects and mixed static/runtime assets         |
| Encyclopedic article    |      1 | Long article, references, responsive images       |
| Media catalog           |      1 | Image density and `srcset`                        |
| Public institution      |      5 | Media-rich pages, third parties, volatile content |
| Interactive WebGL       |      1 | iframe, canvas, WebGL, and explicit degradation   |
| **Total**               | **23** | More than the required 20 cases                   |

## Availability maintenance

Before an M10-T2 run, check the exact URL without authentication and record one of:

- `reachable`: the public page returned renderable content;
- `externally-unavailable`: DNS, TLS, timeout, bot protection, regional restriction, or a
  remote 4xx/5xx prevented the check.

Do not delete a temporarily unavailable case during a regression run. Record the external
condition separately, skip product assertions that require the page, and retry later. Replace
a case only when the public URL has been retired or permanently moved, then review the type
distribution and update `finalUrl`, `checkedAt`, and the rationale in version control.

## M10-T2 handoff

For each reachable case, M10-T2 will create a separate result containing the tested commit,
Chrome version, timestamp, capture settings, visual outcome, console errors, resource
integrity outcome, offline request audit, and archive report path. Test results must not be
written back into this inventory because the inventory describes stable expectations rather
than a particular run.
