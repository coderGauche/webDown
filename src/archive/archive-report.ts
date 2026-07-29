import { RESOURCE_TYPES, type ResourceType } from '@sitecapsule/domain';

import { ARCHIVE_METADATA_PATHS } from './archive-layout';
import {
  ARCHIVE_MANIFEST_FORMAT_VERSION,
  ARCHIVE_MANIFEST_PRODUCT,
  buildArchiveManifest,
  type ArchiveManifest,
} from './archive-manifest';
import {
  ARCHIVE_RESOURCE_MANIFEST_FORMAT_VERSION,
  type ArchiveFailureManifest,
  type ArchiveResourceEntry,
  type ArchiveResourceError,
  type ArchiveResourceManifest,
  type ArchiveUnsavedResourceEntry,
} from './resource-manifests';
import type { ZipArchiveEntry } from './zip-codec';

export const ARCHIVE_REPORT_LOCALES = ['zh-CN', 'en'] as const;
export type ArchiveReportLocale = (typeof ARCHIVE_REPORT_LOCALES)[number];

export interface ArchiveReportInput {
  locale: ArchiveReportLocale;
  archiveManifest: ArchiveManifest;
  resourceManifest: ArchiveResourceManifest;
  failureManifest: ArchiveFailureManifest;
  knownLimitations: readonly string[];
}

export interface ArchiveReportArtifacts {
  reportHtml: string;
  offlineReadme: string;
}

type ValidatedReportInput = ArchiveReportInput & {
  knownLimitations: string[];
};

const INPUT_KEYS = [
  'locale',
  'archiveManifest',
  'resourceManifest',
  'failureManifest',
  'knownLimitations',
] as const;
const RESOURCE_KEYS = [
  'originalUrl',
  'finalUrl',
  'referrerUrl',
  'localPath',
  'resourceType',
  'discoverySources',
  'redirectTrace',
  'mimeType',
  'httpStatus',
  'byteLength',
  'sha256',
] as const;
const UNSAVED_KEYS = [
  'originalUrl',
  'finalUrl',
  'referrerUrl',
  'resourceType',
  'discoverySources',
  'redirectTrace',
  'mimeType',
  'httpStatus',
  'byteLength',
  'error',
] as const;
const ERROR_KEYS = [
  'code',
  'message',
  'retryable',
  'suggestion',
  'operation',
  'stage',
  'httpStatus',
  'browserError',
  'affectsPrimaryVisual',
] as const;
const UTF8_ENCODER = new TextEncoder();

