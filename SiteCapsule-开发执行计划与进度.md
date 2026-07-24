# SiteCapsule 开发执行计划与进度

> 文档类型：Implementation Plan + Progress Tracker  
> 版本：v0.1  
> 建立日期：2026-07-22  
> 当前阶段：M6 路径映射与内容改写
> 当前状态：M5 已完成，等待开始 M6-T1
> 下一任务：M6-T1 实现确定性域名目录和文件类型目录
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
| M2 | 任务模型、消息协议与持久化 | 2-3 工程日 | 已完成 |
| M3 | 当前页面 DOM 快照 | 3-4 工程日 | 已完成 |
| M4 | 资源发现与资源图 | 4-6 工程日 | 已完成 |
| M5 | 下载引擎与权限策略 | 4-6 工程日 | 已完成 |
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
- [x] **M2-T4** 对跨上下文消息做运行时校验；
- [x] **M2-T5** 建立 IndexedDB/Dexie 数据库；
- [x] **M2-T6** 实现任务创建、更新、查询和清理；
- [x] **M2-T7** 实现结构化错误模型；
- [x] **M2-T8** 为状态机、协议和存储编写测试。

验收门禁：

- 非法状态转换会被拒绝；
- 扩展后台重启后能读取任务；
- 非法页面消息不能触发后台操作；
- 数据库 schema 有明确版本；
- 单元测试覆盖主要成功和失败路径。

验收结果（2026-07-23）：

- [x] 状态机全状态对全状态矩阵验证非法转换均被拒绝；
- [x] 使用 fake IndexedDB 关闭并重开同名数据库后，可恢复读取非终态任务；
- [x] 协议运行时校验拒绝未知版本、类型、多余字段和非法负载，Background 仅处理通过守卫的请求；
- [x] Dexie schema 固定为显式版本 v1，并验证主键、普通索引和复合索引；
- [x] 8 个测试文件共 35 项测试覆盖状态机、协议、校验、错误、数据库和仓储的主要成功、失败与恢复路径。

---

### M3：当前页面 DOM 快照

目标：获取安全、稳定、可离线处理的当前页面快照。

- [x] **M3-T1** 获取当前标签页 URL、标题、base URL 和最终 URL；
- [x] **M3-T2** 实现可配置渲染等待；
- [x] **M3-T3** 克隆并序列化最终 DOM；
- [x] **M3-T4** 清理密码、Token 和敏感表单值；
- [x] **M3-T5** 记录 iframe、Shadow DOM 和不可访问区域；
- [x] **M3-T6** 收集 Performance Resource Timing；
- [x] **M3-T7** 实现超时、导航变化和标签关闭错误；
- [x] **M3-T8** 建立静态页和 SPA 测试 fixture。

验收门禁：

- 普通 HTML 与 React fixture 均能获得非空快照；
- 密码和敏感输入不会进入快照；
- 页面跳转时任务不会归档错误 origin；
- 快照包含可重复的页面元数据；
- 失败原因可在 Side Panel 中解释。

---

### M4：资源发现与资源图

目标：建立确定性、可递归、可去重的资源发现系统。

- [x] **M4-T1** 提取 DOM 中的 `src`、`href`、`srcset`、`poster`；
- [x] **M4-T2** 提取 inline style、SVG 和 `<style>` 资源；
- [x] **M4-T3** 使用 CSSTree 解析 `url()`、`@import` 和 `@font-face`；
- [x] **M4-T4** 合并 DOM、CSS 和 Performance 资源；
- [x] **M4-T5** 实现 URL 规范化、fragment 清理和 query 保留；
- [x] **M4-T6** 实现 `ResourceGraph` 及来源追踪；
- [x] **M4-T7** 识别 data URL、Blob URL 和不支持协议；
- [x] **M4-T8** 实现资源类型与 MIME 推断；
- [x] **M4-T9** 为复杂 URL、srcset、嵌套 CSS 编写测试。

验收门禁：

- 同一资源不会因不同发现来源被重复下载；
- 相对 URL 始终相对于正确文档或 CSS 文件解析；
- query 不会被错误丢弃；
- CSS 解析不依赖单一正则；
- 每个资源能追溯到发现来源和 referrer。

---

### M5：下载引擎与权限策略

目标：可靠、安全地下载已发现资源。

