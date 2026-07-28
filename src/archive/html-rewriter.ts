import {
  isDomResourceAttribute,
  isSvgResourceAttribute,
  SVG_RESOURCE_ATTRIBUTES,
  type DomResourceAttribute,
  type SvgResourceAttribute,
} from '@sitecapsule/discovery';
import { normalizeResourceUrl, serializeDocumentType } from '@sitecapsule/page';

import type { ResourcePathMapping } from './resource-path-mapping';

const DIRECT_HTML_RESOURCE_ATTRIBUTES = [
  'src',
  'href',
  'poster',
] as const satisfies readonly DomResourceAttribute[];
const DIRECT_HTML_RESOURCE_ATTRIBUTE_SET = new Set<DomResourceAttribute>(
  DIRECT_HTML_RESOURCE_ATTRIBUTES,
);
const DIRECT_RESOURCE_ATTRIBUTES = ['src', 'href', 'poster', 'xlink:href'] as const;
const NETWORK_PROTOCOLS = new Set(['http:', 'https:']);

export type HtmlDomParser = {
  parseFromString(input: string, mimeType: 'text/html'): Document;
};

type HtmlReferenceCommon = {
  elementOrdinal: number;
  tagName: string;
  attributeName: DomResourceAttribute | SvgResourceAttribute;
  originalValue: string;
};

export type HtmlReferenceResult =
  | (HtmlReferenceCommon & {
      status: 'rewritten';
      resolvedUrl: string;
      normalizedUrl: string;
      targetPath: string;
      rewrittenValue: string;
    })
  | (HtmlReferenceCommon & {
      status: 'unmapped';
      resolvedUrl: string;
      normalizedUrl: string;
    })
  | (HtmlReferenceCommon & {
      status: 'unsupported';
      resolvedUrl: string;
      protocol: string;
    })
  | (HtmlReferenceCommon & {
      status: 'invalid';
    });

export type HtmlBaseHrefRemoval = {
  elementOrdinal: number;
  originalValue: string;
  resolvedUrl: string | null;
};

export type HtmlRewriteResult = {
  html: string;
  documentPath: string;
  rewrittenCount: number;
  references: HtmlReferenceResult[];
  baseHrefRemovals: HtmlBaseHrefRemoval[];
};

export type RewriteHtmlResourceOptions = {
  html: string;
  documentUrl: string;
  baseUrl: string;
  documentPath: string;
  savedResourceMappings: readonly ResourcePathMapping[];
  parser?: HtmlDomParser;
};

function validateArchivePath(value: string, label: string): string[] {
  if (typeof value !== 'string' || value === '' || value.startsWith('/') || value.includes('\\')) {
    throw new TypeError(`${label} must be a relative POSIX archive path.`);
  }

  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new TypeError(`${label} must not contain empty or dot path segments.`);
  }
  return segments;
}

export function createRelativeArchivePath(fromFile: string, toFile: string): string {
  const fromSegments = validateArchivePath(fromFile, 'Source archive path');
  const toSegments = validateArchivePath(toFile, 'Target archive path');
  const fromDirectory = fromSegments.slice(0, -1);
  let commonLength = 0;

  while (
    commonLength < fromDirectory.length &&
    commonLength < toSegments.length &&
    fromDirectory[commonLength] === toSegments[commonLength]
  ) {
    commonLength += 1;
  }

  return [
    ...Array.from({ length: fromDirectory.length - commonLength }, () => '..'),
    ...toSegments.slice(commonLength),
  ].join('/');
}

function encodeRelativeArchiveReference(relativePath: string): string {
  return relativePath
    .split('/')
    .map((segment) => (segment === '..' ? segment : encodeURIComponent(segment)))
    .join('/');
}

function createParser(parser?: HtmlDomParser): HtmlDomParser {
  if (parser) return parser;
  if (typeof DOMParser === 'undefined') {
    throw new Error('DOMParser is unavailable; HTML rewriting must run in a DOM-capable context.');
  }
  return new DOMParser();
}

function validateNetworkUrl(value: string, label: string): string {
  const normalized = normalizeResourceUrl(value);
  if (normalized === null) throw new TypeError(`${label} must be an absolute URL.`);

  const url = new URL(normalized);
  if (!NETWORK_PROTOCOLS.has(url.protocol)) {
    throw new RangeError(`${label} must use HTTP or HTTPS.`);
  }
  if (url.username || url.password) throw new RangeError(`${label} must not contain credentials.`);
  return normalized;
}

function buildSavedResourceLookup(
  mappings: readonly ResourcePathMapping[],
): Map<string, ResourcePathMapping> {
  if (!Array.isArray(mappings)) throw new TypeError('Saved resource mappings must be an array.');

  const lookup = new Map<string, ResourcePathMapping>();
  for (const mapping of mappings) {
    if (!mapping || typeof mapping !== 'object') {
      throw new TypeError('Saved resource mapping must be an object.');
    }
    validateArchivePath(mapping.relativePath, 'Saved resource path');
    const normalizedUrl = validateNetworkUrl(mapping.normalizedUrl, 'Saved resource URL');
    if (normalizedUrl !== mapping.normalizedUrl) {
      throw new TypeError('Saved resource URL must be normalized.');
    }

    const existing = lookup.get(normalizedUrl);
    if (existing && existing.relativePath !== mapping.relativePath) {
      throw new Error('Saved resource URL has ambiguous archive paths.');
    }
    lookup.set(normalizedUrl, mapping);
  }
  return lookup;
}

