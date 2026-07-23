# SiteCapsule 开发执行计划与进度

> 文档类型：Implementation Plan + Progress Tracker  
> 版本：v0.1  
> 建立日期：2026-07-22  
> 当前阶段：M2 任务模型、消息协议与持久化
> 当前状态：M2-T3 已完成，等待开始 M2-T4
> 下一任务：M2-T4 对跨上下文消息做运行时校验
> Git 基线：`master`，已完成任务提交至 `origin/master`
> 产品方案：[SiteCapsule 产品需求与技术方案](./SiteCapsule-产品需求与技术方案.md)

---

## 1. 文档用途

本文件是 SiteCapsule 开发过程的唯一进度台账，用于回答四个问题：

1. 当前正在做什么；
2. 哪些任务已经通过验收；
3. 下一步做什么；
4. 哪些问题正在阻塞开发。

产品目标、产品边界和完整技术设计以配套 PRD 为准。本文件只管理执行顺序、工作量、验收门禁和完成证据。

---

## 2. 执行规则

### 2.1 状态定义

| 标记 | 含义 |
|---|---|
| `[ ]` | 尚未完成 |
| `[x]` | 已实现并通过当前阶段验收 |
| `进行中` | 当前唯一允许执行的任务 |
| `阻塞` | 无法继续，必须记录原因和解除条件 |

### 2.2 推进规则

1. 同一时间只允许一个任务标记为“进行中”；
2. 开始任务前更新“当前状态”和“下一任务”；
3. 完成代码不等于完成任务，必须执行该任务规定的验证；
4. 验证失败时保持 `[ ]`，不得为了推进而提前勾选；
5. 完成任务后记录日期、文件、测试命令和结果；
6. 里程碑内全部任务通过后，才能进入下一里程碑；
7. 产品范围变化先写入“决策记录”，再调整任务和工期；
8. 用户可以随时要求暂停、复查或调整优先级；
9. 不因新增功能破坏已经通过的验收基线；
10. 每次交付都应保持扩展可构建或明确标注实验分支状态。

### 2.3 完成定义（Definition of Done）

一个任务只有同时满足以下条件才能勾选：

- 实现与任务描述一致；
- 没有无关重构或未解释的范围扩张；
- TypeScript 类型检查通过；
- 相关单元测试或集成测试通过；
- 需要浏览器行为的任务已在 Chromium 中验证；
- 文档和进度台账已同步；
- 已知限制已记录，不用隐藏问题代替完成。

---

## 3. 工期口径

### 3.1 估算方法

- `1 等效工程日`按约 6 小时专注开发、测试和文档计算；
- 估算对象为“一名开发者配合编码代理”的工作量；
- 它是任务规模，不是对自然日交付时间的承诺；
- 每轮实际可完成的任务数量取决于代码复杂度、浏览器验证和用户反馈；
- WebGL、Chrome 权限和不同网站兼容性存在较大不确定性，使用区间估算。

### 3.2 总体工期

| 发布目标 | 范围 | 预计工作量 | 累计参考周期 |
|---|---|---:|---:|
| 技术 MVP | 当前页、标准捕获、ZIP、报告 | 35-51 工程日 | 约 7-10 周 |
| 增强版 | 同站爬取、深度捕获、WebGL | 26-39 工程日 | 累计约 12-18 周 |
| 商业 v1 | 本地 Viewer、授权、发布完善 | 15-23 工程日 | 累计约 15-23 周 |

以上周期按连续投入估算，已经包含主要测试，但不包含 Chrome Web Store 不确定的审核等待时间。

---

## 4. MVP 固定决策

为避免开发中反复摇摆，MVP 默认采用以下决策：

| 项目 | MVP 决策 |
|---|---|
| 平台 | Chrome / Chromium，Manifest V3 |
| 语言 | TypeScript |
| 扩展框架 | WXT |
| UI | React Side Panel |
| 包管理 | pnpm |
| 捕获范围 | 当前公开页面 |
| 站点爬取 | MVP 不做，增强版实现 |
| 捕获模式 | 标准模式，不默认申请 Debugger 权限 |
| 资源发现 | DOM + CSS + Performance Resource Timing |
| ZIP | fflate；先实现受控体积，再升级流式写入 |
| 数据处理 | 本地完成，页面内容零上传 |
| 登录态 | 不作为产品目标 |
| JavaScript 改写 | MVP 仅处理可安全识别的引用，不通用改写压缩 JS |
| 本地查看 | MVP 输出说明并使用本地 HTTP；正式版再做 Viewer |
| 媒体文件 | 可配置，默认对大型视频谨慎处理 |
| AI | 不进入核心捕获链路 |

