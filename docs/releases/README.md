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
results. A record marked `engineering-candidate-blocked` is not approved for public release.

The current `0.1.0` candidate remains blocked by the MVP assessment in
`docs/testing/mvp-metric-assessment-2026-08-02.md`. It is intended only for controlled engineering
evaluation until those release blockers are resolved.
