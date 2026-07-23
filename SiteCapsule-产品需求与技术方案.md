# SiteCapsule 产品需求与技术方案

> 工作名称：SiteCapsule  
> 文档类型：PRD + 技术设计文档（TDD）  
> 版本：v0.1  
> 状态：立项草案  
> 目标平台：Google Chrome / Chromium，Manifest V3  
> 核心定位：将公开展示型网站保存为结构化 ZIP，并尽可能高保真地离线运行
> 执行台账：[SiteCapsule 开发执行计划与进度](./SiteCapsule-开发执行计划与进度.md)

---

## 1. 文档目的

本文档用于指导 SiteCapsule 从产品立项、MVP 开发、测试验收到后续商业化的完整过程，内容包括：

- 产品定位、目标用户和使用场景；
- 对标产品与技术可行性分析；
- 功能范围、优先级和验收标准；
- Chrome 扩展技术栈与系统架构；
- 网页捕获、资源发现、路径改写和 ZIP 生成流程；
- React/Vue/Next.js、Three.js/WebGL 等动态网站的处理策略；
- 隐私、权限、安全与 Chrome Web Store 合规要求；
- MVP 里程碑、测试矩阵、风险和后续路线图。

本文档不把竞品官网的营销描述视为已验证实现。所有产品能力均以 SiteCapsule 自身可测试、可度量、可验收为准。

---

## 2. 执行摘要

SiteCapsule 是一款 Chrome 扩展，用于把用户正在浏览的公开网页及其相关资源下载为结构化离线归档。归档内容包含 HTML、CSS、图片、字体、JavaScript、视频、音频、WASM、WebGL 模型和已发现的运行时资源，并通过 URL 改写使页面在本地尽可能保持原有视觉和交互效果。

产品首版不追求“下载任意网站”，而聚焦以下类型：

- 品牌官网与营销落地页；
- 设计工作室、作品集和创意展示站；
- React、Vue、Next.js 等公开前端页面；
- GSAP、Framer Motion 等动画页面；
- Three.js/WebGL 产品展示页；
- 无登录要求的文档、活动页和产品介绍页。

核心策略是确定性网页解析，不依赖 AI 完成基础抓取。AI 仅作为后续的失败诊断和修复建议能力，不参与资源正确性判断，也不是 MVP 依赖。

---

## 3. 背景与机会分析

### 3.1 用户问题

现有浏览器“网页另存为”通常存在以下问题：

- 只保存 HTML 和部分资源，样式或图片缺失；
- JavaScript 动态加载资源没有被发现；
- CSS 中的字体、背景图和 `@import` 被遗漏；
- 资源文件名和目录结构混乱，不便研究和交付；
- 绝对 URL、CDN URL 没有改写，断网后继续访问线上地址；
- ES Module、WASM、Three.js 模型在 `file://` 环境无法正常加载；
- 同一站点多页面之间的链接无法离线跳转；
- 缺少任务进度、失败原因、重试和归档报告。

### 3.2 对标产品分析结论

公开信息显示，对标产品主要强调：

- 从当前 Chrome 标签页开始捕获；
- 保存当前页面或在受控范围内爬取同站页面；
- 保存 HTML、CSS、图片、字体、脚本和媒体；
- 生成按域名组织的 ZIP；
- 支持渲染等待、并发下载、第三方脚本和媒体开关；
- 用于离线查看、研究、备份和客户交付。

视频截图同时暴露了典型的高阶问题：WebGL 页面在不同 GPU 环境下会请求不同的 KTX 压缩纹理，例如桌面常见的 S3TC 和移动设备常见的 ASTC。只保存捕获时实际加载的变体，换一台设备离线运行就可能出现 404、黑色材质或纹理解码失败。

这说明产品真正的壁垒不是“生成 ZIP”，而是：

- 完整发现资源；
- 可靠处理 URL 和文件路径；
- 在不同浏览器环境中恢复运行；
- 对失败进行可理解、可修复的诊断；
- 在 Chrome 扩展权限和生命周期约束下稳定完成大任务。

### 3.3 产品机会

SiteCapsule 不与大规模通用爬虫正面竞争，而是提供更适合设计研究、创意网站收藏和客户交付的工作流：

1. 从用户已经打开、已经渲染的页面开始；
2. 自动收集页面依赖和运行时资源；
3. 输出可检查、可交付的目录结构；
4. 对动画和 WebGL 网站做专门适配；
5. 明确报告哪些内容成功、失败或仍依赖线上服务。

---

## 4. 产品定位

### 4.1 一句话定位

将公开展示型网站一键保存为结构化、可诊断、可离线运行的 ZIP 归档。

### 4.2 核心价值

- **高保真**：优先保持视觉、字体、动画和公开前端交互；
- **可检查**：资源单独保存，不隐藏在单个不可读文件中；
- **可交付**：生成清晰的 ZIP、归档清单和失败报告；
- **本地优先**：网页内容默认不上传到产品服务器；
- **范围可控**：页面数量、站点范围、深度和资源类型均可配置。

### 4.3 目标用户