任何一项变更都必须写入第 11 章“决策记录”。

---

## 5. 里程碑总览

| 里程碑 | 内容 | 预计工作量 | 状态 |
|---|---|---:|---|
| M0 | 规划、PRD 与执行台账 | 1 工程日 | 已完成 |
| M1 | 扩展工程骨架 | 2-3 工程日 | 已完成 |
| M2 | 任务模型、消息协议与持久化 | 2-3 工程日 | 进行中 |
| M3 | 当前页面 DOM 快照 | 3-4 工程日 | 待开始 |
| M4 | 资源发现与资源图 | 4-6 工程日 | 待开始 |
| M5 | 下载引擎与权限策略 | 4-6 工程日 | 待开始 |
| M6 | 路径映射与内容改写 | 4-6 工程日 | 待开始 |
| M7 | ZIP、清单与归档报告 | 3-4 工程日 | 待开始 |
| M8 | Side Panel 完整工作流 | 4-6 工程日 | 待开始 |
| M9 | 稳定性、安全与自动化测试 | 5-7 工程日 | 待开始 |
| M10 | MVP 综合验收与发布包 | 3-5 工程日 | 待开始 |

MVP 合计：35-51 等效工程日。建议额外预留约 20% 的兼容性缓冲。

---

## 6. MVP 详细任务清单

### M0：规划与立项

目标：明确产品范围、技术路径和后续执行规则。

- [x] **M0-T1** 完成产品需求与技术方案；
- [x] **M0-T2** 完成开发执行计划与进度台账；
- [x] **M0-T3** 确认 MVP 默认决策；
- [x] **M0-T4** 确认首个开发任务为工程初始化。

验收门禁：

- PRD 和执行计划均存在；
- 技术栈、MVP 边界和下一任务明确；
- 工期以可验证任务拆分，而不是只有粗略阶段名称。

完成证据：

- `SiteCapsule-产品需求与技术方案.md`；
- `SiteCapsule-开发执行计划与进度.md`。

---

### M1：扩展工程骨架

目标：建立可持续开发、构建、测试和加载的 Chrome 扩展工程。

- [x] **M1-T1** 初始化 WXT + React + TypeScript + pnpm；
- [x] **M1-T2** 建立 Side Panel、Background、Content、Offscreen 入口；
- [x] **M1-T3** 配置 Manifest V3 基础权限和图标占位；
- [x] **M1-T4** 配置 ESLint、Prettier、Vitest 和类型检查；
- [x] **M1-T5** 建立 `src/` 模块目录和路径别名；
- [x] **M1-T6** 实现最小消息往返：Side Panel -> Background -> Content；
- [x] **M1-T7** 编写开发、构建、测试和加载说明；
- [x] **M1-T8** 在 Chromium 中加载未打包扩展并保存验证截图。

验收门禁：

- `pnpm install` 成功；
- 类型检查、单元测试和生产构建通过；
- Side Panel 可以打开；
- Content Script 可以返回当前页面标题和 URL；
- 无远程托管代码；
- 扩展重载后无基础控制台错误。

交付物：工程骨架、基础配置、最小扩展包、加载说明、[Chromium 验证截图](./docs/verification/m1-t8-sidepanel.png)。

---

### M2：任务模型、消息协议与持久化

目标：先建立可靠的任务底座，再开发抓取逻辑。

- [x] **M2-T1** 定义 `CaptureJob`、`CaptureSettings`、`ResourceRecord`；
- [x] **M2-T2** 定义任务状态机和合法状态转换；
- [x] **M2-T3** 定义带版本号的消息协议；
- [ ] **M2-T4** 对跨上下文消息做运行时校验；
- [ ] **M2-T5** 建立 IndexedDB/Dexie 数据库；
- [ ] **M2-T6** 实现任务创建、更新、查询和清理；
- [ ] **M2-T7** 实现结构化错误模型；
- [ ] **M2-T8** 为状态机、协议和存储编写测试。

