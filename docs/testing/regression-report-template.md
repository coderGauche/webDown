# SiteCapsule Regression Report

> Use `pnpm test:regression` to generate a populated report under
> `test-results/regression/`. This template is the durable release-review checklist.

## Run Summary

| Field | Value |
| --- | --- |
| Run ID | `<generated>` |
| Result | `passed / failed` |
| Started / finished | `<ISO timestamps>` |
| Git branch and commit | `<branch> / <commit>` |
| Worktree dirty at start | `yes / no` |
| Failed step | `<step id or none>` |

## Automated Checks

| Check | Expected result | Actual result | Evidence |
| --- | --- | --- | --- |
| Prettier | Pass |  | Step log |
| ESLint | Pass |  | Step log |
| TypeScript | Pass |  | Step log |
| Vitest unit/integration | Pass |  | Step log |
| Production MV3 build | Pass |  | Build log and `.output/chrome-mv3` |
| Chrome Web Store risk audit | 0 blocking errors |  | Audit JSON |
| Playwright extension E2E | All scenarios pass |  | Playwright artifacts |
| Production package restoration | Pass |  | Cleanup build and audit logs |

## Security And Offline Evidence

- Runtime message and URL audit: `test-results/vitest/runtime-security-audit.json`
- Sensitive form ZIP audit: `test-results/playwright/**/sensitive-form-audit.json`
- Offline request audit: `test-results/playwright/**/offline-request-audit.json`
- Service Worker restart audit: `test-results/playwright/**/service-worker-restart-audit.json`
- Large-task limit audit: `test-results/vitest/large-task-limit-audit.json`
- Store package audit: `test-results/audits/chrome-web-store-risk.json`

## Manual Release Review

- Reviewer: ____________________
- Review date: ____________________
- Target version and commit: ____________________
- Test operating system and Chrome version: ____________________
- [ ] Store audit review items have written explanations.
- [ ] Privacy disclosure covers local processing of webpage content/resources.
- [ ] Production package loads in a clean Chrome profile.
- [ ] A user can create, download and open one archive without developer tools.
- [ ] Known limitations, deviations and accepted risks are documented.
- Decision: `approve / reject / approve with conditions`
- Notes and follow-up issue links: ____________________