| 用户 | 主要需求 |
|---|---|
| UI/UX 设计师 | 收藏并研究优秀官网、动画和交互细节 |
| 前端开发者 | 离线分析页面结构、资源和构建产物 |
| 创意开发者 | 保存 Three.js/WebGL 案例和实验站点 |
| 市场与品牌团队 | 保留活动页、竞品页面和历史版本 |
| 代理商与自由职业者 | 为客户交付可检查的页面归档 |
| 研究与合规人员 | 保存公开网页证据和参考资料 |

### 4.4 非目标用户

- 需要批量镜像数十万页面的爬虫用户；
- 需要复制登录系统、支付、账号或后台业务的用户；
- 试图绕过访问控制、付费墙或反爬机制的用户；
- 需要完整恢复服务端数据库和 API 的用户。

---

## 5. 产品原则

1. **准确优先于智能猜测**：HTML、CSS 和 URL 使用解析器处理，不用 AI 猜测依赖关系。
2. **默认最小权限**：标准捕获使用 `activeTab` 和按需站点权限，深度捕获另行授权。
3. **本地优先**：捕获内容默认只在用户浏览器和本地文件中处理。
4. **明确能力边界**：不承诺服务端功能离线可用。
5. **结果可解释**：每次任务输出成功、跳过、失败和线上依赖清单。
6. **渐进增强**：普通页面先稳定，再扩展到 WebGL 和复杂运行时资源。
7. **尊重授权与版权**：仅用于用户有权访问和归档的内容。

---

## 6. 目标与成功指标

### 6.1 MVP 目标

- 能从当前标签页保存单个公开网页；
- 能发现并保存 HTML、CSS、图片、字体、JS 和常见媒体；
- 能正确改写 HTML 和 CSS 中的资源 URL；
- 能生成结构化 ZIP 和机器可读的归档清单；
- 能显示实时进度、失败原因并重试；
- 能在本地 HTTP 环境中打开多数公开营销页；
- 默认不上传捕获内容。

### 6.2 建议指标

| 指标 | MVP 目标 |
|---|---:|
| 基础测试站点成功归档率 | >= 90% |
| 公开营销页主要视觉资源完整率 | >= 95% |
| 归档内失效本地资源请求占比 | <= 5% |
| 单资源失败可解释率 | 100% |
| 用户取消任务响应时间 | <= 2 秒 |
| 归档报告生成率 | 100% |
| 捕获内容上传产品服务器 | 0 |

指标需基于固定测试集统计，不能只挑选成功案例。

---

## 7. 功能范围与优先级

### 7.1 P0：MVP 必须具备

- 保存当前页面；
- 读取当前已渲染 DOM；
- 可配置渲染等待时间；
- DOM、CSS 和 Performance Resource Timing 三路资源发现；
- 下载 HTML、CSS、图片、字体、JS、视频、音频和常见二进制资源；
- 同域与第三方资源权限提示；
- URL 规范化、去重、路径映射和文件名冲突处理；
- HTML/CSS 资源地址改写；
- 并发、暂停、继续、取消和失败重试；
- ZIP 导出；
- `archive.json`、资源清单和错误报告；
- 中英文界面；
- 基础离线查看说明。

### 7.2 P1：产品可用性增强

- 同站点受控爬取；
- 最大深度、最大页面数、允许列表和阻止列表；
- 自动滚动以触发懒加载；
- iframe 与 Shadow DOM 资源发现；
- WebGL 深度资源模式；
- glTF/GLB、Draco、Meshopt、KTX/KTX2、Basis、HDR、EXR、WASM 适配；
- 可选 Chrome Debugger/CDP 网络捕获；
- JavaScript 已知 URL 的安全改写；
- 归档导入、重新打开和二次修复；
- 流式 ZIP，降低大任务内存占用；
- 本地查看器或轻量桌面辅助程序。

### 7.3 P2：高级与商业化能力

- 自动失败诊断和修复建议；
- 可选 AI 诊断，但不上传完整网页源文件；
- 定时归档与版本对比；
- 团队归档规范、命名模板和共享配置；
- WARC/MHTML 等额外导出格式；
- 页面截图、完整页截图和视觉差异报告；
- 归档签名和内容哈希证明；
- 授权、订阅、团队席位和企业策略。

### 7.4 明确不做

- 绕过登录、验证码、付费墙和访问控制；
- 复制服务端 API、数据库、账号和支付功能；
- 自动提交表单或执行有外部副作用的操作；
- 默认无限深度爬取；
- 自动发布、部署或重新托管他人网站；
- 承诺所有动态功能完全离线可用。

---

## 8. 核心用户流程

### 8.1 首次使用

```text
安装扩展
  -> 打开公开网页
  -> 点击扩展图标
  -> 阅读本地处理和权限说明
  -> 选择标准捕获
  -> 按需授权当前站点
  -> 开始归档
```

### 8.2 保存当前页面

```text
打开目标页面
  -> 打开 Side Panel
  -> 选择“当前页面”
  -> 设置渲染等待、媒体、第三方资源
  -> 点击“开始捕获”
  -> 页面快照与资源发现
  -> 下载、改写和打包
  -> 查看归档报告
  -> 下载 ZIP
```

### 8.3 同站点爬取

```text
选择“站点范围”
  -> 设置起始 URL、最大深度和最大页面数
  -> 配置允许/阻止规则
  -> 预估捕获范围
  -> 用户确认
  -> 队列爬取
  -> 去重、资源下载和链接改写
  -> ZIP 与报告
```

