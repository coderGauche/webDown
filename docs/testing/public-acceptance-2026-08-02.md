# M10-T2 public acceptance result

## Run identity

| Field            | Value                                                                           |
| ---------------- | ------------------------------------------------------------------------------- |
| Run ID           | `2026-08-01T162528-376Z`                                                        |
| Local run date   | 2026-08-02 (Asia/Shanghai)                                                      |
| Baseline         | `m10-public-sites-v1`                                                           |
| Tested commit    | `40e30dd5158f82d578cf847fa26480f5c43d59fc`                                      |
| Chrome           | 151.0.7922.34                                                                   |
| Viewport         | 1440 x 900                                                                      |
| Capture settings | current page, standard, 5000 ms wait, concurrency 6, media off, third party off |
| Command          | `pnpm test:public-acceptance`                                                   |
| Duration         | 13.5 minutes                                                                    |

The worktree was dirty because the M10-T2 harness was under development and `友商.md` remained
untracked. The exact tested baseline commit is recorded above. The runner restored the ordinary
production build after execution; its Manifest has no install-time `host_permissions` and keeps
the existing optional HTTP/HTTPS permissions.

## Summary

| Classification       |  Count | Meaning                                                                              |
| -------------------- | -----: | ------------------------------------------------------------------------------------ |
| Pass                 |      6 | Online visual, archive, and offline structural checks passed without review findings |
| Allowed degradation  |     11 | Core offline content opened, with expected runtime or external-request findings      |
| Product failure      |      5 | Archive result/download or offline core-content criteria failed                      |
| External unavailable |      1 | The public origin blocked the isolated browser; not counted as a product failure     |
| **Total**            | **23** | Entire M10-T1 fixed baseline was attempted                                           |

The run produced 39 accepted online/offline screenshots, 18 downloadable ZIP archives, 23
captured console errors, 17 failed live requests, 4 HTTP-error responses, and 167 attempted
external requests while opening archives offline. Raw JSON, Markdown, screenshots, extracted
archives, panel failure screenshots, and downloads are under
`test-results/public-acceptance/2026-08-01T162528-376Z/` (56 MB, intentionally ignored by Git).

## Product failures

| Case                      | Evidence                                           | Observed deviation                                                                                                                     |
| ------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `mdn-html-reference`      | `mdn-html-reference/panel-error.png`               | Task reached `Completed`, but `Archive ready` and the downloadable result did not appear within 120 seconds                            |
| `nextjs-docs`             | `nextjs-docs/panel-error.png`                      | Task reached `Completed`, but the result was not surfaced; the live page also emitted console/HTTP findings                            |
| `wikipedia-web-archiving` | `wikipedia-web-archiving/panel-error.png`          | Task reached `Completed`, but the result was not surfaced, so ZIP/offline checks could not run                                         |
| `nasa-home`               | `nasa-home/panel-error.png`                        | Capture remained in `Downloading` after 120 seconds on a 71-image, media-rich page                                                     |
| `typescript-docs`         | extracted `archive/index.html` and offline metrics | ZIP contained 43 entries, but an absolute `/docs/` base caused `file:` navigation to `file:///docs/`; offline text retention was 1.34% |

These are M10-T2 observations, not fixes. M10-T3 must compare them with the PRD metrics, decide
severity and release impact, and record deviations before any claim that the MVP target is met.

## External availability

`smithsonian-home` returned HTTP 403 with a verification page in the isolated Chromium profile.
It is classified as `external-unavailable`; visual, archive, and offline product assertions were
not executed and it is not included in the five product failures.

## Evidence policy

- Online visual evidence requires renderable text, non-zero document dimensions, and a nonblank
  viewport screenshot.
- Console and resource findings are recorded and sanitized; public-page errors alone do not prove
  a SiteCapsule regression.
- Archive evidence requires a nonempty downloaded ZIP containing `index.html`.
- Offline evidence opens the extracted `index.html` with the entire Chromium context offline,
  records HTTP/HTTPS/WS/WSS attempts, captures a screenshot, and requires at least 25% live-page
  text retention.
- Public-site volatility and anti-bot responses remain separate from product results.