验收门禁：

- 非法状态转换会被拒绝；
- 扩展后台重启后能读取任务；
- 非法页面消息不能触发后台操作；
- 数据库 schema 有明确版本；
- 单元测试覆盖主要成功和失败路径。

---

### M3：当前页面 DOM 快照

目标：获取安全、稳定、可离线处理的当前页面快照。

- [ ] **M3-T1** 获取当前标签页 URL、标题、base URL 和最终 URL；
- [ ] **M3-T2** 实现可配置渲染等待；
- [ ] **M3-T3** 克隆并序列化最终 DOM；
- [ ] **M3-T4** 清理密码、Token 和敏感表单值；
- [ ] **M3-T5** 记录 iframe、Shadow DOM 和不可访问区域；
- [ ] **M3-T6** 收集 Performance Resource Timing；
- [ ] **M3-T7** 实现超时、导航变化和标签关闭错误；
- [ ] **M3-T8** 建立静态页和 SPA 测试 fixture。

验收门禁：

- 普通 HTML 与 React fixture 均能获得非空快照；
- 密码和敏感输入不会进入快照；
- 页面跳转时任务不会归档错误 origin；
- 快照包含可重复的页面元数据；
- 失败原因可在 Side Panel 中解释。

---

### M4：资源发现与资源图

目标：建立确定性、可递归、可去重的资源发现系统。

- [ ] **M4-T1** 提取 DOM 中的 `src`、`href`、`srcset`、`poster`；
- [ ] **M4-T2** 提取 inline style、SVG 和 `<style>` 资源；
- [ ] **M4-T3** 使用 CSSTree 解析 `url()`、`@import` 和 `@font-face`；
- [ ] **M4-T4** 合并 DOM、CSS 和 Performance 资源；
- [ ] **M4-T5** 实现 URL 规范化、fragment 清理和 query 保留；
- [ ] **M4-T6** 实现 `ResourceGraph` 及来源追踪；
- [ ] **M4-T7** 识别 data URL、Blob URL 和不支持协议；
- [ ] **M4-T8** 实现资源类型与 MIME 推断；
- [ ] **M4-T9** 为复杂 URL、srcset、嵌套 CSS 编写测试。

验收门禁：

- 同一资源不会因不同发现来源被重复下载；
- 相对 URL 始终相对于正确文档或 CSS 文件解析；
- query 不会被错误丢弃；
- CSS 解析不依赖单一正则；
- 每个资源能追溯到发现来源和 referrer。

---

### M5：下载引擎与权限策略

目标：可靠、安全地下载已发现资源。

- [ ] **M5-T1** 实现当前站点权限检查；
- [ ] **M5-T2** 实现第三方域名汇总和按需授权；
- [ ] **M5-T3** 实现受控并发队列；
- [ ] **M5-T4** 实现 AbortController 暂停、取消基础；
- [ ] **M5-T5** 实现超时、重试和 Retry-After；
- [ ] **M5-T6** 记录重定向、final URL、状态码和 MIME；
- [ ] **M5-T7** 实现单文件和任务总体积限制；
- [ ] **M5-T8** 实现协议、origin 和本地网络安全策略；
- [ ] **M5-T9** 实现资源失败不阻断主任务；
- [ ] **M5-T10** 使用多域 fixture 做集成测试。

验收门禁：

- 并发数符合配置；
- 取消后不再发起新请求；
- 429/503 可以按策略重试；
- 未授权第三方资源有明确状态；
- 危险协议不会被请求；
- 下载结果和资源记录一致。

---

### M6：路径映射与内容改写

目标：将线上资源稳定映射到 ZIP，并恢复本地引用关系。