const TEXT = {
  'zh-CN': {
    documentTitle: 'SiteCapsule 归档报告',
    eyebrow: '离线归档报告',
    summary: '捕获摘要',
    generatedBy: '由 SiteCapsule 在本地生成',
    capturedAt: '捕获时间',
    source: '起始地址',
    final: '最终地址',
    mode: '捕获模式',
    profile: '配置档',
    pages: '页面',
    saved: '已保存资源',
    failed: '失败资源',
    skipped: '跳过资源',
    bytes: '已保存体积',
    viewing: '离线查看',
    serverRequired: '此归档需要通过本地 HTTP 服务器查看。',
    serverRecommended: '可以直接打开 index.html，但使用本地 HTTP 服务器更稳定。',
    serverSteps: '在 ZIP 解压根目录运行以下命令，然后打开 http://127.0.0.1:8000/。',
    localOnly: '请保持 127.0.0.1 绑定，不要将归档服务暴露到局域网或公网。',
    failures: '失败资源',
    skips: '跳过资源',
    online: '仍需联网的依赖',
    limitations: '已知限制',
    files: '归档文件',
    none: '无',
    url: 'URL',
    type: '类型',
    status: '状态',
    reason: '原因',
    retry: '可重试',
    yes: '是',
    no: '否',
    openArchive: '打开归档首页',
    machineFiles: '查看机器清单',
    currentPage: '当前页',
    siteCrawl: '站点爬取',
    standard: '标准',
    deep: '深度',
    builtinRedaction: '敏感 URL 参数使用参数名启发式脱敏，无法保证识别任意自定义秘密。',
    builtinDynamic: '需要原站后端、登录会话或实时 API 的交互在离线环境中可能不可用。',
    builtinOnline: '清单中的线上依赖未保存到 ZIP，触发相关功能时可能仍会访问网络。',
  },
  en: {
    documentTitle: 'SiteCapsule archive report',
    eyebrow: 'Offline archive report',
    summary: 'Capture summary',
    generatedBy: 'Generated locally by SiteCapsule',
    capturedAt: 'Captured at',
    source: 'Start URL',
    final: 'Final URL',
    mode: 'Capture mode',
    profile: 'Profile',
    pages: 'Pages',
    saved: 'Saved resources',
    failed: 'Failed resources',
    skipped: 'Skipped resources',
    bytes: 'Saved size',
    viewing: 'Offline viewing',
    serverRequired: 'This archive must be viewed through a local HTTP server.',
    serverRecommended:
      'You can open index.html directly, but a local HTTP server is more reliable.',
    serverSteps: 'Run this command from the extracted ZIP root, then open http://127.0.0.1:8000/.',
    localOnly:
      'Keep the server bound to 127.0.0.1. Do not expose the archive to a LAN or the internet.',
    failures: 'Failed resources',
    skips: 'Skipped resources',
    online: 'Online dependencies',
    limitations: 'Known limitations',
    files: 'Archive files',
    none: 'None',
    url: 'URL',
    type: 'Type',
    status: 'Status',
    reason: 'Reason',
    retry: 'Retryable',
    yes: 'Yes',
    no: 'No',
    openArchive: 'Open archive home',
    machineFiles: 'View machine manifests',
    currentPage: 'Current page',
    siteCrawl: 'Site crawl',
    standard: 'Standard',
    deep: 'Deep',
    builtinRedaction:
      'Sensitive URL parameters are redacted by parameter-name heuristics, which cannot identify every custom secret.',
    builtinDynamic:
      'Interactions that require the original backend, login session, or live API may not work offline.',
    builtinOnline:
      'Online dependencies listed here were not saved in the ZIP and may still access the network when triggered.',
  },
} as const;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireSingleLineString(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (/[\r\n\u2028\u2029]/.test(text)) {
    throw new TypeError(`${label} must be one line.`);
  }
  return text;
}

function validateHttpStatus(value: unknown, label: string): void {
  if (value === null) return;
  if (!Number.isInteger(value) || (value as number) < 100 || (value as number) > 599) {
    throw new TypeError(`${label} must be null or a valid HTTP status.`);
  }
}

function validateResourceType(value: unknown, label: string): asserts value is ResourceType {
  if (!RESOURCE_TYPES.includes(value as ResourceType)) {
    throw new TypeError(`${label} is not a supported resource type.`);
  }
}

function validateArchiveManifest(value: unknown): ArchiveManifest {
  if (!isRecord(value)) throw new TypeError('Archive report archiveManifest must be an object.');
  if (
    value.formatVersion !== ARCHIVE_MANIFEST_FORMAT_VERSION ||
    value.product !== ARCHIVE_MANIFEST_PRODUCT
  ) {
    throw new TypeError('Archive report archiveManifest has an unsupported format version.');
  }
  const rebuilt = buildArchiveManifest({
    capturedAt: value.capturedAt as string,
    startUrl: value.startUrl as string,
    finalUrl: value.finalUrl as string,
    mode: value.mode as ArchiveManifest['mode'],
    captureProfile: value.captureProfile as ArchiveManifest['captureProfile'],
    pages: value.pages as number,
    resources: value.resources as number,
    failedResources: value.failedResources as number,
    requiresLocalHttpServer: value.requiresLocalHttpServer as boolean,
    onlineDependencies: value.onlineDependencies as string[],
  });
  if (JSON.stringify(value) !== JSON.stringify(rebuilt)) {
    throw new TypeError('Archive report archiveManifest must be a canonical validated manifest.');
  }
  return value as unknown as ArchiveManifest;
}

