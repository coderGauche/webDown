import {
  isDomResourceAttribute,
  isSvgResourceAttribute,
  parseSrcsetCandidateSegments,
  SVG_RESOURCE_ATTRIBUTES,
} from '@sitecapsule/discovery';

import { rewriteCssResource, type CssRewriteKind } from './css-rewriter';
import { extractZipArchiveSync, type ZipArchiveEntry } from './zip-codec';

export const ARCHIVE_OFFLINE_REFERENCE_KINDS = [
  'local-present',
  'local-missing',
  'external-network',
  'extension-protocol',
  'embedded',
  'fragment',
  'unsupported-protocol',
  'invalid',
] as const;

export type ArchiveOfflineReferenceKind = (typeof ARCHIVE_OFFLINE_REFERENCE_KINDS)[number];
export type ArchiveOfflineReferenceChannel =
  'html-attribute' | 'srcset' | 'inline-css' | 'stylesheet-css';

export type ArchiveOfflineReference = {
  sourcePath: string;
  channel: ArchiveOfflineReferenceChannel;
  kind: ArchiveOfflineReferenceKind;
  originalValue: string;
  targetPath: string | null;
  protocol: string | null;
  tagName: string | null;
  attributeName: string | null;
  cssKind: CssRewriteKind | null;
};

export type ArchiveOfflineEntryCounts = {
  total: number;
  documents: number;
  stylesheets: number;
  assets: number;
  metadata: number;
  screenshots: number;
  other: number;
  byAssetDirectory: Record<string, number>;
};

export type ArchiveOfflineIntegrityAudit = {
  status: 'pass' | 'fail';
  entryCounts: ArchiveOfflineEntryCounts;
  referenceCounts: Record<ArchiveOfflineReferenceKind, number>;
  uniqueExternalNetworkUrls: number;
  navigationReferencesIgnored: number;
  missingLocalReferences: ArchiveOfflineReference[];
  externalNetworkReferences: ArchiveOfflineReference[];
  extensionProtocolReferences: ArchiveOfflineReference[];
  unsupportedProtocolReferences: ArchiveOfflineReference[];
  invalidReferences: ArchiveOfflineReference[];
};

export type ArchiveOfflineIntegrityParser = {
  parseFromString(input: string, mimeType: 'text/html'): Document;
};

export type AuditArchiveOfflineIntegrityInput = {
  archiveBytes: Uint8Array;
  parser?: ArchiveOfflineIntegrityParser;
};

type ReferenceContext = Omit<
  ArchiveOfflineReference,
  'sourcePath' | 'kind' | 'targetPath' | 'protocol' | 'originalValue'
>;

const SYNTHETIC_ORIGIN = 'https://sitecapsule-archive.invalid';
const decoder = new TextDecoder('utf-8', { fatal: true });

function createParser(parser?: ArchiveOfflineIntegrityParser): ArchiveOfflineIntegrityParser {
  if (parser) return parser;
  if (typeof DOMParser === 'undefined') {
    throw new Error('DOMParser is unavailable; archive offline integrity requires a parser.');
  }
  return new DOMParser();
}

function isHtmlPath(path: string): boolean {
  return path === 'index.html' || (path.startsWith('pages/') && /\.html?$/i.test(path));
}

function isStylesheetPath(path: string): boolean {
  return path.startsWith('assets/') && (path.includes('/css/') || /\.css$/i.test(path));
}

function entryCounts(entries: readonly ZipArchiveEntry[]): ArchiveOfflineEntryCounts {
  const counts: ArchiveOfflineEntryCounts = {
    total: entries.length,
    documents: 0,
    stylesheets: 0,
    assets: 0,
    metadata: 0,
    screenshots: 0,
    other: 0,
    byAssetDirectory: {},
  };
  for (const { path } of entries) {
    if (isHtmlPath(path)) {
      counts.documents += 1;
      continue;
    }
    if (path.startsWith('_sitecapsule/')) {
      counts.metadata += 1;
      continue;
    }
    if (path.startsWith('screenshots/')) {
      counts.screenshots += 1;
      continue;
    }
    if (!path.startsWith('assets/')) {
      counts.other += 1;
      continue;
    }
    counts.assets += 1;
    if (isStylesheetPath(path)) counts.stylesheets += 1;
    const segments = path.split('/');
    const directory = segments.length >= 2 ? segments.at(-2)! : 'other';
    counts.byAssetDirectory[directory] = (counts.byAssetDirectory[directory] ?? 0) + 1;
  }
  counts.byAssetDirectory = Object.fromEntries(
    Object.entries(counts.byAssetDirectory).sort(([left], [right]) => left.localeCompare(right)),
  );
  return counts;
}

