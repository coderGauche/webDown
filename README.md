# SiteCapsule

Chrome extension for creating structured, local-first webpage archives.

- [Product requirements and technical design](./SiteCapsule-产品需求与技术方案.md)
- [Implementation plan and progress](./SiteCapsule-开发执行计划与进度.md)
- [Development, build, test, and loading guide](./SiteCapsule-开发构建测试与加载说明.md)

The repository currently contains the WXT, React, and TypeScript scaffold with Side Panel, Background, runtime Content Script, and Offscreen entrypoints. Product functionality will be implemented milestone by milestone according to the execution plan.

## Quick start

```bash
pnpm install
pnpm build
```

Load `.output/chrome-mv3` from `chrome://extensions` with Developer mode enabled. For the full development workflow, quality checks, message-chain verification, permissions, and troubleshooting, read the [development, build, test, and loading guide](./SiteCapsule-开发构建测试与加载说明.md).
