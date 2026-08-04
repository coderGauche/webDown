# SiteCapsule Known Limitations / 已知限制

> Applies to / 适用版本：0.1.0 engineering trial / 工程试用版
> Updated / 更新日期：2026-08-04

The Chinese section is followed by an English equivalent. / 中文之后提供英文版本。

## 中文

### 当前发布状态

- 本版本未达到 MVP 发布门槛，仅适合受限工程试用。
- 2026-08-02 的 23 站旧基线未达到 MVP 门槛；M10-R7 尚未完成全量重跑，因此当前仍不能
  宣称达到发布指标。
- 2026-08-04 的 R6 三站复杂页回归均生成真实 ZIP，通过 ZIP 引用审计和严格断网打开；其中
  一个静态文档页完全通过，两个动态/WebGL 页面按已知降级通过。

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
- 跨域 iframe 内容不可直接读取；除自包含 `srcdoc` 外，iframe 会从离线 DOM 中移除，因为
  当前不会递归归档 frame 文档。开放 Shadow DOM 可记录，关闭的 Shadow Root 无法观察或清理。
- Canvas/WebGL 的最终像素不会作为 DOM 序列化。模型、WASM、decoder 或 GPU 特定纹理变体
  只有在被发现并成功下载时才可能工作，换设备可能黑屏或材质缺失。
- Blob URL 依赖原文档会话，不能作为普通网络资源重新下载；不支持的协议会被记录或跳过。
- 离线入口默认禁用可执行 JavaScript，并移除预连接、预取和模块预加载提示，以保存捕获时
  的最终 DOM 并阻止脚本动态外联。JSON/JSON-LD 数据脚本保留；脚本文件可进入 ZIP，但交互、
  客户端路由和运行时动画不会自动恢复。
- 未成功保存的资源引用会被移除或中和，避免离线页面回连原站；对应资源仍在失败清单中说明。

### 可靠性和资源

- ZIP 当前以内存 Blob 方式生成；系统有单文件和任务总体积门禁，但大型媒体或资源密集页仍
  可能消耗大量内存、耗时过长或触发限制。
- ZIP 字节只在当前扩展运行会话可用。Service Worker 或扩展重启后仅保留任务和资源元数据，
  无法从历史任务重新下载原 ZIP。
- 暂停通常在当前异步边界生效，不保证中断已经交给浏览器的每个底层网络操作。
- 公网页面会变化，来源服务器可能限流或返回验证页；这类外部不可用与产品失败分开记录。

### 当前缺少的量化证据

- 主要视觉资源完整率 95%、失效本地请求占比 5% 和取消响应 2 秒尚无合格端到端分母或计时
  证据，不应宣称已达标。
- 结构化清单、失败说明和可读报告已接入真实运行时 ZIP；全量公开基线中的解释率仍需 R7 重算。

## English

### Current release status

- This build has not met the MVP release gate and is limited to restricted engineering trials.
- The 23-site baseline from 2026-08-02 did not meet the MVP gate. M10-R7 has not rerun the full set,
  so release metrics are not yet claimed.
- The 2026-08-04 R6 complex-site run produced real ZIPs for all three selected sites. Every ZIP
  passed reference integrity and strict offline opening; one static documentation site passed
  fully, while two dynamic/WebGL sites passed with documented degradation.

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
- Cross-origin iframe content cannot be read directly. Except for self-contained `srcdoc`, iframes
  are removed from the offline DOM because frame documents are not recursively archived. Open
  Shadow DOM can be recorded; closed shadow roots cannot be observed or sanitized.
- Final Canvas/WebGL pixels are not serialized as DOM. Models, WASM, decoders, and GPU-specific
  texture variants work only when discovered and downloaded; another device may show missing
  materials or a blank scene.
- Blob URLs are bound to the source document session and cannot be fetched as ordinary network
  resources. Unsupported protocols are recorded or skipped.
- Executable JavaScript is disabled in the offline entry, and preconnect, prefetch, prerender, and
  module-preload hints are removed. This preserves the captured final DOM and prevents dynamic
  network access. JSON/JSON-LD data scripts remain, and script files may be packaged, but client
  routing, interactions, and runtime animation do not automatically resume.
- References to resources that were not saved are removed or neutralized to prevent silent source-
  site requests; the failures remain documented in the archive manifest.

### Reliability and resources

- ZIP generation currently uses an in-memory Blob. Per-file and total-task byte gates exist, but
  media-heavy pages can still consume substantial memory, take too long, or hit those limits.
- ZIP bytes exist only in the current extension runtime session. A Service Worker or extension
  restart retains job/resource metadata but cannot restore the ZIP download.
- Pause takes effect at asynchronous boundaries and does not guarantee immediate interruption of
  every browser-level network operation already in flight.
- Public pages change, throttle, or return verification pages. External unavailability is recorded
  separately from product failures.

### Metrics not yet established

- The 95% primary-visual completeness and two-second cancellation targets do not yet have valid
  end-to-end denominators or timing evidence and must not be claimed.
- The R7 fixed-set rerun archived 21 of 22 reachable pages. All 21 completed ZIPs passed static and
  offline-browser checks with 0 missing local references out of 941 and included their report and
  manifests. NASA remains a 120-second large-page timeout.

See the detailed [MVP metric assessment](./testing/mvp-metric-assessment-2026-08-04.md).
