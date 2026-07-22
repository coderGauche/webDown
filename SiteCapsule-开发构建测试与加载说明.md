# SiteCapsule 开发、构建、测试与加载说明

> 文档版本：v0.1  
> 适用范围：M1 扩展工程骨架  
> 最后更新：2026-07-23

本文档说明如何在本地安装依赖、运行开发环境、执行质量检查、构建扩展，并将未打包的 Chrome MV3 扩展加载到 Chromium 中验证。

当前版本已经具备 Side Panel、Background、runtime Content Script、Offscreen 入口，以及 Side Panel -> Background -> Content 的页面标题和 URL 消息往返。网页抓取、资源下载、ZIP 归档和离线 Viewer 尚未实现，不应将当前构建当作完整产品使用。

## 1. 环境要求

- Node.js `>=20.0.0`；
- pnpm `>=9.0.0`；
- 支持 Manifest V3 Side Panel 的 Chromium 浏览器；
- Git（用于同步仓库和保留提交记录）。

项目固定包管理器版本：`pnpm@9.15.0`。依赖版本以 `package.json` 和 `pnpm-lock.yaml` 为准。

## 2. 安装依赖

在项目根目录执行：

```bash
pnpm install
```

安装完成后，WXT 会通过 `postinstall` 生成 `.wxt/` 类型文件。`.wxt/`、`node_modules/` 和 `.output/` 都是生成目录，不应提交到 Git。

## 3. 开发模式

启动 WXT 开发服务器：

```bash
pnpm dev
```

保持终端运行，然后在 Chromium 的扩展管理页面加载开发产物目录：

```text
<项目根目录>/.output/chrome-mv3
```

开发期间修改入口或源码后，按 WXT 提示重新加载扩展。若 Side Panel 仍显示旧内容，先关闭 Side Panel，再在 `chrome://extensions` 点击扩展的重新加载按钮。

## 4. 质量检查

提交代码前执行完整门禁：

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

常用单项命令：

| 命令                | 用途                                 |
| ------------------- | ------------------------------------ |
| `pnpm lint`         | 检查 JS/MJS/CJS 配置和脚本           |
| `pnpm format`       | 使用 Prettier 格式化源码、配置和测试 |
| `pnpm format:check` | 检查格式但不修改文件                 |
| `pnpm typecheck`    | 执行 TypeScript 类型检查，不输出 JS  |
| `pnpm test`         | 执行 Vitest 单元测试                 |
| `pnpm build`        | 生成 Chrome MV3 生产构建             |

当前 TypeScript 版本为 7.0.2，`typescript-eslint` 尚不支持 TypeScript 7。因此 ESLint 暂时覆盖 JS/MJS/CJS；TS/TSX 由 `typecheck` 和 Prettier 负责检查。这个限制已记录在开发进度台账 D-009。

## 5. 生产构建和 ZIP

生成未打包扩展：

```bash
pnpm build
```

产物目录：

```text
.output/chrome-mv3/
```

生成可分发 ZIP：

```bash
pnpm zip
```

ZIP 主要用于交付或发布前检查。当前 ZIP 只包含工程骨架和运行时消息能力，不包含网页资源抓取和离线归档功能。

如果图标源文件发生变化，先重新生成占位图标：

```bash
pnpm icons:generate
pnpm build
```

## 6. 加载未打包扩展

1. 执行 `pnpm build`。
2. 打开 Chromium，访问 `chrome://extensions`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择项目下的 `.output/chrome-mv3`，不要选择仓库根目录。
6. 加载成功后，点击工具栏中的 SiteCapsule 图标，打开 Side Panel。

macOS Finder 默认隐藏以点号开头的目录。如果选择器中看不到 `.output`，使用 `Command + Shift + G`，输入以下绝对路径：

```text
<项目根目录>/.output/chrome-mv3
```

也可以在项目根目录执行以下命令直接打开产物目录：

```bash
open -a Finder "$(pwd)/.output/chrome-mv3"
```

## 7. 验证 M1-T6 消息链路