- [ ] **M6-T1** 实现确定性域名目录和文件类型目录；
- [ ] **M6-T2** 实现非法文件名清理；
- [ ] **M6-T3** 实现 query 哈希和路径冲突处理；
- [ ] **M6-T4** 使用 DOMParser 改写 HTML 资源；
- [ ] **M6-T5** 使用 CSSTree 改写 CSS URL；
- [ ] **M6-T6** 处理 `srcset`、`picture`、媒体和字体；
- [ ] **M6-T7** 记录未捕获的线上依赖；
- [ ] **M6-T8** 禁用原站 Service Worker 注册的安全策略；
- [ ] **M6-T9** 记录 CSP 调整和所有内容变更；
- [ ] **M6-T10** 编写路径稳定性和离线引用测试。

验收门禁：

- 相同输入每次生成相同路径；
- 已下载 HTML/CSS 资源不再指向原线上 URL；
- query 冲突不会互相覆盖；
- 未保存资源不会被伪装成成功；
- 原始 URL 与本地路径可以双向查询。

---

### M7：ZIP、清单与归档报告

目标：生成结构正确、可检查、可交付的离线归档。

- [ ] **M7-T1** 集成 fflate；
- [ ] **M7-T2** 实现规定的 ZIP 目录结构；
- [ ] **M7-T3** 生成 `archive.json`；
- [ ] **M7-T4** 生成 `resources.json` 和 `failures.json`；
- [ ] **M7-T5** 生成 `report.html` 和 `README_OFFLINE.md`；
- [ ] **M7-T6** 生成可选 SHA-256；
- [ ] **M7-T7** 使用 Chrome Downloads API 导出；
- [ ] **M7-T8** 验证 ZIP CRC、解压和文件数量。

验收门禁：

- ZIP 可正常解压；
- 清单数量与实际文件一致；
- 失败资源不会出现在成功清单；
- 报告能区分本地资源、失败资源和线上依赖；
- ZIP 文件名安全且可预测。

---

### M8：Side Panel 完整工作流

目标：把底层能力整合成可用产品，而不是开发者脚本。

- [ ] **M8-T1** 实现当前页任务设置；
- [ ] **M8-T2** 实现渲染等待、并发、媒体和第三方资源控件；
- [ ] **M8-T3** 实现准备、发现、下载、改写、打包进度；
- [ ] **M8-T4** 实现暂停、继续、取消和重试；
- [ ] **M8-T5** 实现结果页和失败详情；
- [ ] **M8-T6** 实现任务历史和本地清理；
- [ ] **M8-T7** 实现中英文文案；
- [ ] **M8-T8** 实现键盘操作、焦点和基础无障碍；
- [ ] **M8-T9** 验证窄 Side Panel 下无文字溢出。

验收门禁：

- 非技术用户可以从打开页面完成 ZIP 导出；
- 所有按钮状态与任务状态一致；
- 任务失败后仍可查看报告和重试；
- UI 关闭或重开不会伪造任务完成；
- 中文和英文布局均无明显截断。

---

### M9：稳定性、安全与自动化测试

目标：建立可持续迭代的质量基线。

- [ ] **M9-T1** 建立静态、React、Vue、Next 风格 fixture；
- [ ] **M9-T2** 建立字体、媒体、第三方 CDN fixture；
- [ ] **M9-T3** 建立 Playwright 扩展 E2E；
- [ ] **M9-T4** 自动验证断网环境中的本地请求；
- [ ] **M9-T5** 验证 Service Worker 重启恢复；
- [ ] **M9-T6** 验证大任务内存和体积限制；
- [ ] **M9-T7** 审计页面消息和 URL 安全策略；
- [ ] **M9-T8** 验证敏感表单值不会归档；
- [ ] **M9-T9** 扫描 Chrome Web Store 远程代码和权限风险；
- [ ] **M9-T10** 形成回归测试命令和报告模板。

验收门禁：

- 全部自动化测试通过；
- 断网测试无未解释的线上请求；
- 页面不能利用消息协议请求任意敏感 URL；
- 后台重启不损坏任务状态；
- 隐私检查确认页面内容没有上传。

---

### M10：MVP 综合验收与发布包

目标：形成可试用、可演示、可继续迭代的 MVP。