function validateResourceEntry(value: unknown, index: number): ArchiveResourceEntry {
  const label = `Archive report resource at index ${index}`;
  if (!isRecord(value) || !hasExactKeys(value, RESOURCE_KEYS)) {
    throw new TypeError(`${label} must contain exactly the supported fields.`);
  }
  requireSingleLineString(value.originalUrl, `${label} original URL`);
  requireSingleLineString(value.finalUrl, `${label} final URL`);
  requireSingleLineString(value.referrerUrl, `${label} referrer URL`);
  requireSingleLineString(value.localPath, `${label} local path`);
  validateResourceType(value.resourceType, `${label} type`);
  validateHttpStatus(value.httpStatus, `${label} status`);
  if (!Number.isSafeInteger(value.byteLength) || (value.byteLength as number) < 0) {
    throw new TypeError(`${label} byte length must be a non-negative safe integer.`);
  }
  return value as unknown as ArchiveResourceEntry;
}

function validateResourceError(value: unknown, label: string): ArchiveResourceError | null {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, ERROR_KEYS)) {
    throw new TypeError(`${label} must contain exactly the supported fields.`);
  }
  requireSingleLineString(value.code, `${label} code`);
  requireSingleLineString(value.message, `${label} message`);
  if (typeof value.retryable !== 'boolean') {
    throw new TypeError(`${label} retryable must be a boolean.`);
  }
  validateHttpStatus(value.httpStatus, `${label} status`);
  return value as unknown as ArchiveResourceError;
}

function validateUnsavedEntry(
  value: unknown,
  index: number,
  group: string,
): ArchiveUnsavedResourceEntry {
  const label = `Archive report ${group} resource at index ${index}`;
  if (!isRecord(value) || !hasExactKeys(value, UNSAVED_KEYS)) {
    throw new TypeError(`${label} must contain exactly the supported fields.`);
  }
  requireSingleLineString(value.originalUrl, `${label} original URL`);
  if (value.finalUrl !== null) requireSingleLineString(value.finalUrl, `${label} final URL`);
  requireSingleLineString(value.referrerUrl, `${label} referrer URL`);
  validateResourceType(value.resourceType, `${label} type`);
  validateHttpStatus(value.httpStatus, `${label} status`);
  validateResourceError(value.error, `${label} error`);
  return value as unknown as ArchiveUnsavedResourceEntry;
}

function validateResourceManifest(value: unknown): ArchiveResourceManifest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['formatVersion', 'resources']) ||
    value.formatVersion !== ARCHIVE_RESOURCE_MANIFEST_FORMAT_VERSION ||
    !Array.isArray(value.resources)
  ) {
    throw new TypeError('Archive report resourceManifest is not a supported resource manifest.');
  }
  value.resources.forEach(validateResourceEntry);
  return value as unknown as ArchiveResourceManifest;
}

function validateFailureManifest(value: unknown): ArchiveFailureManifest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['formatVersion', 'failures', 'skipped']) ||
    value.formatVersion !== ARCHIVE_RESOURCE_MANIFEST_FORMAT_VERSION ||
    !Array.isArray(value.failures) ||
    !Array.isArray(value.skipped)
  ) {
    throw new TypeError('Archive report failureManifest is not a supported failure manifest.');
  }
  value.failures.forEach((entry, index) => validateUnsavedEntry(entry, index, 'failed'));
  value.skipped.forEach((entry, index) => validateUnsavedEntry(entry, index, 'skipped'));
  return value as unknown as ArchiveFailureManifest;
}

