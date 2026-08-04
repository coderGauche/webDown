# Release artifacts

SiteCapsule release candidates are generated from the ordinary production configuration:

```sh
pnpm release:candidate
```

The command builds and packages Chrome Manifest V3, verifies the ZIP structure, paths, CRC32,
file inventory, Manifest permissions, source-directory equality, and Chrome Web Store risks. It
then extracts the ZIP into a temporary directory and loads that exact copy in an isolated
Playwright Chromium profile, where the extension service worker and Side Panel must both start.

Generated ZIP files are written to the ignored `dist/` directory. A versioned JSON record is kept
here with the source commit, byte length, SHA-256, complete file inventory, and verification
results. `engineering-candidate` means the P0 metric gate passed; it does not by itself approve a
public release. A record marked `engineering-candidate-blocked` still has failed P0 metrics.

The current assessment is `docs/testing/mvp-metric-assessment-2026-08-04.md`. Its P0 engineering-
candidate gate passes, while M10-T6 version/demo preparation and M10-T7 user-supervised acceptance
remain mandatory before any public-release approval.