function archiveBaseUrl(sourcePath: string): string {
  return `${SYNTHETIC_ORIGIN}/${sourcePath}`;
}

function decodeArchivePath(pathname: string): string | null {
  try {
    return pathname
      .slice(1)
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/');
  } catch {
    return null;
  }
}

function classifyReference(
  sourcePath: string,
  originalValue: string,
  archivePaths: ReadonlySet<string>,
  context: ReferenceContext,
): ArchiveOfflineReference {
  const trimmed = originalValue.trim();
  const common = { sourcePath, originalValue, ...context };
  if (!trimmed) {
    return { ...common, kind: 'invalid', targetPath: null, protocol: null };
  }
  if (trimmed.startsWith('#')) {
    return { ...common, kind: 'fragment', targetPath: null, protocol: null };
  }

  let url: URL;
  try {
    url = new URL(trimmed, archiveBaseUrl(sourcePath));
  } catch {
    return { ...common, kind: 'invalid', targetPath: null, protocol: null };
  }
  if (url.origin === SYNTHETIC_ORIGIN) {
    const targetPath = decodeArchivePath(url.pathname);
    const rootRelative = trimmed.startsWith('/');
    const present = targetPath !== null && !rootRelative && archivePaths.has(targetPath);
    return {
      ...common,
      kind: present ? 'local-present' : 'local-missing',
      targetPath,
      protocol: null,
    };
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return {
      ...common,
      kind: 'external-network',
      targetPath: null,
      protocol: url.protocol,
    };
  }
  if (url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:') {
    return {
      ...common,
      kind: 'extension-protocol',
      targetPath: null,
      protocol: url.protocol,
    };
  }
  if (url.protocol === 'data:' || (url.protocol === 'about:' && url.href === 'about:blank')) {
    return { ...common, kind: 'embedded', targetPath: null, protocol: url.protocol };
  }
  return {
    ...common,
    kind: 'unsupported-protocol',
    targetPath: null,
    protocol: url.protocol,
  };
}

function cssReferences(
  cssText: string,
  sourcePath: string,
  channel: 'inline-css' | 'stylesheet-css',
  contextType: 'stylesheet' | 'declaration-list',
  archivePaths: ReadonlySet<string>,
  context: Pick<ReferenceContext, 'tagName' | 'attributeName'>,
): ArchiveOfflineReference[] {
  const result = rewriteCssResource({
    cssText,
    context: contextType,
    baseUrl: archiveBaseUrl(sourcePath),
    sourcePath,
    savedResourceMappings: [],
  });
  if (result.parseError) {
    return [
      {
        sourcePath,
        channel,
        kind: 'invalid',
        originalValue: '<css-parse-error>',
        targetPath: null,
        protocol: null,
        tagName: context.tagName,
        attributeName: context.attributeName,
        cssKind: null,
      },
    ];
  }
  return result.references.map((reference) =>
    classifyReference(sourcePath, reference.originalValue, archivePaths, {
      channel,
      tagName: context.tagName,
      attributeName: context.attributeName,
      cssKind: reference.kind,
    }),
  );
}