### 8.4 深度捕获

```text
标准捕获检测到 WebGL/WASM/大量动态请求
  -> 提示可启用深度捕获
  -> 解释 Debugger/CDP 权限用途
  -> 用户主动授权
  -> 记录运行时网络请求
  -> 可选自动滚动和等待
  -> 保存动态资源及响应信息
  -> 断开调试连接
```

---

## 9. 页面与交互设计

### 9.1 Side Panel 信息架构

1. **任务设置**
   - 当前页面 / 站点范围分段控件；
   - 起始 URL；
   - ZIP 文件名；
   - 渲染等待时间；
   - 并发数；
   - 媒体、脚本、第三方资源开关；
   - 标准 / 深度捕获模式。

2. **任务执行**
   - 当前阶段；
   - 已发现、已下载、失败、跳过数量；
   - 页面队列和资源队列；
   - 当前传输速率与已处理体积；
   - 暂停、继续和取消按钮。

3. **任务结果**
   - 完整度评分；
   - ZIP 大小；
   - 失败资源列表；
   - 仍依赖线上服务的功能；
   - 下载 ZIP、复制报告、重新尝试。

4. **历史记录**
   - 只保存任务元数据；
   - 可重新下载尚在本地存储中的归档；
   - 可清理缓存和历史。

### 9.2 任务状态机

```text
idle
  -> preparing
  -> discovering
  -> fetching
  -> rewriting
  -> packaging
  -> completed

任意执行状态 -> paused（记录 resumeStatus）-> 原状态
任意执行状态 -> cancelling -> cancelled
任意执行状态 -> failed -> retrying -> preparing
```

`completed` 和 `cancelled` 为终态，不允许继续转换。暂停只能恢复到进入 `paused` 前记录的执行状态；失败重试从 `preparing` 重新开始，避免在缺少持久化阶段上下文时跳入不完整的中间流程。

### 9.3 错误呈现原则

禁止只显示“下载失败”。错误至少包含：

- 原始 URL；
- 资源类型；
- HTTP 状态或浏览器错误；
- 失败阶段；
- 是否影响页面主要视觉；
- 可执行的重试或修复建议。

---

## 10. 输出 ZIP 规范

### 10.1 建议目录结构

```text
sitecapsule-example.com-20260722.zip
├── index.html
├── pages/
│   ├── about/index.html
│   └── work/index.html
├── assets/
│   ├── example.com/
│   │   ├── css/
│   │   ├── js/
│   │   ├── images/
│   │   ├── fonts/
│   │   └── media/
│   └── cdn.example.net/
├── _sitecapsule/
│   ├── archive.json
│   ├── resources.json
│   ├── failures.json
│   ├── original-urls.json
│   ├── report.html
│   └── README_OFFLINE.md
└── screenshots/
    └── page.png
```

### 10.2 `archive.json` 示例

```json
{
  "formatVersion": 1,
  "product": "SiteCapsule",
  "capturedAt": "2026-07-22T12:00:00.000Z",
  "startUrl": "https://example.com/",
  "finalUrl": "https://example.com/",
  "mode": "current-page",
  "captureProfile": "standard",
  "pages": 1,
  "resources": 142,
  "failedResources": 3,
  "requiresLocalHttpServer": true,
  "onlineDependencies": [
    "https://api.example.com/"
  ]
}
```

### 10.3 可重复性要求

- 相同 URL 在同一任务中只能映射到一个确定路径；
- 路径映射不得依赖下载完成顺序；
- 文件名冲突必须通过稳定哈希处理；
- 原始 URL 与本地路径映射必须写入清单；
- 每个文件可选记录 SHA-256、MIME、状态码和内容长度。

---

## 11. 技术栈

### 11.1 推荐选型

| 层级 | 技术 | 选择原因 |
|---|---|---|
| 语言 | TypeScript | Chrome 扩展原生生态，适合复杂任务状态和数据模型 |
| 扩展框架 | WXT | 支持 MV3、文件式入口、多浏览器构建和开发热更新 |
| UI | React | 适合 Side Panel、任务状态和配置表单 |
| 构建 | Vite（由 WXT 集成） | 构建速度快，TypeScript 生态成熟 |
| 状态管理 | Zustand 或轻量 reducer | 管理 UI 状态，避免与任务持久化混用 |
| 任务元数据 | IndexedDB + Dexie | 支持任务、资源索引和断点状态 |
| 大文件临时存储 | OPFS / File System Access API | 避免所有资源长期堆积在内存中 |
| CSS 解析 | CSSTree | AST 级解析、遍历和重新生成 CSS |
| HTML 解析 | 浏览器 DOMParser | 避免正则处理 HTML |
| JS 模块分析 | es-module-lexer，P1 | 处理静态 import 和动态 import 字面量 |
| ZIP | fflate | 浏览器可用，支持流式 ZIP，体积较小 |
| 并发队列 | 自研受控队列 | 需要暂停、取消、优先级、重试和体积限制 |
| 单元测试 | Vitest | 与 Vite/TypeScript 配合 |
| 扩展端到端测试 | Playwright + Chromium | 自动安装扩展、执行捕获并验证结果 |
| 代码质量 | ESLint + Prettier | 统一代码规范 |
| 包管理 | pnpm | 安装速度和工作区管理 |

