# SiteCapsule Privacy Notice / 隐私说明

> Applies to / 适用版本：SiteCapsule 0.1.0 engineering trial / 工程试用版
> Updated / 更新日期：2026-08-03

## English

### Local-first processing

SiteCapsule processes captured page content inside the Chrome extension. It has no SiteCapsule
product server endpoint and does not upload captured HTML, page text, resources, or ZIP files to a
product server. Resource downloads are sent directly to the source URL discovered on the page with
credentials omitted, no referrer, and no HTTP cache.

The extension may process the page title, URL, final rendered DOM, resource URLs, resource response
metadata, and downloaded resource bytes. Task state and resource metadata are stored in the local
Chrome profile. ZIP files are delivered through Chrome downloads and are not retained by a product
server.

### Sensitive data handling

- Current form values, password values, checked or selected state, and output values are removed
  from the cloned DOM before serialization.
- Attributes and metadata identified as tokens, secrets, credentials, authorization data, API keys,
  session identifiers, or similar sensitive values are removed or redacted.
- Other-extension resource nodes, explicit tracking/payment runtime, and nonportable iframes are
  removed from the cloned DOM with structured reason counts; the live source page is not modified.
- Resource fetches use `credentials: omit`; SiteCapsule does not copy cookies into those requests.
- The extension does not read or archive source-page cookies, `localStorage`, or `sessionStorage`.
- Public pages are the product target. Login pages and bypassing access controls are not supported.

Sanitization is defense in depth, not a guarantee that arbitrary page text contains no personal or
confidential information. Review an archive before sharing it.

### Permissions

| Permission                      | Purpose                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `activeTab`                     | Identify the tab selected by the user's action.                               |
| `scripting`                     | Inject the runtime content script into an eligible page.                      |
| `storage`                       | Save settings, task state, and resource metadata in the local Chrome profile. |
| `downloads`                     | Deliver the generated ZIP through Chrome downloads.                           |
| `offscreen`                     | Provide a local extension document context for browser-side processing.       |
| `sidePanel`                     | Show the SiteCapsule controls beside the current page.                        |
| Optional HTTP/HTTPS host access | Read the selected page and fetch only user-approved source origins.           |

Site access is requested at use time. Archive-critical third-party resources are enabled by
default, but Chrome still requires the user to approve the exact preselected hosts. Tracking,
payment, iframe, and other runtime-only hosts remain excluded; an existing host grant does not add
them to an archive. The production Manifest does not install with permanent all-site host access.

### User responsibility

Use SiteCapsule only for content you are authorized to access and save. Follow copyright law,
privacy law, website terms, and contractual restrictions. Do not use the extension to bypass
technical access controls or redistribute another party's content without permission.

## 中文

### 本地优先处理

SiteCapsule 在 Chrome 扩展内部处理捕获内容。当前产品没有 SiteCapsule 产品服务器端点，
不会把 HTML、页面正文、资源或 ZIP 上传到产品服务器。资源请求直接发送到页面发现的原始
地址，并使用不携带凭据、不发送 Referrer、不写 HTTP 缓存的请求配置。

扩展可能处理页面标题、URL、最终渲染 DOM、资源 URL、响应元数据和下载的资源字节。任务
状态和资源元数据保存在本机 Chrome 配置中；ZIP 通过 Chrome 下载功能交付，不由产品
服务器保存。

### 敏感数据处理

- 序列化前清除克隆 DOM 中的表单当前值、密码、勾选/选中状态和输出值。
- 对识别为 Token、Secret、Credential、Authorization、API Key、Session ID 等敏感含义
  的属性和元数据进行删除或脱敏。
- 从克隆 DOM 中删除其他扩展资源节点、明确的追踪/支付运行时和不可离线 iframe，并按原因
  记录结构化计数；原始页面不会被修改。
- 资源下载使用 `credentials: omit`，不会把 Cookie 带入扩展发起的资源请求。
- 扩展不读取或归档原页面 Cookie、`localStorage` 或 `sessionStorage`。
- 产品目标是公开页面，不支持登录页面或绕过访问控制。

清理措施属于纵深防御，不能保证任意页面正文完全没有个人信息或机密信息。分享 ZIP 前请
人工检查。

### 权限用途

| 权限                     | 用途                                                 |
| ------------------------ | ---------------------------------------------------- |
| `activeTab`              | 识别用户主动选择的当前标签页。                       |
| `scripting`              | 向允许捕获的页面注入运行时内容脚本。                 |
| `storage`                | 在本机 Chrome 配置中保存设置、任务状态和资源元数据。 |
| `downloads`              | 通过 Chrome 下载功能交付 ZIP。                       |
| `offscreen`              | 提供浏览器内本地处理所需的扩展文档上下文。           |
| `sidePanel`              | 在当前页面旁显示 SiteCapsule 控件。                  |
| 可选 HTTP/HTTPS 站点权限 | 读取所选页面并仅下载用户批准来源的资源。             |

站点权限在使用时申请；归档关键第三方资源默认开启，但仍必须由用户在 Chrome 中对界面
默认选中的精确主机逐次确认。追踪、支付和 iframe 等运行时主机默认排除，已有权限不会使
它们自动进入归档。生产 Manifest 不会在安装时获得永久全站访问权限。

### 用户责任

仅对你有权访问和保存的内容使用 SiteCapsule，并遵守版权、隐私、网站条款及合同约束。
不得用本扩展绕过技术访问控制，未经许可不得重新发布他人内容。