function htmlReferences(
  html: string,
  sourcePath: string,
  archivePaths: ReadonlySet<string>,
  parser: ArchiveOfflineIntegrityParser,
): { references: ArchiveOfflineReference[]; navigationReferencesIgnored: number } {
  const document = parser.parseFromString(html, 'text/html');
  const references: ArchiveOfflineReference[] = [];
  const elements = Array.from(document.querySelectorAll('*'));
  let navigationReferencesIgnored = 0;

  for (const element of elements) {
    const tagName = element.tagName.toLowerCase();
    if ((tagName === 'a' || tagName === 'area') && element.hasAttribute('href')) {
      navigationReferencesIgnored += 1;
    }
    if (tagName === 'form' && element.hasAttribute('action')) navigationReferencesIgnored += 1;

    for (const attributeName of ['src', 'href', 'poster'] as const) {
      if (!isDomResourceAttribute(element, attributeName)) continue;
      const value = element.getAttribute(attributeName);
      if (!value?.trim()) continue;
      references.push(
        classifyReference(sourcePath, value, archivePaths, {
          channel: 'html-attribute',
          tagName,
          attributeName,
          cssKind: null,
        }),
      );
    }

    for (const attributeName of SVG_RESOURCE_ATTRIBUTES) {
      if (!isSvgResourceAttribute(element, attributeName)) continue;
      const value = element.getAttribute(attributeName);
      if (!value?.trim()) continue;
      references.push(
        classifyReference(sourcePath, value, archivePaths, {
          channel: 'html-attribute',
          tagName,
          attributeName,
          cssKind: null,
        }),
      );
    }

    if (isDomResourceAttribute(element, 'srcset')) {
      const srcset = element.getAttribute('srcset');
      if (srcset?.trim()) {
        for (const candidate of parseSrcsetCandidateSegments(srcset)) {
          references.push(
            classifyReference(sourcePath, candidate.rawUrl, archivePaths, {
              channel: 'srcset',
              tagName,
              attributeName: 'srcset',
              cssKind: null,
            }),
          );
        }
      }
    }

    if (tagName === 'style' && element.textContent?.trim()) {
      references.push(
        ...cssReferences(
          element.textContent,
          sourcePath,
          'inline-css',
          'stylesheet',
          archivePaths,
          {
            tagName,
            attributeName: null,
          },
        ),
      );
    }
    const style = element.getAttribute('style');
    if (style?.trim()) {
      references.push(
        ...cssReferences(style, sourcePath, 'inline-css', 'declaration-list', archivePaths, {
          tagName,
          attributeName: 'style',
        }),
      );
    }
  }
  return { references, navigationReferencesIgnored };
}

function referencesOfKind(
  references: readonly ArchiveOfflineReference[],
  kind: ArchiveOfflineReferenceKind,
): ArchiveOfflineReference[] {
  return references.filter((reference) => reference.kind === kind);
}

export function auditArchiveOfflineIntegritySync(
  input: AuditArchiveOfflineIntegrityInput,
): ArchiveOfflineIntegrityAudit {
  if (!input || typeof input !== 'object' || !(input.archiveBytes instanceof Uint8Array)) {
    throw new TypeError('Archive offline integrity input requires ZIP bytes.');
  }
  const entries = extractZipArchiveSync(input.archiveBytes);
  const paths = new Set(entries.map(({ path }) => path));
  if (!paths.has('index.html')) throw new Error('Archive offline integrity requires index.html.');
  const parser = createParser(input.parser);
  const references: ArchiveOfflineReference[] = [];
  let navigationReferencesIgnored = 0;

  for (const entry of entries) {
    if (isHtmlPath(entry.path)) {
      const result = htmlReferences(decoder.decode(entry.bytes), entry.path, paths, parser);
      references.push(...result.references);
      navigationReferencesIgnored += result.navigationReferencesIgnored;
    } else if (isStylesheetPath(entry.path)) {
      references.push(
        ...cssReferences(
          decoder.decode(entry.bytes),
          entry.path,
          'stylesheet-css',
          'stylesheet',
          paths,
          {
            tagName: null,
            attributeName: null,
          },
        ),
      );
    }
  }

  const referenceCounts = Object.fromEntries(
    ARCHIVE_OFFLINE_REFERENCE_KINDS.map((kind) => [
      kind,
      references.filter((reference) => reference.kind === kind).length,
    ]),
  ) as Record<ArchiveOfflineReferenceKind, number>;
  const missingLocalReferences = referencesOfKind(references, 'local-missing');
  const externalNetworkReferences = referencesOfKind(references, 'external-network');
  const extensionProtocolReferences = referencesOfKind(references, 'extension-protocol');
  const unsupportedProtocolReferences = referencesOfKind(references, 'unsupported-protocol');
  const invalidReferences = referencesOfKind(references, 'invalid');
  const status =
    missingLocalReferences.length === 0 &&
    externalNetworkReferences.length === 0 &&
    extensionProtocolReferences.length === 0 &&
    unsupportedProtocolReferences.length === 0 &&
    invalidReferences.length === 0
      ? 'pass'
      : 'fail';

  return {
    status,
    entryCounts: entryCounts(entries),
    referenceCounts,
    uniqueExternalNetworkUrls: new Set(
      externalNetworkReferences.map(({ originalValue }) => originalValue.trim()),
    ).size,
    navigationReferencesIgnored,
    missingLocalReferences,
    externalNetworkReferences,
    extensionProtocolReferences,
    unsupportedProtocolReferences,
    invalidReferences,
  };
}