### 11.2 为什么不使用 Python 作为核心

Chrome 扩展的 Content Script、Service Worker、Side Panel 和 Chrome API 均运行 JavaScript。Python 只能作为可选的本地查看器、开发脚本或服务端，不能直接替代扩展运行时。

产品首版建议保持纯 TypeScript，减少安装步骤和跨平台问题。若后续需要面向普通用户提供双击即开的本地 HTTP 环境，再评估 Tauri/Rust 或独立桌面辅助程序，不建议先引入 Python 常驻进程。

### 11.3 可选商业化后端

若需要账号、授权和订阅，可使用：

- Cloudflare Workers：API 与授权校验；
- D1/PostgreSQL：账号、订阅和设备记录；
- Stripe/Paddle：支付；
- 对象存储：只存产品更新或用户主动上传的归档。

捕获页面内容与资源不得因为授权校验而默认上传。

---

## 12. Chrome 扩展架构

### 12.1 组件划分

```text
Side Panel UI
  | 配置、进度、用户操作
  v
Service Worker
  | 权限、任务编排、消息路由、下载导出
  +-------------------------+
  |                         |
  v                         v
Content Script         Offscreen/Worker Runtime
DOM 快照、资源发现       解析、改写、ZIP、临时存储
  |
  v
目标网页 MAIN World Observer（按需）
运行时 fetch/XHR/资源线索，不持有扩展高权限
```

### 12.2 各组件职责

#### Side Panel

- 收集任务配置；
- 发起用户手势和权限请求；
- 展示任务进度和错误；
- 保持长任务期间的可见控制面；
- 不承担关键任务真相源。

#### Service Worker

- 创建和恢复任务；
- 调度页面与资源队列；
- 请求 `activeTab`、站点和下载权限；
- 与 Content Script、Offscreen Runtime 通信；
- 在生命周期终止后通过持久化状态恢复；
- 不在内存中保存唯一任务状态。

#### Content Script

- 获取最终 DOM 快照；
- 收集 `src`、`href`、`srcset`、`poster` 等属性；
- 收集内联样式、`<style>`、Shadow DOM 和 iframe 线索；
- 读取 Performance Resource Timing；
- 可选执行自动滚动；
- 不直接执行跨域资源下载。

#### Offscreen/Worker Runtime

- 解析 HTML 和 CSS；
- 进行路径映射与内容改写；
- 处理二进制数据；
- 生成 ZIP；
- 降低 Service Worker 生命周期对任务的影响。

#### MAIN World Observer

- 仅在标准 API 无法发现运行时 URL 时按需启用；
- 可记录 `fetch`、XHR、Worker、WebSocket 等调用线索；
- 只能发送经过验证的数据；
- 不允许目标网页构造任意扩展高权限请求。

---

## 13. 权限设计

### 13.1 基础权限

建议评估以下权限，最终以最小集合为准：

- `activeTab`：用户点击后访问当前标签页；
- `scripting`：注入捕获脚本；
- `storage`：保存配置和任务元数据；
- `downloads`：导出 ZIP；
- `sidePanel`：提供稳定任务界面；
- `offscreen`：执行需要 DOM/Blob 的后台工作；
- 按需 `host_permissions`：下载目标站及第三方资源。

### 13.2 深度捕获权限

`debugger` 权限只能用于用户主动开启的深度捕获，界面必须解释：

- 为什么需要；
- 何时附加到标签页；
- 捕获哪些网络信息；
- 任务结束后立即断开；
- 不读取无关标签页。

标准模式不得要求 Debugger 权限。

### 13.3 权限安全规则

- 只允许 `http:` 和 `https:` 资源；
- 拒绝 `chrome:`、`chrome-extension:` 和系统页面；
- 默认阻止访问本机和局域网地址，除非产品明确支持并再次确认；
- Content Script 只能提交资源线索，不能命令后台获取任意协议；
- 捕获任务必须绑定发起任务的 `tabId` 和主文档 origin；
- 每次跳转后重新验证站点范围。

---

## 14. 核心实现流程

### 14.1 总流程

```text
1. 校验目标页面和权限
2. 建立任务并持久化配置
3. 等待渲染和可选自动滚动
4. 获取最终 DOM 快照
5. 合并多路资源线索
6. 规范化 URL 并建立资源图
7. 下载资源并递归解析 CSS/HTML
8. 计算本地路径并处理冲突
9. 改写 HTML、CSS 和可安全识别的 JS URL
10. 生成报告与 archive.json
11. 流式生成 ZIP
12. 保存并清理临时数据
```

### 14.2 资源发现

#### DOM 资源

- `img[src]`、`img[srcset]`；
- `picture source[srcset]`；
- `script[src]`；
- `link[href]`，按 `rel` 判断 CSS、图标、预加载和 manifest；
- `video[src]`、`audio[src]`、`source[src]`、`track[src]`；
- `object[data]`、`embed[src]`；
- `iframe[src]`；
- `meta[property="og:image"]` 等可选资源；
- inline style 与 SVG 中的 URL；
- `<a href>`，仅作为页面爬取候选。

#### CSS 资源