- [ ] **M10-T1** 建立不少于 20 个公开测试案例的基线；
- [ ] **M10-T2** 执行视觉、控制台和资源完整性验收；
- [ ] **M10-T3** 达成 PRD 中的 MVP 指标或记录偏差；
- [ ] **M10-T4** 完成使用说明、隐私说明和已知限制；
- [ ] **M10-T5** 生成可加载的发布 ZIP；
- [ ] **M10-T6** 完成版本号、更新日志和演示流程；
- [ ] **M10-T7** 用户监督验收；
- [ ] **M10-T8** 决定是否进入增强版。

验收门禁：

- MVP 固定测试集通过；
- 发布包可在全新 Chrome 配置中加载；
- 用户可以独立完成一次归档；
- 已知限制、权限和隐私行为清楚可见；
- 没有阻止试用的 P0 缺陷。

---

## 7. 增强版路线

增强版只有在 M10 通过后开始，避免高阶功能拖垮 MVP。

### M11：受控同站点爬取，8-12 工程日

- [ ] 页面队列、深度和数量限制；
- [ ] same-origin / same-site 策略；
- [ ] allowlist / blocklist；
- [ ] 页面链接本地改写；
- [ ] robots 与用户授权策略；
- [ ] 队列断点恢复和爬取报告。

### M12：深度网络捕获，8-12 工程日

- [ ] 可选 Debugger 权限；
- [ ] CDP Network 事件；
- [ ] 必要响应体捕获；
- [ ] Blob 和短生命周期请求；
- [ ] 自动 detach 与隐私审计；
- [ ] 标准/深度结果差异报告。

### M13：WebGL 专项，10-15 工程日

- [ ] glTF/GLB、WASM、Draco、Meshopt；
- [ ] KTX/KTX2/Basis；
- [ ] ASTC/S3TC/ETC/PVRTC 变体；
- [ ] HDR/EXR、Shader、视频纹理；
- [ ] 多 GPU 环境验证；
- [ ] 黑屏、缺纹理和 decoder 诊断。

### M14：本地 Viewer，10-15 工程日

- [ ] 技术方案验证；
- [ ] ZIP 导入与归档管理；
- [ ] 本地 HTTP 服务；
- [ ] 路由和 MIME；
- [ ] 一键打开与跨平台打包；
- [ ] 插件与 Viewer 通信安全。

### M15：商业化与商店发布，5-8 工程日

- [ ] 品牌和正式名称；
- [ ] 授权和订阅边界；
- [ ] Chrome Web Store 资料；
- [ ] 隐私政策和支持流程；
- [ ] 更新、崩溃与匿名遥测；
- [ ] 免费版和专业版能力控制。

---

## 8. 当前任务看板

每次开发开始和结束都更新本节。

| 项目 | 当前值 |
|---|---|
| 当前里程碑 | M2 任务模型、消息协议与持久化 |
| 当前任务 | 无进行中任务 |
| 最近完成 | M2-T3 定义带版本号的消息协议 |
| 下一任务 | M2-T4 对跨上下文消息做运行时校验 |
| 阻塞项 | 无 |
| Git 仓库 | `git@github.com:coderGauche/webDown.git` |
| Git 同步策略 | 已完成任务提交并推送至 `origin/master` |
| 最近验证日期 | 2026-07-23 |

---

## 9. 完成日志