function validateReportInput(input: ArchiveReportInput): ValidatedReportInput {
  if (!isRecord(input) || !hasExactKeys(input, INPUT_KEYS)) {
    throw new TypeError('Archive report input must contain exactly the supported fields.');
  }
  if (!ARCHIVE_REPORT_LOCALES.includes(input.locale as ArchiveReportLocale)) {
    throw new TypeError('Archive report locale is not supported.');
  }
  const archiveManifest = validateArchiveManifest(input.archiveManifest);
  const resourceManifest = validateResourceManifest(input.resourceManifest);
  const failureManifest = validateFailureManifest(input.failureManifest);
  if (archiveManifest.resources !== resourceManifest.resources.length) {
    throw new Error('Archive report saved resource count does not match resources.json.');
  }
  if (archiveManifest.failedResources !== failureManifest.failures.length) {
    throw new Error('Archive report failed resource count does not match failures.json.');
  }
  if (!Array.isArray(input.knownLimitations)) {
    throw new TypeError('Archive report knownLimitations must be an array.');
  }
  const limitations = input.knownLimitations.map((value, index) => {
    const limitation = requireString(value, `Archive report limitation at index ${index}`);
    if (limitation.includes('\n') || limitation.includes('\r')) {
      throw new TypeError(`Archive report limitation at index ${index} must be one line.`);
    }
    return limitation.trim();
  });
  return {
    locale: input.locale,
    archiveManifest,
    resourceManifest,
    failureManifest,
    knownLimitations: Array.from(new Set(limitations)).sort(compareText),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeMarkdown(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/([\\`*_[\]{}#+!|])/g, '\\$1');
}

function markdownCode(value: string): string {
  const longestRun = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  const delimiter = '`'.repeat(longestRun + 1);
  const padding = value.startsWith('`') || value.endsWith('`') ? ' ' : '';
  return `${delimiter}${padding}${value}${padding}${delimiter}`;
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let amount = value / 1_024;
  let unitIndex = 0;
  while (amount >= 1_024 && unitIndex < units.length - 1) {
    amount /= 1_024;
    unitIndex += 1;
  }
  const digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(digits).replace(/\.0+$/, '')} ${units[unitIndex]}`;
}

function statusLabel(value: number | null): string {
  return value === null ? '—' : String(value);
}

function resourceSortKey(resource: ArchiveUnsavedResourceEntry): string {
  return `${resource.originalUrl}\u0000${resource.resourceType}\u0000${resource.finalUrl ?? ''}`;
}

function resourceErrorReason(
  error: ArchiveResourceError | null,
  locale: ArchiveReportLocale,
): string {
  if (error === null) return TEXT[locale].none;
  return locale === 'zh-CN' ? `${error.code}: ${error.message}` : error.code;
}

function standardLimitations(input: ValidatedReportInput): string[] {
  const text = TEXT[input.locale];
  return Array.from(
    new Set([
      text.builtinRedaction,
      text.builtinDynamic,
      ...(input.archiveManifest.onlineDependencies.length > 0 ? [text.builtinOnline] : []),
      ...input.knownLimitations,
    ]),
  );
}

function calculateSavedBytes(resources: readonly ArchiveResourceEntry[]): number {
  const total = resources.reduce((sum, resource) => sum + resource.byteLength, 0);
  if (!Number.isSafeInteger(total)) {
    throw new RangeError('Archive report saved resource total exceeds the safe integer range.');
  }
  return total;
}

function renderHtmlResourceRows(
  resources: readonly ArchiveUnsavedResourceEntry[],
  locale: ArchiveReportLocale,
): string {
  const text = TEXT[locale];
  if (resources.length === 0) return `<p class="empty">${text.none}</p>`;
  return `<div class="table-wrap"><table><thead><tr><th>${text.url}</th><th>${text.type}</th><th>${text.status}</th><th>${text.reason}</th><th>${text.retry}</th></tr></thead><tbody>${[
    ...resources,
  ]
    .sort((left, right) => compareText(resourceSortKey(left), resourceSortKey(right)))
    .map((resource) => {
      const reason = resourceErrorReason(resource.error, locale);
      return `<tr><td class="url">${escapeHtml(resource.originalUrl)}</td><td>${escapeHtml(resource.resourceType)}</td><td>${statusLabel(resource.httpStatus)}</td><td>${escapeHtml(reason)}</td><td>${resource.error?.retryable ? text.yes : text.no}</td></tr>`;
    })
    .join('')}</tbody></table></div>`;
}

function renderHtmlList(values: readonly string[], emptyLabel: string): string {
  if (values.length === 0) return `<p class="empty">${escapeHtml(emptyLabel)}</p>`;
  return `<ul>${values.map((value) => `<li><code>${escapeHtml(value)}</code></li>`).join('')}</ul>`;
}

export function createArchiveReportHtml(input: ArchiveReportInput): string {
  const validated = validateReportInput(input);
  const { archiveManifest, resourceManifest, failureManifest, locale } = validated;
  const text = TEXT[locale];
  const savedBytes = calculateSavedBytes(resourceManifest.resources);
  const host = new URL(archiveManifest.finalUrl).hostname;
  const viewingMessage = archiveManifest.requiresLocalHttpServer
    ? text.serverRequired
    : text.serverRecommended;
  const mode = archiveManifest.mode === 'current-page' ? text.currentPage : text.siteCrawl;
  const profile = archiveManifest.captureProfile === 'standard' ? text.standard : text.deep;
  const limitations = standardLimitations(validated);

  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <title>${escapeHtml(text.documentTitle)} - ${escapeHtml(host)}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f7f9; color: #182230; }
    * { box-sizing: border-box; }
    body { margin: 0; line-height: 1.55; }
    a { color: #075d4d; text-underline-offset: 3px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    .shell { width: min(1120px, calc(100% - 32px)); margin: 0 auto; }
    header { background: #17212b; color: #fff; padding: 40px 0 34px; border-bottom: 4px solid #16a085; }
    header p { margin: 0; color: #b9c4ce; }
    .eyebrow { color: #6ce0be; font-size: 13px; font-weight: 700; text-transform: uppercase; }
    h1 { margin: 6px 0 8px; font-size: 40px; line-height: 1.12; letter-spacing: 0; overflow-wrap: anywhere; }
    h2 { margin: 0 0 16px; font-size: 22px; letter-spacing: 0; }
    main { padding: 30px 0 54px; }
    section { padding: 26px 0; border-bottom: 1px solid #d7dee5; }
    .metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
    .metric { min-height: 94px; padding: 15px; background: #fff; border: 1px solid #d7dee5; border-radius: 6px; }
    .metric span { display: block; color: #5c6977; font-size: 13px; }
    .metric strong { display: block; margin-top: 6px; font-size: 24px; line-height: 1.2; overflow-wrap: anywhere; }
    .details { display: grid; grid-template-columns: 160px minmax(0, 1fr); margin-top: 20px; border-top: 1px solid #d7dee5; }
    .details dt, .details dd { margin: 0; padding: 10px 0; border-bottom: 1px solid #d7dee5; }
    .details dt { color: #5c6977; font-weight: 600; }
    .details dd { overflow-wrap: anywhere; }
    .notice { padding: 16px 18px; background: #eaf8f4; border-left: 4px solid #0d8068; }
    .notice p { margin: 0 0 8px; }
    .notice p:last-child { margin-bottom: 0; }
    pre { margin: 14px 0; padding: 14px 16px; overflow-x: auto; background: #111820; color: #f2f5f7; border-radius: 6px; }
    .table-wrap { overflow-x: auto; border: 1px solid #d7dee5; border-radius: 6px; background: #fff; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 11px 12px; text-align: left; vertical-align: top; border-bottom: 1px solid #e4e9ee; }
    th { background: #eef2f5; color: #44515f; font-size: 12px; text-transform: uppercase; }
    tbody tr:last-child td { border-bottom: 0; }
    td.url { min-width: 280px; overflow-wrap: anywhere; }
    ul { margin: 0; padding-left: 22px; }
    li + li { margin-top: 8px; }
    .empty { color: #677482; font-style: italic; }
    .links { display: flex; flex-wrap: wrap; gap: 16px; }
    footer { padding: 24px 0 40px; color: #677482; font-size: 13px; }
    @media (max-width: 800px) { h1 { font-size: 30px; } .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } .details { grid-template-columns: 1fr; } .details dt { padding-bottom: 0; border-bottom: 0; } }
    @media print { header { background: #fff; color: #182230; border-bottom-color: #182230; } header p, .eyebrow { color: #44515f; } .shell { width: 100%; } body { background: #fff; } }
  </style>
</head>
<body>
  <header><div class="shell"><p class="eyebrow">${text.eyebrow}</p><h1>${escapeHtml(host)}</h1><p>${text.generatedBy}</p></div></header>
  <main class="shell">
    <section aria-labelledby="summary"><h2 id="summary">${text.summary}</h2><div class="metrics">
      <div class="metric"><span>${text.pages}</span><strong>${archiveManifest.pages}</strong></div>
      <div class="metric"><span>${text.saved}</span><strong>${resourceManifest.resources.length}</strong></div>
      <div class="metric"><span>${text.failed}</span><strong>${failureManifest.failures.length}</strong></div>
      <div class="metric"><span>${text.skipped}</span><strong>${failureManifest.skipped.length}</strong></div>
      <div class="metric"><span>${text.bytes}</span><strong>${formatBytes(savedBytes)}</strong></div>
    </div><dl class="details">
      <dt>${text.capturedAt}</dt><dd>${escapeHtml(archiveManifest.capturedAt)}</dd>
      <dt>${text.source}</dt><dd>${escapeHtml(archiveManifest.startUrl)}</dd>
      <dt>${text.final}</dt><dd>${escapeHtml(archiveManifest.finalUrl)}</dd>
      <dt>${text.mode}</dt><dd>${mode}</dd>
      <dt>${text.profile}</dt><dd>${profile}</dd>
    </dl></section>
    <section aria-labelledby="viewing"><h2 id="viewing">${text.viewing}</h2><div class="notice"><p><strong>${viewingMessage}</strong></p><p>${text.serverSteps}</p><pre><code>python3 -m http.server 8000 --bind 127.0.0.1</code></pre><p>${text.localOnly}</p></div></section>
    <section aria-labelledby="failures"><h2 id="failures">${text.failures} (${failureManifest.failures.length})</h2>${renderHtmlResourceRows(failureManifest.failures, locale)}</section>
    <section aria-labelledby="skips"><h2 id="skips">${text.skips} (${failureManifest.skipped.length})</h2>${renderHtmlResourceRows(failureManifest.skipped, locale)}</section>
    <section aria-labelledby="online"><h2 id="online">${text.online} (${archiveManifest.onlineDependencies.length})</h2>${renderHtmlList(archiveManifest.onlineDependencies, text.none)}</section>
    <section aria-labelledby="limitations"><h2 id="limitations">${text.limitations}</h2>${renderHtmlList(limitations, text.none)}</section>
    <section aria-labelledby="files"><h2 id="files">${text.files}</h2><div class="links"><a href="../index.html">${text.openArchive}</a><a href="archive.json">archive.json</a><a href="resources.json">resources.json</a><a href="failures.json">failures.json</a><a href="original-urls.json">original-urls.json</a></div></section>
  </main>
  <footer class="shell">${escapeHtml(text.documentTitle)} - ${escapeHtml(archiveManifest.capturedAt)}</footer>
</body>
</html>
`;
}

function markdownList(values: readonly string[], emptyLabel: string): string {
  if (values.length === 0) return `- ${escapeMarkdown(emptyLabel)}`;
  return values.map((value) => `- ${markdownCode(value)}`).join('\n');
}

function markdownResourceList(
  resources: readonly ArchiveUnsavedResourceEntry[],
  locale: ArchiveReportLocale,
): string {
  const text = TEXT[locale];
  if (resources.length === 0) return `- ${escapeMarkdown(text.none)}`;
  return [...resources]
    .sort((left, right) => compareText(resourceSortKey(left), resourceSortKey(right)))
    .map((resource) => {
      const reason = resourceErrorReason(resource.error, locale);
      return `- ${markdownCode(resource.originalUrl)} - ${escapeMarkdown(resource.resourceType)}, ${escapeMarkdown(text.status)} ${statusLabel(resource.httpStatus)}, ${escapeMarkdown(reason)}`;
    })
    .join('\n');
}

export function createArchiveOfflineReadme(input: ArchiveReportInput): string {
  const validated = validateReportInput(input);
  const { archiveManifest, resourceManifest, failureManifest, locale } = validated;
  const text = TEXT[locale];
  const viewingMessage = archiveManifest.requiresLocalHttpServer
    ? text.serverRequired
    : text.serverRecommended;
  const savedBytes = calculateSavedBytes(resourceManifest.resources);
  const limitations = standardLimitations(validated);
  const mode = archiveManifest.mode === 'current-page' ? text.currentPage : text.siteCrawl;
  const profile = archiveManifest.captureProfile === 'standard' ? text.standard : text.deep;

  return `# ${escapeMarkdown(text.documentTitle)}

${escapeMarkdown(text.generatedBy)}

## ${escapeMarkdown(text.viewing)}

${escapeMarkdown(viewingMessage)}

${escapeMarkdown(text.serverSteps)}

\`\`\`sh
python3 -m http.server 8000 --bind 127.0.0.1
\`\`\`

${escapeMarkdown(text.localOnly)}

## ${escapeMarkdown(text.summary)}

- ${escapeMarkdown(text.capturedAt)}: ${markdownCode(archiveManifest.capturedAt)}
- ${escapeMarkdown(text.source)}: ${markdownCode(archiveManifest.startUrl)}
- ${escapeMarkdown(text.final)}: ${markdownCode(archiveManifest.finalUrl)}
- ${escapeMarkdown(text.mode)}: ${escapeMarkdown(mode)}
- ${escapeMarkdown(text.profile)}: ${escapeMarkdown(profile)}
- ${escapeMarkdown(text.pages)}: ${archiveManifest.pages}
- ${escapeMarkdown(text.saved)}: ${resourceManifest.resources.length}
- ${escapeMarkdown(text.failed)}: ${failureManifest.failures.length}
- ${escapeMarkdown(text.skipped)}: ${failureManifest.skipped.length}
- ${escapeMarkdown(text.bytes)}: ${formatBytes(savedBytes)}

## ${escapeMarkdown(text.files)}

- ${markdownCode('index.html')}
- ${markdownCode('_sitecapsule/report.html')}
- ${markdownCode('_sitecapsule/archive.json')}
- ${markdownCode('_sitecapsule/resources.json')}
- ${markdownCode('_sitecapsule/failures.json')}
- ${markdownCode('_sitecapsule/original-urls.json')}

## ${escapeMarkdown(text.failures)} (${failureManifest.failures.length})

${markdownResourceList(failureManifest.failures, locale)}

## ${escapeMarkdown(text.skips)} (${failureManifest.skipped.length})

${markdownResourceList(failureManifest.skipped, locale)}

## ${escapeMarkdown(text.online)} (${archiveManifest.onlineDependencies.length})

${markdownList(archiveManifest.onlineDependencies, text.none)}

## ${escapeMarkdown(text.limitations)}

${markdownList(limitations, text.none)}
`;
}

export function createArchiveReportArtifacts(input: ArchiveReportInput): ArchiveReportArtifacts {
  return {
    reportHtml: createArchiveReportHtml(input),
    offlineReadme: createArchiveOfflineReadme(input),
  };
}

export function createArchiveReportEntries(input: ArchiveReportInput): ZipArchiveEntry[] {
  const artifacts = createArchiveReportArtifacts(input);
  return [
    { path: ARCHIVE_METADATA_PATHS.report, bytes: UTF8_ENCODER.encode(artifacts.reportHtml) },
    {
      path: ARCHIVE_METADATA_PATHS.offlineReadme,
      bytes: UTF8_ENCODER.encode(artifacts.offlineReadme),
    },
  ];
}