- `url(...)`；
- `@import`；
- `@font-face src`；
- source map；
- 嵌套 CSS 依赖。

CSS 必须使用 AST 解析，禁止用单个正则表达式替换全部 URL。

#### 运行时资源

- `performance.getEntriesByType('resource')`；
- `PerformanceObserver`；
- 深度模式下的 CDP Network 事件；
- 可选 MAIN World 的 fetch/XHR URL 观察；
- WebGL 加载器常见扩展名线索。

### 14.3 URL 规范化

每个 URL 按以下顺序处理：

1. 使用 `new URL(value, documentBaseUrl)` 解析；
2. 移除 fragment；
3. 保留影响内容的 query；
4. 规范默认端口和 hostname 大小写；
5. 根据重定向后的 final URL 去重；
6. 记录 original URL、final URL 和 referrer；
7. 根据内容类型和路径生成本地文件名；
8. 查询参数通过稳定短哈希区分文件冲突。

示例：

```text
https://cdn.example.com/image?id=1&size=large
-> assets/cdn.example.com/image__q_a81f42.webp
```

### 14.4 下载调度

资源队列需支持：

- 最大并发；
- 同域并发限制；
- AbortController 取消；
- 指数退避重试；
- HTTP 429/503 的 `Retry-After`；
- 单文件与任务总大小限制；
- MIME 与扩展名校验；
- 重定向链记录；
- 优先级：HTML/CSS > 字体/图片 > JS > 大型媒体；
- 失败不阻断整个归档，除非主 HTML 失败。

### 14.5 HTML 改写

使用 DOMParser 处理：

- 将已保存资源改写为相对路径；
- 将已捕获页面链接改写为本地 HTML；
- 保留未捕获外部链接并标记为线上依赖；
- 移除或调整 CSP `<meta>`，但必须记录修改；
- 禁用原站 Service Worker 注册；
- 注入最小 `archive-runtime.js`，仅用于路径映射和错误诊断；
- 不执行未知 HTML 字符串拼接。

### 14.6 CSS 改写

使用 CSSTree：

1. 解析 CSS 为 AST；
2. 遍历 URL 和 Import 节点；
3. 解析相对于 CSS 文件自身的绝对 URL；
4. 查询资源路径映射；
5. 生成相对于当前 CSS 文件的路径；
6. 重新生成 CSS；
7. 解析失败时保留原始文件并写入报告。

### 14.7 JavaScript 处理

P0 原则：不通用重写任意 JavaScript，因为错误修改压缩代码的风险很高。

P1 可逐步支持：

- 静态 `import` 和字面量动态 `import()`；
- sourceMappingURL；
- 已知原站 origin 的完整字符串 URL；
- `fetch()`、XHR 的运行时映射层；
- Worker 和 WASM 的字面量 URL。

所有 JS 改写必须记录原文件哈希、修改规则和修改后哈希，并允许关闭。

### 14.8 ZIP 生成

MVP 可先限制任务总大小并使用 Blob ZIP。P1 使用 fflate 流式接口，将条目逐步写入用户选择的文件句柄，避免数百 MB 资源同时常驻内存。

ZIP 条目顺序建议稳定：

1. 主页面；
2. 其他页面；
3. CSS 和字体；
4. 图片和媒体；
5. JS/WASM/模型；
6. `_sitecapsule` 元数据。

---

## 15. 标准捕获与深度捕获

### 15.1 标准捕获

适用：普通官网、营销页、文档和大多数 SPA。

数据来源：

- 最终 DOM；
- CSS 递归依赖；
- Performance Resource Timing；
- 对发现 URL 的扩展后台重新请求。

优点：权限较少，用户信任成本低。  
缺点：可能遗漏无法重新请求的响应体、Blob URL 和短生命周期请求。

### 15.2 深度捕获

适用：WebGL、复杂运行时加载、Blob 资源、请求 URL 难以复现的页面。

可使用 Chrome Debugger/CDP：

- 监听 Network 请求；
- 获取响应元数据；
- 对必要资源读取响应体；
- 识别请求发起者和资源类型；
- 任务结束后立即 detach。

深度捕获必须是显式选项，不应成为默认权限。

---

## 16. Three.js/WebGL 专项方案

### 16.1 常见资源

- `.gltf`、`.glb`；
- `.bin`；
- `.obj`、`.fbx`；
- `.ktx`、`.ktx2`、`.basis`；
- `.hdr`、`.exr`；
- `.wasm`；
- Draco、Meshopt、Basis/KTX 解码器；
- GLSL Shader；
- JSON 场景与资源 manifest；
- 视频纹理和立方体贴图。

### 16.2 GPU 纹理变体问题

页面可能根据 GPU 能力选择：

```text
compressed/s3tc/
compressed/astc/
compressed/etc1/
compressed/etc2/
compressed/pvrtc/
```

若归档只保存捕获设备使用的 ASTC，另一台只支持 S3TC 的桌面设备可能无法显示纹理。

P1 处理策略：

1. 检测到 KTX/KTX2 或压缩纹理目录；
2. 扫描已下载 JS、manifest 和 loader 配置中的变体路径；
3. 对同命名资源尝试发现其他格式变体；
4. 仅下载存在且在任务体积限制内的变体；
5. 在 `resources.json` 中标记 GPU capability group；
6. 不允许把 ASTC 文件简单伪装成 S3TC 路径；
7. 缺少变体时在报告中明确说明设备兼容性风险。