使用普通 `http://` 或 `https://` 页面验证，避免从 `chrome://extensions` 页面直接验证：

1. 打开一个普通网页，例如公开文档或新闻页面；
2. 打开 SiteCapsule Side Panel；
3. 在 `Current page` 区域点击 `Read page`；
4. 预期看到当前页面的 `Title` 和 `URL`。

消息链路如下：

```text
Side Panel
  -> browser.runtime.sendMessage(page-info/request)
Background
  -> browser.tabs.sendMessage(page-info/collect)
Content Script
  -> 返回 document.title 和 location.href
Background
  -> 将响应返回 Side Panel
```

首次请求时，Background 会尝试使用 `scripting.executeScript` 动态注入 `content-scripts/content.js`。因此当前 Content Script 使用 `registration: 'runtime'`，生产 Manifest 不会声明 `content_scripts`。

## 8. 权限说明

当前 Manifest V3 权限：

- `activeTab`：用户主动打开扩展后，允许处理当前标签页；
- `scripting`：按需注入 runtime Content Script；
- `storage`：为后续本地任务状态和设置预留；
- `downloads`：为后续 ZIP 下载预留；
- `offscreen`：为后续离线处理和压缩任务预留；
- `sidePanel`：提供 Side Panel UI；
- `optional_host_permissions`：预留 HTTP/HTTPS 站点授权，不在安装时默认申请全站访问。

这意味着 `chrome://`、Chrome Web Store 等受限页面可能无法注入 Content Script，Side Panel 会显示“当前页面不允许注入内容脚本”。这属于预期的浏览器安全限制。

## 9. 常见问题

### 9.1 选择器中看不到 `.output/chrome-mv3`

`.output` 是隐藏目录。确认已经运行 `pnpm build`，然后在 macOS 文件选择器中使用 `Command + Shift + G` 输入项目绝对路径。

### 9.2 Side Panel 没有出现

确认选择的是 `.output/chrome-mv3`，并在 `chrome://extensions` 点击重新加载。然后关闭并重新打开 Side Panel。

### 9.3 点击 `Read page` 后没有标题和 URL

按以下顺序检查：

1. 当前标签页是否为普通 HTTP/HTTPS 页面；
2. 是否在扩展重新构建后重新加载了扩展；
3. 是否关闭并重新打开了 Side Panel；
4. 在扩展管理页面检查 Service Worker 是否有错误；
5. 重新执行 `pnpm build`，确认 `.output/chrome-mv3/content-scripts/content.js` 存在。

### 9.4 `pnpm lint` 报 TypeScript 7 不兼容

这是已知工具链限制，不是业务代码错误。直接执行 `pnpm typecheck` 检查 TS/TSX，等待 `typescript-eslint` 支持 TypeScript 7 后再扩大 ESLint 覆盖范围。

### 9.5 修改代码后页面仍是旧版本

生产构建不会自动刷新。重新执行 `pnpm build`，回到 `chrome://extensions` 点击重新加载，再重开 Side Panel。

## 10. 当前未覆盖范围

以下能力不属于 M1 工程骨架，当前尚未实现：

- DOM 快照和资源发现；
- 图片、CSS、字体、脚本和媒体下载；
- URL 重写和 ZIP 归档；
- 本地 Viewer；
- 同站爬取和 robots 策略；
- WebGL、WASM、KTX2 等深度捕获；
- 登录、账号、订阅和服务端同步。

浏览器加载截图和实际 Chromium 运行记录由 M1-T8 单独验收并归档。

## 11. 提交前检查清单

- [ ] `pnpm install` 成功；
- [ ] `pnpm lint` 通过；
- [ ] `pnpm format:check` 通过；
- [ ] `pnpm typecheck` 通过；
- [ ] `pnpm test` 通过；
- [ ] `pnpm build` 通过；
- [ ] `.output/chrome-mv3/manifest.json` 存在；
- [ ] 未提交 `.output/`、`.wxt/`、`node_modules/`；
- [ ] 需要浏览器行为时，已在 Chromium 中重新加载扩展并记录结果。