- [x] **M5-T1** 实现当前站点权限检查；
- [x] **M5-T2** 实现第三方域名汇总和按需授权；
- [x] **M5-T3** 实现受控并发队列；
- [x] **M5-T4** 实现 AbortController 暂停、取消基础；
- [x] **M5-T5** 实现超时、重试和 Retry-After；
- [x] **M5-T6** 记录重定向、final URL、状态码和 MIME；
- [x] **M5-T7** 实现单文件和任务总体积限制；
- [x] **M5-T8** 实现协议、origin 和本地网络安全策略；
- [x] **M5-T9** 实现资源失败不阻断主任务；
- [x] **M5-T10** 使用多域 fixture 做集成测试。

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
| 当前里程碑 | M6 路径映射与内容改写 |
| 当前任务 | 无进行中任务 |
| 最近完成 | M5-T10 使用多域 fixture 做集成测试 |
| 下一任务 | M6-T1 实现确定性域名目录和文件类型目录 |
| 阻塞项 | 无 |
| Git 仓库 | `git@github.com:coderGauche/webDown.git` |
| Git 同步策略 | 已完成任务提交并推送至 `origin/master` |
| 最近验证日期 | 2026-07-25 |

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
| 2026-07-23 | M2-T4 | 完成 | 新增 `src/messaging/validators.ts`，将运行时校验与 `protocol.ts` 类型/构造器分离；对 v1 信封、8 种消息类型、`CaptureSettings`、`JobCounters` 和 `CaptureJob` 实施严格逐层校验，拒绝未知版本/类型、缺失或多余字段、非法命令、越界设置和损坏任务状态；Background、Content 和 Side Panel 已改为只消费通过校验的消息；新增 `tests/messaging-validators.test.ts`；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（5 个文件、17 个测试）及 `pnpm build` 全部通过 |
| 2026-07-23 | M2-T5 | 完成 | 引入 `dexie@4.4.4` 和仅用于测试的 `fake-indexeddb@6.2.5`；新增 `src/storage/database.ts` 与存储模块导出，建立名为 `sitecapsule` 的 schema v1；`jobs` 表以 `id` 为主键，索引 `status`、`createdAt`、`updatedAt`、`[status+updatedAt]`；`resources` 表以 `id` 为主键，索引 `jobId`、`state`、`type`、`originalUrl`、`[jobId+state]`、`[jobId+originalUrl]`；`tests/database.test.ts` 验证 schema、复合索引及关闭后同名实例恢复数据；未提前实现仓储服务；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（6 个文件、19 个测试）及 `pnpm build` 全部通过 |
| 2026-07-23 | M2-T6 | 完成 | 新增 `src/storage/job-repository.ts` 及存储模块导出；`JobRepository` 实现任务创建/单个查询/按状态列表/可恢复任务查询、状态与计数器原子更新、单任务删除、按时间清理终态任务和全量清理；状态更新复用 M2-T2 状态机，非法转换会使 Dexie 事务回滚；删除与清理在同一事务中级联移除 `resources`；依赖注入支持确定性 ID/时钟测试；新增 `tests/job-repository.test.ts` 覆盖创建、更新、回滚、查询、重开恢复及两类清理；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（7 个文件、25 个测试）及 `pnpm build` 全部通过 |
| 2026-07-23 | M2-T7 | 完成 | 新增 `src/domain/errors.ts`，定义 14 个稳定错误码及统一的 `CaptureError`、`CaptureErrorContext`、`SiteCapsuleError`、错误目录、构造/校验/归一化函数；每个错误固定用户消息、`retryable` 和修复建议，诊断上下文仅允许操作、任务/资源 ID、URL、资源类型、阶段、HTTP 状态、受限浏览器错误名和视觉影响等白名单字段；未知异常不传递 message/stack；`ResourceRecord` 可持久化错误；状态机和仓储改为抛出结构化错误，Dexie 冲突/失效归一化为存储错误；错误响应由裸字符串升级为协议 v2，Background/Side Panel 已迁移；新增 `tests/errors.test.ts` 并更新状态机、仓储、协议与校验测试；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（8 个文件、30 个测试）及 `pnpm build` 全部通过 |
| 2026-07-23 | M2-T8 | 完成 | 为状态机增加 12×12 全状态转换矩阵，保证守卫和状态变更器一致；补齐页面采集请求、关联 ID、全部任务控制命令、任务成功/失败响应与更新事件协议测试；补齐仓储设置更新、缺失任务、排序/限制、恢复状态词汇及 completed/cancelled 终态级联清理边界；M2 五项验收门禁全部通过；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（8 个文件、35 个测试）及 `pnpm build` 全部通过 |
| 2026-07-24 | M3-T1 | 完成 | 新增 `PageMetadata`，由 Background 获取真实 `tabs.Tab.url`，Content 独立读取 `document.title`、`document.baseURI` 和 `document.URL`，并通过协议 v3 返回 Side Panel；修复 runtime Content Script 注入路径并显式请求可选 HTTP/HTTPS 权限；Chrome 150 在 `https://unitedcarriers.com/` 实测正确显示 Title、Tab URL、Base URL 和 Final URL；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（10 个文件、40 项测试）及 `pnpm build` 全部通过 |
| 2026-07-24 | M3-T2 | 完成 | 定义渲染等待默认值 `1000ms`、合法范围 `0-30000ms` 与运行时守卫；页面信息协议升级为 v4，Side Panel 将 `CaptureSettings.renderWaitMs` 经 Background 传到 Content，Content 使用异步定时器等待后读取页面；Side Panel 新增受边界约束的 `Render wait` 输入及等待状态；Chrome 150 手工验证 `3000ms` 延迟和 `0ms` 立即返回均正常；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（11 个文件、47 项测试）及 `pnpm build` 全部通过 |
| 2026-07-24 | M3-T3 | 完成 | Content 在渲染等待后深克隆 `documentElement`，将 doctype 与克隆后的 `html` 根元素序列化为 `PageSnapshot.serializedDom`，不读取或修改实时根节点；页面信息协议升级为 v5，Side Panel 显示快照字符数；Chrome 150 在 `https://unitedcarriers.com/` 实测生成 `436,895 chars` 快照；正常 doctype、缺失 doctype 和等待后动态内容均有自动化覆盖；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（12 个文件、50 项测试）、`pnpm build` 与 `git diff --check` 全部通过 |
| 2026-07-24 | M3-T4 | 完成 | 新增克隆 DOM 清理器，在序列化前清空 input、textarea、select、option、output 和 button 的当前值、勾选及选择状态；保留字段名称、类型、占位符、选项定义和页面结构；同时移除常见 Token/密钥属性、敏感 meta content 与自定义敏感字段值，不修改实时 DOM；Chrome 150 实测注入成功、结构保留、密码清理、隐藏 Token 清理、普通值清理和 Token 属性清理六项均为 `true`；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（13 个文件、66 项测试）、`pnpm build` 与 `git diff --check` 全部通过 |
| 2026-07-24 | M3-T5 | 完成 | 新增 `PageRegionDiagnostics`，遍历主文档及开放 Shadow Root，记录 iframe/Shadow Root 的稳定序号与嵌套深度；iframe 区分同源、跨源、沙箱、未就绪和访问拒绝，只保存脱敏后的 origin；关闭 Shadow Root 作为不可观测限制显式记录；页面信息协议升级为 v6，Side Panel 显示 iframe、开放 Shadow Root 和不可访问区域计数；Chrome 150 实测挂载、同源、跨源、沙箱、开放根、关闭根限制和仅 origin 七项均为 `true`；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（14 个文件、69 项测试）、`pnpm build` 与 `git diff --check` 全部通过 |
| 2026-07-24 | M3-T6 | 完成 | 新增 `PerformanceResourceRecord` 与 Resource Timing 归一化采集器，在渲染等待完成后的页面快照中读取 `performance.getEntriesByType('resource')`；仅保留无凭据 HTTP/HTTPS URL、稳定 initiator、起始/持续时间和 transfer/encoded/decoded 大小，移除 fragment、保留 query，并按规范化 URL 确定性去重保留最早观测；跨源零大小记录保留，非法条目过滤；页面信息协议升级为 v7，Side Panel 显示运行时资源数量；Chrome 150 实测响应、非空资源、URL 唯一、协议限制、fragment/凭据清理、initiator、时间和大小九项均为 `true`，并展示 10 条真实 Timing 记录；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（15 个文件、73 项测试）、`pnpm build` 与 `git diff --check` 全部通过 |
| 2026-07-24 | M3-T7 | 完成 | 新增可测试的页面捕获会话协调器，以 `renderWaitMs + 5000ms` 建立总截止时间；Background 监听目标标签页 `onUpdated`/`onRemoved`，在导航、刷新或关闭时立即返回独立结构化错误，并在成功前再次读取标签 URL；Content 在等待前后核对文档 URL，避免归档错误页面；超时后清理监听器并忽略迟到响应；新增 `page-capture-timeout`、`page-navigation-changed`、`tab-closed` 错误码，严格错误枚举变化使协议升级为 v8；Chrome 150 在真实页面跳转场景实测显示“捕获期间页面发生了跳转”；正常完成、超时、导航、关闭、最终 URL 复查和迟到响应均有自动化覆盖；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（16 个文件、79 项测试）、`pnpm build` 与 `git diff --check` 全部通过 |
| 2026-07-24 | M3-T8 | 完成 | 新增真实静态 HTML 与 React SPA fixture，引入仅测试使用且固定版本的 `happy-dom@20.11.1`；静态页覆盖 doctype/base、表单脱敏、沙箱 iframe 诊断和样式/图片 Timing，SPA 通过 React 延迟挂载覆盖渲染等待、动态标题与 DOM、运行时 Token 脱敏、开放 Shadow Root 和脚本/图片 Timing；两类页面均执行两次完整快照并验证结果一致，fixture 禁止依赖外部网络；格式脚本纳入测试 HTML；M3 普通 HTML/React 非空快照、敏感值清理、导航 origin 保护、元数据确定性和 Side Panel 可解释错误五项门禁全部满足；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（17 个文件、81 项测试）、`pnpm build` 与 `git diff --check` 全部通过 |
| 2026-07-24 | M4-T1 | 完成 | 新增 `src/discovery/dom-resources.ts` 与模块导出，按标签/属性白名单从最终 DOM 提取 `src`、`href`、`srcset` 和 `poster`；候选保留 DOM 来源、标签、属性、完整属性值、原始 URL、按 `document.baseURI` 解析后的 URL、文档 URL、base URL 和 `srcset` descriptor；`srcset` 使用状态扫描支持多个候选及 data URL 内逗号；排除 `<a>`/`<base>`、canonical/preconnect link、普通 input 和任意元素同名属性；重复、query、fragment 与非网络协议按阶段边界原样保留；候选进入 `PageSnapshot`，严格协议升级为 v9，Side Panel 显示 DOM 候选数；Chrome 150 在 `https://gpt123.uk/` 实测快照成功并发现 9 个 attribute candidates；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（18 个文件、86 项测试）、`pnpm build` 与 `git diff --check` 全部通过 |
| 2026-07-24 | M4-T2 | 完成 | 新增 `src/discovery/embedded-resources.ts` 与严格运行时校验，提取 inline `style`、`<style>` 文本、SVG 表现属性以及 SVG `href`/`xlink:href` 外部资源；CSS 源保留元素、属性、文档 URL 和 base URL 上下文，SVG 直接资源按 `document.baseURI` 解析；跳过空内容、非资源标签和 `#symbol` 文档内引用；CSS `url()` 与 `@import` 仅保留原文，不越界实现 M4-T3；候选进入 `PageSnapshot`，严格协议升级为 v10，Side Panel 显示 CSS/SVG 数量；Chrome 150 在 `https://gpt123.uk/` 实测发现 79 个 CSS 源、0 个 SVG 外部资源；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（19 个文件、90 项测试）、`pnpm build` 与 `git diff --check` 全部通过 |
| 2026-07-24 | M4-T3 | 完成 | 新增并锁定运行时依赖 `css-tree@3.2.1` 及类型依赖 `@types/css-tree@2.3.11`，新增 `src/discovery/css-resources.ts`，按 stylesheet、declaration-list 和 value 三种上下文解析 M4-T2 CSS 原文；结构化提取 `url()`、`@import` 和 `@font-face src`，记录 CSS 源序号、类型、元素/属性、声明属性、AST 偏移/行列位置、字体 `format()`、原始/解析 URL 和文档/base URL；支持引号、CSS 转义、空白、data URL 和 fragment，未闭合语法与非法源按单源容错；本阶段保留重复与协议差异，不越界合并资源；候选进入 `PageSnapshot`，严格协议升级为 v11，Side Panel 显示 AST 候选数；Chrome 150 在 `https://gpt123.uk/` 实测成功扫描 79 个 CSS 源并合法返回 0 个外部 AST 候选；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（20 个文件、94 项测试）、`pnpm build`（MV3 总计 448.76 kB）与 `git diff --check` 全部通过 |
| 2026-07-24 | M4-T4 | 完成 | 新增 `src/page/resource-discovery.ts` 及严格运行时校验，将 DOM 属性、SVG 属性、CSS AST 和 Performance 候选转换为统一发现证据；按当前解析后的精确 URL 分组，同 URL 保留每个通道、源序号与完整原始候选，`discoverySources` 按首次发现去重；输出按 DOM、SVG、CSS、Performance 及各自原始顺序稳定排列，不提前执行 M4-T5 URL 规范化；不伪造需要 `jobId`/类型/状态的持久化 `ResourceRecord`；合并结果进入 `PageSnapshot`，严格协议升级为 v12 并会重算校验合并内容，Side Panel 显示精确 URL/发现证据数；Chrome 150 在 `https://gpt123.uk/` 实测 9 个 DOM、0 个 SVG、0 个 CSS AST、21 个 Performance 候选合计 30 条发现证据，合并为 23 个精确 URL；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（21 个文件、98 项测试）、`pnpm build`（MV3 总计 455.57 kB）与 `git diff --check` 全部通过 |
| 2026-07-24 | M4-T5 | 完成 | 新增 `src/page/resource-url.ts`，基于 WHATWG `URL` 统一解析相对地址、主机/协议大小写、默认端口、点路径和网络路径 percent-encoding；HTTP/HTTPS 移除 fragment，query 的顺序、重复参数、空值、编码和值均保持不变，data/blob fragment 留待后续协议分类；M4-T4 合并键改为规范化 URL，同时完整保留每条原始发现证据并由严格校验器重算；Performance 采集复用同一规范化器；页面信息协议升级为 v13，Side Panel 显示规范化 URL 数；Chrome 150 在 `https://gpt123.uk/` 实测 `23 normalized URLs / 30 discoveries`，与预期一致；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（22 个文件、104 项测试）、`pnpm build`（MV3 总计 456.65 kB）与 `git diff --check` 全部通过 |
| 2026-07-24 | M4-T6 | 完成 | 新增 `src/page/resource-graph.ts`，定义 `ResourceGraph`、唯一 URL 节点和来源边；节点以 M4-T5 规范化 URL 为身份并保留首次发现来源，边记录规范化 `sourceUrl -> targetUrl`、来源通道、源序号及完整原始证据；DOM/SVG/CSS 使用候选文档 URL，Performance 使用快照最终 URL 作为来源；节点按首次发现、边按节点及证据顺序稳定生成；构建器、独立运行时校验和协议校验均拒绝重复节点/证据、错误序号、悬空目标、来源不一致和陈旧图；图进入 `PageSnapshot`，协议升级为 v14，Side Panel 显示节点/来源边数量；Chrome 150 在 `https://gpt123.uk/` 实测 `23 nodes / 30 provenance edges`，与 `23 normalized URLs / 30 discoveries` 一致；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（23 个文件、109 项测试）、`pnpm build`（MV3 总计 467.98 kB）与 `git diff --check` 全部通过 |
| 2026-07-24 | M4-T7 | 完成 | 新增 `src/page/resource-protocol.ts`，以严格判别联合将规范化资源分为 network、data、blob 和 unsupported；只有 HTTP/HTTPS 可设置 `networkFetchEligible: true`；data URL 不复制可能很大的载荷，节点 URL 保留完整内容，分类额外保存原始 header 和 percent/base64 编码标记，缺少逗号时标记畸形；Blob URL 标记 `document-session-bound`，无有效 origin/object 标识时标记畸形；Chrome 内部、扩展、file、FTP、JavaScript 和自定义协议均显式不可网络抓取；分类进入每个资源图节点并由 URL 严格重算，协议升级为 v15，Side Panel 显示四类计数；Chrome 150 在 `https://gpt123.uk/` 实测 `23 network / 0 data / 0 blob / 0 unsupported`，与 23 个图节点一致；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（24 个文件、116 项测试）、`pnpm build`（MV3 总计 474.53 kB）与 `git diff --check` 全部通过 |
| 2026-07-24 | M4-T8 | 完成 | 新增 `src/page/resource-inference.ts`，综合 data URL header、DOM/CSS 语义上下文、Performance initiator 和 URL 扩展名推断资源类型与 MIME 提示；推断结果记录来源、high/medium/low/unknown 置信度、完整去重证据和冲突标记，未知资源回退为 `other`，不将扩展名提示冒充真实响应 MIME；结果嵌入资源图节点并由原始发现证据严格重算，协议升级为 v16；Side Panel 新增类型、未知、MIME 提示和冲突统计；Chrome 150 在 `https://gpt123.uk/` 实测 `21 typed / 2 unknown / 20 MIME hints / 0 conflicts`，与 23 个图节点一致；`pnpm lint`、`pnpm format:check`、`pnpm exec tsc --noEmit`、`pnpm test -- --run`（25 个文件、141 项测试）、`pnpm build`（MV3 总计 495.72 kB）与 `git diff --check` 全部通过 |
| 2026-07-24 | M4-T9 | 完成 | 新增真实 `tests/fixtures/resource-pipeline/index.html` 与 `tests/resource-pipeline.test.ts`，将复杂 DOM/CSS/Performance 输入贯穿快照、规范化、合并、协议分类、资源图和类型推断；覆盖默认端口、点路径、编码路径、fragment 清理、重复 query、带逗号 data URL 的 `srcset`、descriptor/空白、嵌套 `@layer`/`@media`/`@supports`、`@import`、`@font-face`、转义 URL、重复发现、来源边和冲突证据；综合测试发现并修复 `@supports` 能力查询中的示例 URL 被误报为下载资源，真实嵌套声明仍正常发现；M4 五项验收门禁全部满足；Chrome 150 在真实页面回归捕获无报错；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test -- --run`（26 个文件、143 项测试）、`pnpm build`（MV3 总计 495.8 kB）与 `git diff --check` 全部通过 |
| 2026-07-24 | M5-T1 | 完成 | 重构 `src/permissions/page-access.ts`，从当前标签页 URL 生成 Chrome 支持的最小 scheme + 精确 hostname 权限模式，并以判别联合区分 granted、not-granted 和 restricted；Side Panel 先用 `permissions.contains` 检查，仅在缺失时请求当前 hostname，展示 `Current site access` 与实际模式；Background 在捕获前再次校验权限，拒绝绕过 UI 的未授权或受限页面；HTTP/HTTPS、默认端口、自定义端口、精确子域、缺失/非法 URL、Chrome/file/data 受限协议和权限 API 异常均有自动化覆盖；消息结构未变，协议保持 v16；Chrome 150 在 `https://www.seccw.com/` 实测显示 `Granted · https://www.seccw.com/*` 并成功读取页面；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test -- --run`（26 个文件、154 项测试）、`pnpm build`（MV3 总计 497.99 kB）与 `git diff --check` 全部通过 |
| 2026-07-24 | M5-T2 | 完成 | 新增 `src/permissions/third-party-access.ts`，从已校验的 `ResourceGraph` 中仅汇总可网络抓取且 hostname 不同于页面的第三方资源，按 scheme + 精确 hostname 权限模式稳定分组；相同模式保留实际 origin（含自定义端口）、唯一资源数、全部来源边数、发现来源和资源类型，HTTP/HTTPS 分组独立，data/Blob/不支持协议不进入授权；逐组使用 `permissions.contains` 区分 granted/pending，Side Panel 只允许勾选 pending 项，并在用户点击时仅请求明确选择的模式，授权后重新检查状态；全部已授权时明确显示 `All granted`；同站、子域、跨 scheme、重复 hostname、端口、非网络资源、空结果、无效图和权限 API 异常均有自动化覆盖；消息结构未变，协议保持 v16，未提前实现 M5-T3 下载队列；Chrome 150 在 `https://gpt123.uk/` 实测发现 `fonts.googleapis.com`、`static.cloudflareinsights.com`、`fonts.gstatic.com` 三组第三方资源，正确显示资源/来源统计和已授权状态，交互验收通过；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（27 个文件、158 项测试）、`pnpm build`（MV3 总计 503.19 kB）与 `git diff --check` 全部通过 |
| 2026-07-24 | M5-T3 | 完成 | 新增 `src/download/concurrent-queue.ts` 与下载模块导出，提供泛型 `runConcurrentQueue` 和正安全整数并发守卫；队列启动时快照输入，以共享递增索引稳定调度，最多创建 `min(concurrency, inputCount)` 个消费者，任何时刻运行任务不超过配置；每项结果以 `fulfilled/rejected` 判别联合保留原输入、索引、返回值或原始失败原因，输出按输入顺序对齐，单项同步/异步失败不会阻断后续任务；未加入 M5-T4 中止/暂停或 M5-T5 超时/重试语义；新增 `tests/concurrent-queue.test.ts` 覆盖空队列、精确并发峰值、每项只启动一次、乱序完成、同步/异步失败隔离、输入快照以及非法/合法并发边界；用户本机执行定向测试 12 项全部通过；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（28 个文件、170 项测试）、`pnpm build`（MV3 总计 503.19 kB）与 `git diff --check` 全部通过 |
| 2026-07-24 | M5-T4 | 完成 | 扩展 `src/download/concurrent-queue.ts`，在保持原三参数调用兼容的基础上增加可选 `AbortSignal`，并将同一信号传给所有已启动 worker；新增标准化且幂等的 `pauseConcurrentQueue`、`cancelConcurrentQueue`、`interruptConcurrentQueue`，冻结包含 pause/cancel 的中止原因，原生无原因 `abort()` 按 cancel 归一；消费者每次领取输入前检查信号，中止后不再启动新项；结果联合新增 `aborted` 和 `not-started`，分别表示已启动且合作式响应中止、尚未启动，已完成/普通失败仍保留原语义；活动项忽略信号但真实完成副作用时保持 `fulfilled`，避免恢复后重复下载；暂停通过本轮中止及 `not-started` 结果为后续恢复提供基础，不加入 M5-T5 超时/重试；定向测试覆盖启动前暂停、运行中取消、已完成+活动+排队混合状态、原生 abort、幂等与冻结原因、非法中止类型及取消/完成竞态，用户验收通过；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（28 个文件、175 项测试）、`pnpm build`（MV3 总计 503.19 kB）与 `git diff --check` 全部通过 |
| 2026-07-24 | M5-T5 | 完成 | 新增 `src/download/request-retry.ts` 及下载模块导出，将队列并发调度与单资源请求策略分离；每次尝试使用独立子 `AbortController` 和超时竞速，在成功、失败、超时和外部中止时清理定时器/监听器；默认单次超时 15 秒、最多重试 2 次、500 ms 指数退避且单次等待上限 30 秒，只对超时或调用方显式标记的可重试失败继续，抛出的未知异常不隐式重放；支持 408/425/429/500/502/503/504，严格解析 RFC 9110 `Retry-After` 的非负整数秒数和 IMF-fixdate/RFC850/asctime 日期，实际延迟取本地退避与服务器建议的较大值并受本地上限约束；返回结果显式区分成功、失败、中止、重试耗尽和超时，未提前实现 M5-T6 响应元数据记录；`tests/request-retry.test.ts` 27 项定向测试及用户验收通过；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（29 个文件、202 项测试）、`pnpm build`（MV3 总计 503.19 kB）与 `git diff --check` 全部通过 |
| 2026-07-24 | M5-T6 | 完成 | 新增 `src/download/resource-response.ts` 及下载模块导出，在不读取或替换 `Response` body 的前提下生成 original URL、final URL、HTTP 状态、成功标记和真实响应 MIME 元数据；`Content-Type` 去除参数、规范化大小写并严格拒绝缺失/非法 MIME；非 2xx 响应保留原响应和诊断元数据，并将 HTTP 可重试分类及 `Retry-After` 直接送入 M5-T5 策略；领域 `ResourceRecord` 新增可持久化 `redirectTrace`，完整观测时记录连续的单跳/多跳 3xx 链，标准 Fetch 只暴露最终结果时以 `complete: false` 保存 original → final 有效映射，不伪造中间跳转；写回纯函数校验资源归属、清除陈旧 MIME 并深复制重定向链；未实现 M5-T7 体积限制；`tests/resource-response.test.ts` 29 项定向测试及用户验收通过；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（30 个文件、231 项测试）、`pnpm build`（MV3 总计 503.19 kB）与 `git diff --check` 全部通过 |
| 2026-07-24 | M5-T7 | 完成 | 新增 `src/download/resource-size-limit.ts` 及下载模块导出，提供严格 `Content-Length` 解析、共享 `TaskByteBudget`、资源预算租约和可中止的流式 body 消费器；可信声明长度在打开 body 前预检单文件与剩余任务上限，缺失、非法或低报长度仍在逐块读取中按真实字节硬截止；并发资源以同步原子租约预留共享任务预算，sink 成功关闭后只提交实际字节并释放多余声明预留；超限、reader/sink 异常和外部 Abort 均立即取消读取、调用 sink `abort()` 且释放租约，使用结构化 `resource-limit-exceeded` 区分单文件/任务上限；`null` 保持无限制但仍执行安全整数计数；未实现 M5-T8 网络安全策略；`tests/resource-size-limit.test.ts` 25 项定向测试及用户验收通过；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（31 个文件、256 项测试）、`pnpm build`（MV3 总计 503.19 kB）与 `git diff --check` 全部通过 |
| 2026-07-24 | M5-T8 | 完成 | 新增 `src/download/resource-network-policy.ts` 及下载模块导出，使用 WHATWG URL 规范化请求目标并仅允许无嵌入凭据的 HTTP/HTTPS；拒绝 localhost、本地域名后缀、单标签主机，以及未指定、回环、私有、共享、链路本地、基准测试、组播和保留 IPv4/IPv6 地址，覆盖缩写、整数、十六进制和 IPv4 映射 IPv6 表示；每个公共目标按 scheme + 精确 hostname 生成 Chrome 权限模式，协议和子域互不继承；原始 URL、完整观测链的每个跳转目标和 final URL 使用同一策略复查，并缓存同一模式的权限结果；安全 Fetch 配置固定为省略 credentials、无 referrer、不使用缓存并保留 AbortSignal；标准 Fetch 无法在请求前解析 DNS 或公开未知中间跳转，未授权目标仍由 Chrome 精确 host permission 阻断，响应元数据用于事后复核；未实现 M5-T9 失败聚合；`tests/resource-network-policy.test.ts` 56 项定向测试及用户验收通过；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（32 个文件、312 项测试）、`pnpm build`（MV3 总计 503.19 kB）与 `git diff --check` 全部通过 |
| 2026-07-25 | M5-T9 | 完成 | 新增 `src/download/resource-download-batch.ts` 及下载模块导出，在 M5-T3/M5-T4 队列之上建立稳定的资源批次结果层；worker 可返回 saved/failed 结构化结果，同步异常、异步拒绝和非法 worker 输出均被隔离到对应资源并归一化为脱敏 `CaptureError`，次要资源失败不会停止后续项；调用方显式提供 `primaryResourceId`，仅该主文档失败生成 `fatalError` 和批次 `failed`，避免将站点抓取中的所有 document 误判为致命；批次状态区分 completed、completed-with-errors、failed、paused 和 cancelled，暂停/取消的 aborted/not-started 保留原资源状态且不计入失败；输出稳定输入顺序、逐资源结果、saved/failed/aborted/not-started/bytes 计数和可直接合并的 `JobCounters` 增量；校验唯一资源 ID、单任务归属、主资源存在、worker 返回身份及安全整数总字节；未实现 M5-T10 fixture 集成；`tests/resource-download-batch.test.ts` 11 项定向测试及用户验收通过；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（33 个文件、323 项测试）、`pnpm build`（MV3 总计 503.19 kB）与 `git diff --check` 全部通过 |
| 2026-07-25 | M5-T10 | 完成 | 新增无公网依赖的 `tests/fixtures/multi-origin-http.ts` 内存多 origin HTTP fixture 和 `tests/download-engine.integration.test.ts`；以 `.test` 公共形态域名模拟主站、已授权 CDN、未授权第三方、跨 origin 302、429 + Retry-After、503、404、单文件超限、本地 IP 和 data URL，将精确权限、安全策略、受控并发、重试、响应/重定向/MIME 元数据、流式体积限制及批次聚合贯穿同一流程；主场景 10 个资源得到 5 saved/5 failed、19 bytes，部分失败不阻断且资源记录与内存 sink 一致；共享预算场景并发提交严格停在 7 bytes；取消场景中活动请求中止且后续资源从未触达 fixture；M5 六项验收门禁全部满足；fixture 不解析真实 DNS、不替代 Chrome host permission 和真实浏览器跨域行为，相关限制继续由 D-043 管理；未实现 M6 路径映射/改写；3 项集成测试及用户验收通过；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`（34 个文件、326 项测试）、`pnpm build`（MV3 总计 503.19 kB）与 `git diff --check` 全部通过 |

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
| D-014 | 2026-07-23 | 跨上下文数据采用严格运行时校验，不允许未声明字段 | TypeScript 类型在运行时不存在，且 Content Script 所处页面不能被视为可信输入边界 | 协议扩展必须显式修改类型、构造器和校验器；非法页面消息不会进入 Background 处理逻辑 |
| D-015 | 2026-07-23 | IndexedDB 初始 schema 使用 `jobs` 和 `resources` 两张表，大文件不存入该库 | 任务恢复需要可查询的状态与资源元数据，二进制内容将由后续 OPFS 承担 | schema v1 支持按任务状态、更新时间、资源归属/状态和原 URL 查询；后续结构变更必须通过 Dexie 版本迁移 |
| D-016 | 2026-07-23 | 任务数据只通过可注入的 `JobRepository` 访问，状态更新和资源清理使用事务 | MV3 Service Worker 可随时重启，内存状态不能成为真相源；任务与资源分步删除会留下孤儿记录 | Background 后续从仓储重建非终态任务；非法状态转换不会部分写入；删除任务必然同步删除关联资源元数据 |
| D-017 | 2026-07-23 | 错误跨上下文传输使用严格 `CaptureError`，协议升级为 v2 | 裸字符串无法稳定区分重试策略，任意详情对象可能泄露页面内容、Token 或堆栈 | 错误码/文案/重试属性必须与目录完全匹配；上下文拒绝未声明字段；不兼容的 v1/v2 运行上下文会拒绝彼此消息，用户需重新加载扩展 |
| D-018 | 2026-07-23 | M2 状态机使用全状态转换矩阵测试，持久化测试使用 fake IndexedDB 和确定性时钟 | 示例路径无法证明所有非法转换均被拒绝，真实异步存储还需要覆盖重开、排序和级联清理 | 后续新增任务状态时必须同时更新矩阵；仓储行为变化需保留成功、失败和 Service Worker 重启恢复证据 |
| D-019 | 2026-07-24 | 页面信息协议升级为 v3，并按运行上下文区分元数据来源 | 标签页 URL 属于浏览器标签状态，标题、base URL 和最终 URL 属于已渲染文档；四者不能用同一个 `location.href` 代替 | Background 将 `tabs.Tab.url` 传给 Content；Content 读取 `document.title`、`document.baseURI`、`document.URL`；旧 v2 上下文需重新加载扩展 |
| D-020 | 2026-07-24 | 渲染等待默认 `1000ms`、范围 `0-30000ms`，并将页面信息协议升级为 v4 | 零等待适合静态页和快速调试，有限等待为异步渲染留出时间，上限防止错误设置导致长时间无响应 | 等待在 Content 中通过异步定时器执行；两段页面请求都携带并严格校验 `renderWaitMs`；旧 v3 上下文需重新加载扩展 |
| D-021 | 2026-07-24 | DOM 快照在 Content 中深克隆最终 `documentElement` 后序列化，并将页面信息协议升级为 v5 | 后续清理和重写必须与页面实时 DOM 隔离；仅使用 `innerHTML` 会丢失 doctype 和 `html` 根元素 | `serializedDom` 保留 doctype、根元素和渲染等待后的动态内容；后续 M3-T4 只能修改克隆副本；旧 v4 上下文需重新加载扩展 |
| D-022 | 2026-07-24 | 默认清除克隆 DOM 中全部标准表单当前状态，并对常见敏感标识做补充清理 | 仅依赖 `password`、`token` 等字段名会漏掉普通文本框中的个人信息；产品隐私承诺要求默认不归档输入框值 | 所有标准输入值、勾选和选择状态均不进入 `serializedDom`；敏感属性与 meta/custom 字段进一步清理；结构性字段和选项定义保留；实时页面不受影响 |
| D-023 | 2026-07-24 | 特殊区域使用独立诊断模型并将页面信息协议升级为 v6；关闭 Shadow Root 只记录全局不可观测限制 | iframe 访问能力受同源策略、sandbox 和加载状态影响；运行时注入无法发现页面此前创建的关闭 Shadow Root，不能将未知状态冒充成功捕获 | iframe 仅传输 ordinal、depth、access、reason 和无路径/查询参数的 origin；开放 Shadow Root 可递归发现；关闭根限制始终显式存在；旧 v5 上下文需重新加载扩展 |
| D-024 | 2026-07-24 | Resource Timing 使用独立发现记录并将页面信息协议升级为 v7；同 URL 保留最早有效观测 | M4 尚未建立资源图和 MIME 类型推断，提前创建完整 `ResourceRecord` 会混淆阶段边界；Performance 条目可能重复且跨源大小字段合法为零 | 仅接受无凭据 HTTP/HTTPS URL，移除 fragment、保留 query；initiator 归一化，非法数值过滤，零大小不丢弃；旧 v6 上下文需重新加载扩展 |
| D-025 | 2026-07-24 | 页面捕获采用 Background 生命周期协调器与 Content 文档 URL 双重校验，错误枚举变化将协议升级为 v8 | 单纯等待 `sendMessage` 无法区分超时、导航和标签关闭，且迟到响应可能把已失效页面误当作成功；严格校验器会拒绝旧版未知错误码 | 总超时固定为渲染等待加 5 秒；导航/关闭事件立即终止，成功前复查标签 URL，Content 等待前后复查文档 URL；监听器在所有终态释放；旧 v7 上下文需重新加载扩展 |
| D-026 | 2026-07-24 | M3 里程碑 fixture 使用真实 HTML、React 延迟渲染和仅测试依赖 `happy-dom@20.11.1` | 手写 DOM 对象适合单元边界测试，但无法证明克隆、表单属性、iframe、Shadow DOM 与 React 更新在真实 DOM API 下协同工作 | fixture 不执行外部网络请求；Resource Timing 使用确定性记录；测试 HTML 纳入 Prettier；`happy-dom` 不进入生产扩展包 |
| D-027 | 2026-07-24 | DOM 属性发现使用标签/属性白名单和结构化候选，页面信息协议升级为 v9 | 仅按属性名扫描会把页面导航、canonical、preconnect 和自定义同名属性误当成下载资源；后续改写还需要原始属性与 `srcset` descriptor | M4-T1 只解析相对地址并保留完整来源上下文；不去重、不清理 fragment、不筛协议、不推断类型；旧 v8 上下文需重新加载扩展 |
| D-028 | 2026-07-24 | 嵌入样式与 SVG 资源分成 CSS 文本源和 SVG 直接 URL 候选，页面信息协议升级为 v10 | inline style、`<style>` 和 SVG 表现属性是 CSS 语法载体，不能用字符串截取冒充完整 URL 解析；SVG `href` 则是可直接解析的属性 | M4-T2 保留 CSS 原文和定位上下文，留给 M4-T3 的 CSSTree 统一解析；SVG 仅接受白名单资源标签和 `href`/`xlink:href`，排除文档内 fragment；旧 v9 上下文需重新加载扩展 |
| D-029 | 2026-07-24 | CSS URL 发现使用 CSSTree AST 与独立 `CssResourceCandidate`，页面信息协议升级为 v11 | CSS 引号、转义、data URL、函数嵌套和容错语法不能由正则表达式可靠处理；资源合并属于 M4-T4 | 三种 CSS 源使用对应 parser context；候选保留 AST 位置和完整来源上下文；未闭合 URL/字符串不输出，单源失败不中断快照；data/fragment 仅发现不提前分类；旧 v10 上下文需重新加载扩展 |
| D-030 | 2026-07-24 | M4-T4 使用独立 `MergedResourceCandidate` 而非持久化 `ResourceRecord`，页面信息协议升级为 v12 | `ResourceRecord` 需要任务归属、资源类型和下载状态，当前阶段尚无真实值；URL 规范化和资源图分属 M4-T5/M4-T6 | 只按当前精确 URL 合并，fragment/query 行为不变；SVG 归为 DOM 来源但保留独立 `svg-attribute` 通道；合并记录内嵌完整证据，严格校验会从原始数组重算比对；旧 v11 上下文需重新加载扩展 |
| D-031 | 2026-07-24 | M4-T5 使用 WHATWG `URL` 建立唯一规范化入口，网络资源以无 fragment 且保留原 query 的 URL 合并，协议升级为 v13 | 字符串拼接无法可靠处理相对路径、默认端口、点路径和编码；fragment 通常不参与网络请求，而 query 可能决定资源内容，不能排序、解码或丢弃 | HTTP/HTTPS 路径 percent escape 统一为大写但不解码；query 原样保留；原始候选只作为证据不被覆盖；data/blob fragment 暂时保留供 M4-T7 分类；旧 v12 上下文需重新加载扩展 |
| D-032 | 2026-07-24 | M4-T6 将规范化资源 URL 作为节点身份，将每条发现证据建模为带完整候选的有向来源边，协议升级为 v14 | 仅在资源记录上保存来源数组会丢失具体 DOM/CSS/Performance 位置，无法支持后续递归发现、重写解释和诊断；当前尚未下载资源，不能伪造 MIME、状态或本地路径 | 图保留 `rootUrl`、稳定节点和 `sourceUrl -> targetUrl` 来源边；跨上下文校验从原始候选重算合并资源及整张图；协议分类留给 M4-T7，类型/MIME 留给 M4-T8；旧 v13 上下文需重新加载扩展 |
| D-033 | 2026-07-24 | M4-T7 使用判别联合表达 URL 协议策略并将分类嵌入资源图节点，协议升级为 v15 | URL 能被 WHATWG 解析不等于可由后台安全下载；data 需要本地解码，Blob 绑定创建它的文档会话，浏览器内部及自定义协议不得进入网络请求 | 只有 network 分类可声明网络抓取资格；data 仅保存 header/编码元数据且完整载荷留在唯一 URL 中；Blob 显式记录会话限制；畸形 data/Blob 归入 unsupported；MIME/资源类型推断留给 M4-T8；旧 v14 上下文需重新加载扩展 |
| D-034 | 2026-07-24 | M4-T8 使用分层证据推断资源类型与 MIME 提示并将结果嵌入资源图节点，协议升级为 v16 | 资源尚未下载时没有可信 HTTP 响应 MIME，单看扩展名会误判无扩展名、动态 URL 和冲突上下文；后续下载与重写还需要解释推断来源 | data header 和 DOM/CSS 语义优先于 Performance initiator，扩展名仅为低置信度提示；冲突保留全部证据，未知回退为 `other`；`mimeTypeHint` 不等于真实响应 MIME，后者留给 M5 下载阶段校验；旧 v15 上下文需重新加载扩展 |
| D-035 | 2026-07-24 | CSS AST 只将 `@import`、声明值和 SVG 表现属性 value 中的 URL 视为资源候选 | `@supports` 等 at-rule prelude 可以包含用于能力查询的示例 `url()`，浏览器不会因此下载该地址；无条件遍历所有 URL 节点会制造虚假资源 | 样式表和 style 属性要求 URL 位于真实 declaration；at-rule prelude 除 `@import` 外不产出资源；SVG 表现属性继续按独立 value context 解析；消息结构未变，协议保持 v16 |
| D-036 | 2026-07-24 | 当前站点访问使用可选全站能力声明和运行时精确 scheme + hostname 子集授权，Background 执行二次校验 | Chrome 允许从 `optional_host_permissions` 的宽模式请求单个 host 子集，但普通 host match pattern 不能按端口收窄且路径对 host permission 无效；只在 Side Panel 检查也可能被直接消息绕过 | Manifest 保留 `http://*/*` 与 `https://*/*` 作为可请求上限，运行时不直接请求这两个宽模式；页面 origin 保留端口用于诊断，权限模式省略端口；子域不使用通配符；消息结构未变，协议保持 v16 |
| D-037 | 2026-07-24 | 第三方权限按 scheme + 精确 hostname 汇总，并仅从用户明确勾选的 pending 模式构造请求 | 一个第三方 hostname 可能由多个 URL、端口和发现通道重复出现；直接请求全部发现域名会扩大权限，逐 URL 请求又不符合 Chrome host match pattern | 同 scheme/hostname 的自定义端口共享一个 Chrome 权限模式但保留 origin 诊断；跨 scheme 分组独立；已授权、未知或未选择模式不会进入请求；资源图和消息协议不因 UI 权限状态变化 |
| D-038 | 2026-07-24 | 下载并发基础采用输入快照、固定消费者和逐项判别联合结果 | `Promise.all` 一次启动全部资源会突破站点和浏览器承载能力；任一 rejection 使整体提前失败又会丢失其余资源结果；完成顺序不能替代资源身份 | 队列并发由正安全整数配置，消费者共享单调索引且结果写回原索引；同步/异步失败只影响对应项；取消、暂停、超时和重试由后续任务显式扩展 |
| D-039 | 2026-07-24 | 暂停与取消共用 AbortSignal 合作式中止，结果显式区分 aborted 与 not-started | AbortController 只能中止不能恢复，且活动异步操作可能响应信号、忽略信号后成功或产生普通失败；将所有未完成项笼统标为取消会丢失真实副作用状态 | 暂停中止本轮并由调用方以后重排 not-started 项；worker 必须接收信号；中止后不领取新项；响应中止的活动项为 aborted，未领取为 not-started，真实成功仍为 fulfilled；超时与重试留给 M5-T5 |
| D-040 | 2026-07-24 | 重试仅由结构化结果显式授权，每次尝试使用子 AbortSignal，`Retry-After` 与指数退避合并后受本地上限约束 | 未知异常可能已产生副作用，不能默认重放；超时必须只终止当前尝试而不污染整个队列；服务器等待值不能无界阻塞任务 | 调用方必须将 HTTP/网络失败归类为可或不可重试；默认最多 3 次尝试；外部取消可穿透尝试和退避阶段；M5-T6 只需关注响应元数据记录 |
| D-041 | 2026-07-24 | 重定向记录显式区分完整观测链与仅有效映射，响应 MIME 只取规范化 `Content-Type` essence | Fetch `Response.redirected` 和 `url` 不公开中间重定向，不能将 original → final 伪装成单跳完整链；推断 MIME 不能覆盖服务器真实响应 | `redirectTrace.complete` 表达观测完整性，深度模式可在有 CDP/网络观测时补齐每跳 3xx；缺失/非法 Content-Type 持久化为无 MIME，保留 M4 推断作为独立提示 |
| D-042 | 2026-07-24 | 体积限制采用 Content-Length 保守预留加实际流式硬计数，并发任务通过租约提交预算 | 响应可能缺失、伪造或低报 Content-Length，仅做头部检查会被绕过；并发流若各自查看已完成字节，可能同时通过并突破总上限 | 声明长度只决定预检/预留，实际 chunk 永远复查；sink 关闭前字节只处于 reserved，成功后提交 actual，所有失败路径取消 reader、回滚 sink 并释放租约 |
| D-043 | 2026-07-24 | 资源请求采用 URL 字面地址安全分类、精确 Chrome host permission 和响应 URL 复查三层策略 | 标准扩展 Fetch 不提供请求前 DNS 解析结果，也不保证公开自动跳转的全部中间响应；仅检查原始 URL 会留下凭据、私网字面地址、跨协议或跨 hostname 跳转风险 | 请求前只接受无凭据 HTTP/HTTPS 并拒绝已知本地/非公网主机表示；每个目标要求 scheme + 精确 hostname 授权，Chrome 权限作为未知跨域跳转的前置执行边界；已观测跳转链和 final URL 再次使用同一策略；DNS 重绑定和完整网络链审计留给后续深度模式/CDP 能力评估 |
| D-044 | 2026-07-25 | 下载批次将资源失败、任务致命失败和用户中断建模为三个独立维度 | 次要图片、字体或脚本失败不应让整个离线包丢失，但主文档失败后任务没有可交付入口；暂停/取消若写成 failed 会破坏恢复语义和失败统计 | 只有显式 `primaryResourceId` 对应资源失败产生 fatalError；其他失败持久化到各自 ResourceRecord 后批次继续；pause/cancel 保留 aborted/not-started 和原资源状态；聚合结果按输入顺序输出稳定计数，实际仓储写回由后续下载编排层执行 |
| D-045 | 2026-07-25 | M5 集成使用可注入的内存多 origin HTTP fixture，不监听 localhost 端口或访问公网 | localhost 会被 M5-T8 正确拒绝，公网测试又会引入 DNS、证书、服务可用性和限流的不确定性；测试绕过策略会让安全验收失真 | fixture 使用 `.test` URL 并仍通过真实权限/网络策略，只替换最终 I/O；可确定性控制响应、重试、跳转、流和中止；Chrome 权限执行、DNS 重绑定和浏览器网络栈差异保留为真实浏览器/M9 安全测试范围 |

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

下一步严格只执行 **M6-T1：实现确定性域名目录和文件类型目录**。

M6-T1 完成后必须：

1. 更新本文件中的任务勾选；
2. 从规范化 HTTP/HTTPS URL 和资源类型生成确定性的 origin 目录与文件类型目录，不依赖发现顺序或下载完成顺序；
3. 明确 scheme、hostname、非默认端口和资源类型的目录映射，保证同输入重复计算结果一致且不同 origin 不碰撞；
4. 覆盖默认端口、自定义端口、IPv4/IPv6、大小写和未知资源类型，不提前实现 M6-T2 文件名清理、M6-T3 query 哈希或冲突处理。