### 16.3 WebGL 验收

- 模型几何体可见；
- 材质不是纯黑或错误占位；
- 控制台无关键纹理 404；
- WASM/decoder 使用正确 MIME；
- 在至少两种 GPU 能力环境或软件渲染环境验证；
- 页面动画在断网环境中继续运行。

---

## 17. 离线运行策略

### 17.1 为什么不能只依赖 `file://`

以下功能在双击 HTML 时容易失败：

- ES Module；
- `fetch()` 加载 JSON、模型和 WASM；
- Worker；
- MIME 检查；
- History 路由；
- 部分跨域和安全策略。

因此产品需要区分：

- **简易离线模式**：静态页面可直接打开；
- **高保真模式**：通过 `http://127.0.0.1` 本地服务器访问。

### 17.2 MVP 方案

ZIP 中提供 `README_OFFLINE.md` 和明确的本地 HTTP 启动说明。产品界面必须说明哪些页面需要本地服务器。

### 17.3 正式产品方案

优先级从高到低：

1. 开发轻量桌面 Viewer，负责解压和启动本地 HTTP；
2. 扩展提供归档管理并调用 Viewer；
3. 对技术用户保留标准 ZIP 和任意静态服务器兼容性；
4. 不通过危险方式绕过 Chrome 安全限制。

仅靠 Chrome 扩展导出 ZIP 容易完成，但要让普通用户“双击即运行”需要额外的本地查看能力，这是独立产品模块。

---

## 18. 数据模型

```ts
type CaptureMode = 'current-page' | 'site-crawl';
type CaptureProfile = 'standard' | 'deep';

interface CaptureJob {
  id: string;
  tabId: number;
  startUrl: string;
  mode: CaptureMode;
  profile: CaptureProfile;
  status: JobStatus;
  settings: CaptureSettings;
  counters: JobCounters;
  createdAt: string;
  updatedAt: string;
}

interface ResourceRecord {
  id: string;
  originalUrl: string;
  finalUrl?: string;
  referrerUrl: string;
  type: ResourceType;
  mime?: string;
  status?: number;
  localPath?: string;
  byteLength?: number;
  sha256?: string;
  state: 'discovered' | 'queued' | 'fetching' | 'saved' | 'failed' | 'skipped';
  error?: CaptureError;
}

interface UrlMapping {
  originalUrl: string;
  finalUrl: string;
  localPath: string;
  source: 'dom' | 'css' | 'performance' | 'cdp' | 'crawler';
}
```

---

## 19. 关键算法伪代码

### 19.1 当前页面捕获

```ts
async function captureCurrentPage(job: CaptureJob) {
  await ensurePermissions(job);
  await persistJob(job);

  const snapshot = await captureRenderedDocument(job.tabId, job.settings);
  const graph = createResourceGraph(snapshot.finalUrl);

  graph.addMany(discoverFromDom(snapshot.html));
  graph.addMany(snapshot.performanceResources);

  while (graph.hasPendingResources()) {
    const resource = graph.next();
    const response = await fetchWithPolicy(resource, job.settings);
    const localPath = mapUrlToLocalPath(response.finalUrl, response.mime);

    await storeResource(localPath, response.body);
    graph.markSaved(resource, localPath);

    if (isCss(response)) {
      graph.addMany(discoverFromCss(response.text, response.finalUrl));
    }
  }

  await rewriteCapturedDocuments(graph);
  await generateArchiveMetadata(job, graph);
  await exportZip(job, graph);
}
```

### 19.2 同站爬取判定

```ts
function mayVisit(candidate: URL, context: CrawlContext): boolean {
  if (!['http:', 'https:'].includes(candidate.protocol)) return false;
  if (context.visited.has(normalizePageUrl(candidate))) return false;
  if (context.depth > context.settings.maxDepth) return false;
  if (context.pages >= context.settings.maxPages) return false;
  if (!matchesAllowedScope(candidate, context.settings)) return false;
  if (matchesBlockedRule(candidate, context.settings)) return false;
  return true;
}
```

---

## 20. 非功能需求

### 20.1 性能

- 默认并发建议 6，可配置 1-12；
- 大于配置上限的单文件需确认或跳过；
- 任务总大小达到阈值时暂停并提示；
- UI 更新节流，避免每个字节触发 React 重渲染；
- 二进制数据避免不必要复制；
- ZIP 优先流式写入。

### 20.2 稳定性

- Service Worker 被终止后可以从 IndexedDB 恢复；
- 下载任务支持 AbortController；
- 所有阶段幂等，重复恢复不会产生路径漂移；
- ZIP 生成失败不得删除已完成的临时资源；
- 任务完成或用户清理后回收 OPFS/IndexedDB 数据。

### 20.3 可维护性

- 抓取策略、路径映射和改写规则独立模块化；
- 每个特殊站点规则必须有测试，不允许无限堆积硬编码；
- 归档格式带 `formatVersion`；
- 日志使用结构化事件，不记录页面正文和敏感表单值。

### 20.4 国际化

- MVP 支持简体中文和英文；
- 产品文案与错误码分离；
- 归档报告根据任务语言生成，但机器清单字段保持英文稳定键名。