function isDirectResourceAttribute(
  element: Element,
  attributeName: DomResourceAttribute | SvgResourceAttribute,
): boolean {
  if (DIRECT_HTML_RESOURCE_ATTRIBUTE_SET.has(attributeName as DomResourceAttribute)) {
    if (isDomResourceAttribute(element, attributeName as DomResourceAttribute)) return true;
  }
  return SVG_RESOURCE_ATTRIBUTES.includes(attributeName as SvgResourceAttribute)
    ? isSvgResourceAttribute(element, attributeName as SvgResourceAttribute)
    : false;
}

function serializeHtmlDocument(document: Document): string {
  const root = document.documentElement;
  if (!root) throw new Error('DOMParser did not return an HTML document element.');
  const doctype = serializeDocumentType(document.doctype);
  return doctype ? `${doctype}\n${root.outerHTML}` : root.outerHTML;
}

export function rewriteHtmlResource(options: RewriteHtmlResourceOptions): HtmlRewriteResult {
  if (!options || typeof options !== 'object')
    throw new TypeError('HTML rewrite options are required.');
  if (typeof options.html !== 'string') throw new TypeError('HTML source must be a string.');

  const documentUrl = validateNetworkUrl(options.documentUrl, 'Document URL');
  const baseUrl = validateNetworkUrl(options.baseUrl, 'Base URL');
  validateArchivePath(options.documentPath, 'Document archive path');
  const savedResources = buildSavedResourceLookup(options.savedResourceMappings);
  const document = createParser(options.parser).parseFromString(options.html, 'text/html');
  const elements = Array.from(document.querySelectorAll('*'));
  const elementOrdinals = new Map(elements.map((element, index) => [element, index + 1]));
  const baseHrefRemovals: HtmlBaseHrefRemoval[] = [];

  for (const base of Array.from(document.querySelectorAll('base[href]'))) {
    const originalValue = base.getAttribute('href') ?? '';
    let resolvedUrl: string | null = null;
    try {
      resolvedUrl = new URL(originalValue, documentUrl).href;
    } catch {
      // The invalid value is still removed so it cannot affect offline resolution.
    }
    baseHrefRemovals.push({
      elementOrdinal: elementOrdinals.get(base) ?? 0,
      originalValue,
      resolvedUrl,
    });
    base.removeAttribute('href');
  }

  const references: HtmlReferenceResult[] = [];
  for (const element of elements) {
    for (const attributeName of DIRECT_RESOURCE_ATTRIBUTES) {
      if (!isDirectResourceAttribute(element, attributeName)) continue;
      const originalValue = element.getAttribute(attributeName);
      if (originalValue === null || originalValue.trim() === '') continue;
      if (
        element.namespaceURI === 'http://www.w3.org/2000/svg' &&
        originalValue.trim().startsWith('#')
      ) {
        continue;
      }

      const common: HtmlReferenceCommon = {
        elementOrdinal: elementOrdinals.get(element) ?? 0,
        tagName: element.tagName.toLowerCase(),
        attributeName,
        originalValue,
      };

      let resolved: URL;
      try {
        resolved = new URL(originalValue.trim(), baseUrl);
      } catch {
        references.push({ ...common, status: 'invalid' });
        continue;
      }

      if (!NETWORK_PROTOCOLS.has(resolved.protocol)) {
        references.push({
          ...common,
          status: 'unsupported',
          resolvedUrl: resolved.href,
          protocol: resolved.protocol,
        });
        continue;
      }

      const fragment = resolved.hash;
      const normalizedUrl = normalizeResourceUrl(resolved.href);
      if (normalizedUrl === null) {
        references.push({ ...common, status: 'invalid' });
        continue;
      }
      const mapping = savedResources.get(normalizedUrl);
      if (!mapping) {
        references.push({
          ...common,
          status: 'unmapped',
          resolvedUrl: resolved.href,
          normalizedUrl,
        });
        continue;
      }

      const relativePath = createRelativeArchivePath(options.documentPath, mapping.relativePath);
      const rewrittenValue = `${encodeRelativeArchiveReference(relativePath)}${fragment}`;
      element.setAttribute(attributeName, rewrittenValue);
      references.push({
        ...common,
        status: 'rewritten',
        resolvedUrl: resolved.href,
        normalizedUrl,
        targetPath: mapping.relativePath,
        rewrittenValue,
      });
    }
  }

  return {
    html: serializeHtmlDocument(document),
    documentPath: options.documentPath,
    rewrittenCount: references.filter((reference) => reference.status === 'rewritten').length,
    references,
    baseHrefRemovals,
  };
}
