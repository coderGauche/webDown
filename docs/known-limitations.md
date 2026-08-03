# SiteCapsule Known Limitations / 已知限制

> Applies to / 适用版本：0.1.0 engineering trial / 工程试用版
> Updated / 更新日期：2026-08-02

The Chinese section is followed by an English equivalent. / 中文之后提供英文版本。

## 中文

### 当前发布状态

- 本版本未达到 MVP 发布门槛，仅适合受限工程试用。
- 2026-08-02 固定公网集有 22 个可达案例，其中 18 个生成可下载 ZIP，成功率 81.82%，
  低于 90% 目标。
- 18 个真实 ZIP 均未包含 `_sitecapsule/report.html` 或机器清单，运行时报告生成率为 0%。
- MDN、Next.js 和 Wikipedia 案例出现任务已完成但结果区未及时显示；NASA 长任务在 120 秒
  后仍停留在下载阶段。

### 捕获范围

- 只保存当前页面，`maxDepth=0`、`maxPages=1`；不会递归镜像整个站点，也不会改写站内
  多页面链接为离线页面。
- 仅支持普通 HTTP/HTTPS 页面。Chrome 内部页面、Chrome Web Store、其他扩展页面和部分
  受保护页面不允许注入。
- 不以登录页面为目标，不读取 Cookie 或浏览器存储，不绕过访问控制。依赖登录态的资源可能
  无法下载。
- 不自动滚动页面；尚未进入 DOM、Performance Timing 或当前 CSS 的懒加载资源可能漏掉。

### 离线保真

- 原站后端、搜索、表单提交、支付、账号、实时 API、WebSocket 和服务端渲染功能无法保证
  离线运行。
- 归档关键第三方资源默认开启并按精确主机授权；媒体默认关闭。追踪、支付、iframe 和其他
  仅运行时资源默认排除。未授权、分类启发式、CORS/响应策略限制、限流、地域限制或防机器
  人页面仍可能造成资源缺失。
- 跨域 iframe 内容不可直接读取；开放 Shadow DOM 可记录，关闭的 Shadow Root 无法访问。
- Canvas/WebGL 的最终像素不会作为 DOM 序列化。模型、WASM、decoder 或 GPU 特定纹理变体
  只有在被发现并成功下载时才可能工作，换设备可能黑屏或材质缺失。
- Blob URL 依赖原文档会话，不能作为普通网络资源重新下载；不支持的协议会被记录或跳过。
- 通用 JavaScript 不做任意源码改写。动态拼接 URL、运行时 import、Service Worker、CSP 和
  ES Module 仍可能引用线上地址或受本地来源策略限制。
- 绝对 `<base>` 或根路径可能在 `file://` 下解析错误；TypeScript 文档案例曾跳转到
  `file:///docs/`。优先使用本地 HTTP 服务，但并非所有路径问题都会因此修复。

### 可靠性和资源

- ZIP 当前以内存 Blob 方式生成；UI 尚未提供单文件或任务总字节上限。大型媒体或资源密集页
  可能消耗大量内存、耗时过长或失败。
- ZIP 字节只在当前扩展运行会话可用。Service Worker 或扩展重启后仅保留任务和资源元数据，
  无法从历史任务重新下载原 ZIP。
- 暂停通常在当前异步边界生效，不保证中断已经交给浏览器的每个底层网络操作。
- 公网页面会变化，来源服务器可能限流或返回验证页；这类外部不可用与产品失败分开记录。

### 当前缺少的量化证据

- 主要视觉资源完整率 95%、失效本地请求占比 5% 和取消响应 2 秒尚无合格端到端分母或计时
  证据，不应宣称已达标。
- 结构化失败模型和归档报告模块已有单元测试，但尚未接入真实运行时 ZIP，因此不能宣称单资源
  失败 100% 可解释。

## English

### Current release status

- This build has not met the MVP release gate and is limited to restricted engineering trials.
- On 2026-08-02, 18 of 22 reachable fixed public cases produced a downloadable ZIP: 81.82%, below
  the 90% target.
- None of the 18 real ZIPs contained `_sitecapsule/report.html` or machine manifests, so runtime
  report generation was 0%.
- MDN, Next.js, and Wikipedia reached a completed task without promptly surfacing the result. NASA
  remained in downloading after 120 seconds.

### Capture scope

- Only the current page is saved (`maxDepth=0`, `maxPages=1`). Site crawling, whole-site mirroring,
  and offline rewriting of links to other pages are not implemented.
- Only normal HTTP/HTTPS pages are eligible. Chrome internal pages, Chrome Web Store, extension
  pages, and some protected pages reject content-script injection.
- Login pages are not a product target. Cookies and browser storage are not read, access controls
  are not bypassed, and resources that require a login session may fail.
- The page is not automatically scrolled. Lazy resources absent from the current DOM, Performance
  Timing, and discovered CSS may be missed.

### Offline fidelity

- Source backends, search, form submission, payments, accounts, live APIs, WebSockets, and
  server-rendered actions are not guaranteed offline.
- Archive-critical third-party resources are enabled by default and require exact-host grants;
  media remains off by default. Tracking, payment, iframe, and other runtime-only resources are
  excluded by default. Missing permission, classification heuristics, response restrictions,
  throttling, geography, or anti-bot pages can still leave assets unavailable.
- Cross-origin iframe content cannot be read directly. Open Shadow DOM can be recorded; closed
  shadow roots cannot be accessed.
- Final Canvas/WebGL pixels are not serialized as DOM. Models, WASM, decoders, and GPU-specific
  texture variants work only when discovered and downloaded; another device may show missing
  materials or a blank scene.
- Blob URLs are bound to the source document session and cannot be fetched as ordinary network
  resources. Unsupported protocols are recorded or skipped.
- Arbitrary JavaScript source is not generally rewritten. Computed URLs, runtime imports, Service
  Workers, CSP, and ES modules may retain online references or fail under a local origin.
- Absolute `<base>` and root paths can resolve incorrectly under `file://`; the TypeScript case
  navigated to `file:///docs/`. A local HTTP server is preferred but cannot repair every path issue.

### Reliability and resources

- ZIP generation currently uses an in-memory Blob, and the UI does not yet configure per-file or
  total byte limits. Media-heavy pages can consume substantial memory, take too long, or fail.
- ZIP bytes exist only in the current extension runtime session. A Service Worker or extension
  restart retains job/resource metadata but cannot restore the ZIP download.
- Pause takes effect at asynchronous boundaries and does not guarantee immediate interruption of
  every browser-level network operation already in flight.
- Public pages change, throttle, or return verification pages. External unavailability is recorded
  separately from product failures.

### Metrics not yet established

- The 95% primary-visual completeness, 5% broken-local-request rate, and two-second cancellation
  targets do not yet have valid end-to-end denominators or timing evidence and must not be claimed.
- Structured failure and archive-report modules pass unit tests but are not integrated into runtime
  ZIPs, so 100% single-resource failure explainability is not established.

See the detailed [MVP metric assessment](./testing/mvp-metric-assessment-2026-08-02.md).