---

## 21. 隐私、安全与合规

### 21.1 隐私承诺

- 捕获内容默认不上传；
- 不采集页面正文、输入框值、Cookie、Token 和密码；
- 不捕获登录页面作为产品目标；
- 遥测默认只包含产品版本、错误码和匿名性能指标；
- 用户可完全关闭遥测；
- 深度捕获必须在任务结束后立即断开。

### 21.2 页面数据安全

- 序列化 DOM 前移除密码输入值；
- 默认清理所有表单当前值，除非用户明确选择保留非敏感表单状态；
- 不保存 Cookie 和浏览器存储；
- 不执行从页面传来的扩展命令；
- 生成报告时对 URL 中可能存在的 Token 做脱敏。

### 21.3 使用规范

产品须明确要求用户：

- 仅归档有权访问和保存的网页；
- 遵守版权、网站条款和隐私要求；
- 不使用产品绕过技术访问控制；
- 未经许可不得重新发布他人网站。

---

## 22. 测试策略

### 22.1 固定测试站类型

| 类型 | 重点验证 |
|---|---|
| 纯静态 HTML | 基础 DOM、CSS、图片和链接 |
| React SPA | 渲染后 DOM、分包 JS、History 路由 |
| Next.js 官网 | `/_next/` 资源、字体和优化图片 |
| Vue/Vite 官网 | ES Module、动态 chunk |
| GSAP 页面 | 脚本、字体、图片、动画 |
| Three.js 页面 | 模型、纹理、decoder、WASM |
| 视频背景页 | range、媒体大小、poster |
| 多 CDN 页面 | 第三方权限和目录映射 |
| 懒加载长页面 | 自动滚动和运行时资源发现 |
| 多页面文档站 | 爬取深度、页面去重和离线链接 |

### 22.2 自动验收

1. 在联网环境打开原页面并截图；
2. 执行扩展捕获；
3. 在隔离网络环境启动归档；
4. 收集本地 404、控制台错误和未命中映射；
5. 对比关键截图和 DOM 文本；
6. 检查 ZIP 清单、文件哈希和失败报告；
7. 检查没有请求产品后端上传页面内容。

### 22.3 MVP 验收标准

- 当前页捕获可以完整走通；
- ZIP 可解压，无 CRC 错误；
- HTML/CSS 中已下载资源不再指向线上 URL；
- 归档报告与实际资源数量一致；
- 暂停、继续、取消和重试有效；
- 扩展重载后任务不会显示错误的完成状态；
- 固定测试集达到第 6 章指标；
- 隐私检查确认无页面内容上传。

---

## 23. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| MV3 Service Worker 休眠 | 长任务中断 | 状态持久化、Offscreen/Worker、幂等恢复 |
| 大 ZIP 内存溢出 | 浏览器崩溃 | OPFS、流式 ZIP、体积限制 |
| 第三方资源权限不足 | 样式或媒体缺失 | 按需授权、明确失败报告 |
| 动态 URL 未发现 | 页面离线后 404 | Performance、MAIN Observer、深度模式 |
| JS 改写破坏页面 | 页面不可运行 | P0 不通用改写，P1 可关闭并记录哈希 |
| WebGL GPU 资源变体缺失 | 黑材质或模型错误 | 变体发现、兼容性报告、跨环境测试 |
| `file://` 限制 | 页面双击打不开 | 本地 HTTP Viewer、明确运行方式 |
| Chrome 商店权限审核 | 上架受阻 | 最小权限、深度模式独立授权、隐私说明 |
| 用户误认为复制完整业务 | 期望落差 | 产品范围和在线依赖报告 |
| 版权与滥用 | 法律和平台风险 | 使用条款、范围控制、不绕过访问限制 |

---

## 24. MVP 开发里程碑

### 里程碑 A：扩展骨架

- WXT + React + TypeScript；
- Side Panel、Service Worker、Content Script；
- 权限申请和消息协议；
- 基础任务状态机；
- IndexedDB 持久化。

### 里程碑 B：单页基础捕获

- DOM 快照；
- 基础资源发现；
- 后台下载队列；
- URL 去重与路径映射；
- 进度、取消和重试。

### 里程碑 C：解析与改写

- HTML DOM 改写；
- CSS AST 递归解析；
- 字体、srcset、媒体和 source map；
- 资源映射清单；
- 基础离线报告。

### 里程碑 D：ZIP 与可靠性

- fflate ZIP；
- 归档目录规范；
- 失败报告；
- 任务恢复；
- 体积和并发限制。

### 里程碑 E：测试与发布

- 固定测试站；
- Playwright E2E；
- 断网验证；
- 权限和隐私审查；
- Chrome Web Store 素材和文档。

### 里程碑 F：WebGL 增强

- 深度捕获；
- glTF/GLB/WASM/KTX2 资源识别；
- GPU 纹理变体；
- 本地 Viewer 原型；
- WebGL 跨环境测试。

---

## 25. 建议代码结构

