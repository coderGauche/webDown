# SiteCapsule

Chrome extension for creating structured, local-first webpage archives.

- [中文使用说明](./docs/user-guide.zh-CN.md)
- [English user guide](./docs/user-guide.en.md)
- [Privacy notice / 隐私说明](./docs/privacy.md)
- [Known limitations / 已知限制](./docs/known-limitations.md)
- [Product requirements and technical design](./SiteCapsule-产品需求与技术方案.md)
- [Implementation plan and progress](./SiteCapsule-开发执行计划与进度.md)
- [Development, build, test, and loading guide](./SiteCapsule-开发构建测试与加载说明.md)

The repository contains a working current-page engineering trial built with WXT, React,
TypeScript, and Manifest V3. It captures eligible public pages, downloads approved resources,
rewrites local references, and exports a ZIP. It does not crawl an entire site, and the current
build has documented P0 release blockers; read the known limitations before use.

## Quick start

```bash
pnpm install
pnpm build
```

Load `.output/chrome-mv3` from `chrome://extensions` with Developer mode enabled. For the full development workflow, quality checks, message-chain verification, permissions, and troubleshooting, read the [development, build, test, and loading guide](./SiteCapsule-开发构建测试与加载说明.md).