| 日期 | 任务 | 结果 | 验证证据 |
|---|---|---|---|
| 2026-07-22 | M0-T1 | 完成 | 产品需求与技术方案已建立 |
| 2026-07-22 | M0-T2 | 完成 | 开发执行计划与进度台账已建立 |
| 2026-07-22 | M0-T3 | 完成 | MVP 固定决策已写入第 4 章 |
| 2026-07-22 | M0-T4 | 完成 | 下一任务确定为 M1-T1 |
| 2026-07-22 | M1-T1 | 完成 | WXT 0.20.27、React 19.2.8、TypeScript 7.0.2；`pnpm exec tsc --noEmit` 与 `pnpm build` 通过，生成 Chrome MV3 产物 |
| 2026-07-22 | Git 基线 | 完成 | `master` 已推送至 `origin/master`；首次提交 `1da7a5c first commit` |
| 2026-07-23 | M1-T2 | 完成 | Side Panel、Background、runtime Content Script、Offscreen 入口构建成功；类型检查与 `pnpm build` 通过；Manifest 未声明全站 Content Script |
| 2026-07-23 | M1-T3 | 完成 | 配置 `activeTab`、`scripting`、`storage`、`downloads`、`offscreen` 和可选 HTTP/HTTPS 站点权限；生成 16/32/48/128 PNG 图标；`pnpm exec tsc --noEmit` 与 `pnpm build` 通过 |
| 2026-07-23 | M1-T4 | 完成 | 新增 ESLint flat config、Prettier 配置、Vitest 配置和 `tests/tooling.test.ts`；新增 `lint`、`format`、`format:check`、`typecheck`、`test` 脚本；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过；当前 TS/TSX 由类型检查和 Prettier 覆盖，等待 typescript-eslint 支持 TypeScript 7 后再启用 TS lint |
| 2026-07-23 | M1-T5 | 完成 | 建立 `src/shared` 模块、`@sitecapsule/*` TypeScript/Vite/Vitest 路径别名，并迁移 Background、Content、Offscreen、Side Panel 使用共享常量；`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm test`、`pnpm build` 全部通过 |
| 2026-07-23 | M1-T6 | 完成 | 新增类型安全的页面信息消息协议；Side Panel 查询活动标签页，Background 转发并按需注入 runtime Content Script，Content 返回标题和 URL；针对首次手工验证的“内容脚本未能返回页面信息”补充异步回包和注入后重试；新增协议测试，2 个测试文件、3 个测试通过；`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm test`、`pnpm build` 全部通过；Chrome 自动化手工点击因当前环境未安装可控 ChatGPT Chrome Extension，留待 M1-T8 验证 |
| 2026-07-23 | M1-T7 | 完成 | 新增 `SiteCapsule-开发构建测试与加载说明.md`，覆盖环境要求、依赖安装、开发模式、质量门禁、生产构建、ZIP、Chromium 加载、M1-T6 消息链路、权限、故障排查和当前范围；README 增加快速开始和文档入口 |
| 2026-07-23 | M1-T8 | 完成 | 在 Google Chrome 150 中加载 `.output/chrome-mv3` 未打包扩展；Side Panel 成功读取 `https://unitedcarriers.com/`，返回标题 `United Carriers \| Every leg of the journey` 和正确 URL；验证截图保存为 `docs/verification/m1-t8-sidepanel.png`；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（2 个文件、3 个测试）及 `pnpm build` 全部通过 |
| 2026-07-23 | M2-T1 | 完成 | 新增 `src/domain/capture.ts` 与领域导出，定义 `CaptureJob`、`CaptureSettings`、`ResourceRecord`、`JobCounters` 及捕获模式、任务状态、资源类型/状态/发现来源词汇；资源记录通过 `jobId` 显式归属任务，暂不实现状态转换、结构化错误或持久化；新增 `tests/capture-model.test.ts`；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（3 个文件、5 个测试）及 `pnpm build` 全部通过 |
| 2026-07-23 | M2-T2 | 完成 | 新增 `src/domain/job-state-machine.ts`，实现主流程、暂停/原阶段恢复、取消、失败/重试及终态约束；`CaptureJob` 使用判别联合保证仅暂停状态携带 `resumeStatus`；非法转换由 `transitionJobState` 拒绝；新增 `tests/job-state-machine.test.ts` 覆盖成功、暂停恢复、取消、重试、非法转换与运行时状态词汇；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（4 个文件、11 个测试）及 `pnpm build` 全部通过 |
| 2026-07-23 | M2-T3 | 完成 | 将 `src/messaging/protocol.ts` 升级为协议 v1，统一使用 `protocolVersion`、`correlationId`、`type` 和 `payload` 信封；定义 `page-info/request|collect|response` 及 `capture-job/create|control|get|response|updated` 消息，任务控制支持 `pause|resume|cancel|retry`；Side Panel、Background 和 Content 已迁移到 v1 且保持关联 ID；本任务仅保留现有页面信息链路的基础守卫，完整运行时校验留给 M2-T4；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（4 个文件、13 个测试）及 `pnpm build` 全部通过 |

后续每条日志需尽量包含：修改文件、测试命令、测试结果和残余风险。