```text
sitecapsule/
├── entrypoints/
│   ├── background.ts
│   ├── content.ts
│   ├── sidepanel/
│   │   ├── index.html
│   │   ├── App.tsx
│   │   └── components/
│   └── offscreen/
├── src/
│   ├── capture/
│   │   ├── dom-snapshot.ts
│   │   ├── performance-resources.ts
│   │   ├── lazy-load.ts
│   │   └── deep-capture.ts
│   ├── discovery/
│   │   ├── html-discovery.ts
│   │   ├── css-discovery.ts
│   │   ├── webgl-discovery.ts
│   │   └── resource-graph.ts
│   ├── crawler/
│   │   ├── page-queue.ts
│   │   ├── scope-policy.ts
│   │   └── robots-policy.ts
│   ├── fetcher/
│   │   ├── resource-fetcher.ts
│   │   ├── concurrency-queue.ts
│   │   └── retry-policy.ts
│   ├── rewrite/
│   │   ├── html-rewriter.ts
│   │   ├── css-rewriter.ts
│   │   ├── js-rewriter.ts
│   │   └── archive-runtime.ts
│   ├── archive/
│   │   ├── path-mapper.ts
│   │   ├── manifest-builder.ts
│   │   ├── report-builder.ts
│   │   └── zip-writer.ts
│   ├── storage/
│   │   ├── database.ts
│   │   ├── job-repository.ts
│   │   └── resource-store.ts
│   ├── messaging/
│   │   ├── protocol.ts
│   │   └── validators.ts
│   ├── security/
│   │   ├── url-policy.ts
│   │   ├── sanitization.ts
│   │   └── redaction.ts
│   └── shared/
├── tests/
│   ├── unit/
│   ├── fixtures/
│   └── e2e/
├── public/
├── wxt.config.ts
├── package.json
└── pnpm-workspace.yaml
```

---

## 26. 商业化建议

### 26.1 免费版

- 保存当前页面；
- 标准捕获；
- 基础 ZIP 和报告；
- 合理的单任务体积上限。

### 26.2 专业版

- 同站点爬取；
- 深度捕获；
- WebGL 专项资源；
- 大文件流式 ZIP；
- 高级诊断和修复；
- 归档历史与版本对比。

### 26.3 团队版

- 团队配置模板；
- 统一归档命名和保留策略；
- 归档签名；
- 集中授权；
- 可选私有部署的元数据服务。

收费价值应建立在捕获完整度、失败诊断、WebGL 支持和可靠交付上，而不是用“AI”作为模糊卖点。

---

## 27. AI 能力边界

AI 不应参与以下核心正确性流程：

- 判断 HTML 属性含义；
- 解析 CSS URL；
- 决定资源的本地路径；
- 判断文件是否下载成功；
- 修改未知压缩 JavaScript；
- 决定权限范围。

AI 可用于：

- 汇总错误日志；
- 解释某个离线页面为何黑屏；
- 识别缺失的 WebGL decoder 或纹理变体；
- 根据归档清单生成修复建议；
- 将技术错误翻译成普通用户能理解的说明。

若启用云端 AI，必须先在本地提取最小诊断信息，并清楚展示将发送哪些内容。默认不得发送完整 HTML、JS 或用户归档。

---

## 28. 待决策事项

1. MVP 是否只支持单页，还是同时支持最大 2 层的站点爬取；
2. 单任务默认和最大体积限制；
3. 是否在首发版本申请 `offscreen` 权限；
4. 深度捕获是首发实验功能还是后续专业版；
5. Viewer 是扩展内管理器还是独立桌面程序；
6. 是否保留原始响应头和 source map；
7. 是否默认下载视频等大型媒体；
8. 是否遵守页面 `robots` 规则，以及页面捕获与站点爬取的差异政策；
9. 商业化前是否先开源基础归档格式；
10. 产品正式名称、域名和商标可用性。

建议 MVP 决策：单页优先、媒体默认关闭、标准捕获默认开启、深度捕获实验性、本地内容零上传。

---

## 29. 参考资料

- Chrome Extensions API：<https://developer.chrome.com/docs/extensions/reference/api>
- Chrome Content Scripts：<https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts>
- Chrome 跨域网络请求：<https://developer.chrome.com/docs/extensions/develop/concepts/network-requests>
- Chrome Downloads API：<https://developer.chrome.com/docs/extensions/reference/api/downloads>
- Chrome Scripting API：<https://developer.chrome.com/docs/extensions/reference/api/scripting>
- WXT 官方文档：<https://wxt.dev/>
- WXT Manifest 配置：<https://wxt.dev/guide/essentials/config/manifest.html>
- CSSTree：<https://csstree.github.io/docs/>
- fflate：<https://github.com/101arrowz/fflate>

---

## 30. 立项结论

SiteCapsule 在技术上可行，且不需要 Python 或 AI 才能完成核心能力。推荐采用 TypeScript、WXT、React 和 Manifest V3 构建 Chrome 扩展，以 DOM/CSS 解析、浏览器运行时资源记录、确定性 URL 映射和流式 ZIP 为核心。

项目最大的技术风险集中在动态 JavaScript URL、浏览器扩展长任务生命周期、大文件内存、`file://` 限制和 WebGL 资源变体。通过“单页标准捕获 MVP -> 受控站点爬取 -> 深度网络捕获 -> WebGL 专项 -> 本地 Viewer”的顺序，可以逐步形成可销售的产品，而不必在第一版承诺无法验证的全站复制能力。