---

## 10. 阻塞与风险日志

| 编号 | 日期 | 状态 | 问题 | 影响 | 解除条件 |
|---|---|---|---|---|---|
| - | - | 无 | 当前无阻塞项 | - | - |

阻塞项解除后保留历史记录，不删除原始问题。

---

## 11. 决策记录

| 编号 | 日期 | 决策 | 原因 | 影响 |
|---|---|---|---|---|
| D-001 | 2026-07-22 | MVP 只做当前公开页面 | 先完成最小闭环 | 同站爬取延后到 M11 |
| D-002 | 2026-07-22 | 核心使用 TypeScript | 符合 Chrome 扩展运行时 | Python 不进入扩展核心 |
| D-003 | 2026-07-22 | 使用 WXT + React | 减少 MV3 工程配置成本 | 需要遵循 WXT 入口结构 |
| D-004 | 2026-07-22 | 标准捕获默认启用 | 降低权限和审核风险 | 深度捕获延后到 M12 |
| D-005 | 2026-07-22 | 本地内容零上传 | 建立隐私信任 | AI 只能使用最小诊断信息 |
| D-006 | 2026-07-22 | MVP 不承诺双击 HTML 完美运行 | `file://` 存在平台限制 | 先提供本地 HTTP 说明，Viewer 延后 |
| D-007 | 2026-07-22 | GitHub 仓库使用 `master` 作为当前主分支 | 与已建立远程仓库保持一致 | 后续提交基于 `origin/master` 推进 |
| D-008 | 2026-07-23 | 站点权限使用 `optional_host_permissions` | 避免安装时永久申请全站访问 | 未来按用户选择的站点请求授权 |
| D-009 | 2026-07-23 | ESLint 当前只检查 JS/MJS/CJS 文件 | `typescript-eslint` 8.65.0 尚不支持 TypeScript 7；避免将不兼容的 lint 工具强行接入 | TS/TSX 由 `typecheck` 与 Prettier 守门，待 parser 支持后扩展 |
| D-010 | 2026-07-23 | 使用 `@sitecapsule/*` 作为 `src/` 别名 | 不覆盖 WXT 自带的 `@` 根目录别名，降低框架升级冲突 | TypeScript、WXT Vite 和 Vitest 配置保持同一解析规则 |
| D-011 | 2026-07-23 | Background 在首次请求失败时使用 `scripting.executeScript` 注入 Content Script | `registration: 'runtime'` 生产包不会自动写入 `content_scripts`，需要按当前标签页动态执行 | 依赖 `activeTab`/站点授权，受 `chrome://` 等受限页面限制 |
| D-012 | 2026-07-23 | 暂停记录并恢复原执行状态；失败重试从 `preparing` 重新开始 | 暂停必须避免跳阶段，重试必须在尚未建立持久化阶段上下文时保持确定性 | `CaptureJob` 暂停时携带 `resumeStatus`，重试会重新执行准备和权限校验 |
| D-013 | 2026-07-23 | 跨上下文消息使用显式协议 v1 和统一信封 | MV3 各运行上下文可能在扩展更新时短暂处于不同代码版本，且异步任务需要关联请求、响应与事件 | 所有消息携带 `protocolVersion: 1` 和 `correlationId`；不支持的版本不进入现有页面信息处理链路 |

---

## 12. 监督检查点

用户可在每个里程碑结束时检查：

1. 对照本文件查看是否提前勾选；
2. 要求展示实际测试结果，而不是只看代码；
3. 随机选择一个 fixture 复测；
4. 检查是否出现范围外功能；
5. 检查残余风险是否写入日志；
6. 决定进入下一里程碑、返工或调整范围。

建议监督节奏：每完成一个任务更新一次状态，每完成一个里程碑进行一次完整验收。

---

## 13. 下一步

下一步严格只执行 **M2-T4：对跨上下文消息做运行时校验**。

M2-T4 完成后必须：

1. 更新本文件中的任务勾选；
2. 将 M2-T5 设为下一任务；
3. 为所有 v1 消息和非法输入补齐运行时校验测试；
4. 不越过 M2-T4 提前实现 IndexedDB 持久化。
