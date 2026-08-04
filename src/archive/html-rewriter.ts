import {
  isDomResourceAttribute,
  isSvgResourceAttribute,
  SVG_RESOURCE_ATTRIBUTES,
  SVG_PRESENTATION_ATTRIBUTES,
  type EmbeddedCssSourceType,
  type DomResourceAttribute,
  type SvgResourceAttribute,
} from '@sitecapsule/discovery';
import { RESOURCE_TYPES, type ResourceType } from '@sitecapsule/domain';
import { normalizeResourceUrl, serializeDocumentType } from '@sitecapsule/page';

import { buildContentChangeReport, type ContentChangeReport } from './content-change-report';
import { adjustContentSecurityPolicies, type CspAdjustmentResult } from './csp-policy';
import type { ResourcePathMapping } from './resource-path-mapping';
import { rewriteCssResource, type CssRewriteResult } from './css-rewriter';
import {
  buildSavedResourceLookup,
  createLocalArchiveReference,
  createRelativeArchivePath,
  isNetworkProtocol,
  validateArchivePath,
  validateNetworkUrl,
} from './rewrite-support';
import { rewriteSrcsetResource, type SrcsetRewriteResult } from './srcset-rewriter';
import {
  applyServiceWorkerSafetyPolicy,
  type ServiceWorkerSafetyResult,
} from './service-worker-safety';

const DIRECT_HTML_RESOURCE_ATTRIBUTES = [
  'src',
  'href',
  'poster',
] as const satisfies readonly DomResourceAttribute[];
const DIRECT_HTML_RESOURCE_ATTRIBUTE_SET = new Set<DomResourceAttribute>(
  DIRECT_HTML_RESOURCE_ATTRIBUTES,
);
const DIRECT_RESOURCE_ATTRIBUTES = ['src', 'href', 'poster', 'xlink:href'] as const;

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
      neutralizedValue?: null;
    })
  | (HtmlReferenceCommon & {
      status: 'unsupported';
      resolvedUrl: string;
      protocol: string;
      neutralizedValue?: null;
    })
  | (HtmlReferenceCommon & {
      status: 'invalid';
      neutralizedValue?: null;
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
  cssRewrittenCount: number;
  cssRewrites: HtmlCssRewriteResult[];
  srcsetRewrittenCount: number;
  srcsetRewrites: HtmlSrcsetRewriteResult[];
  serviceWorkerSafety: ServiceWorkerSafetyResult;
  cspAdjustment: CspAdjustmentResult;
  contentChanges: ContentChangeReport;
  scriptSafety: OfflineScriptSafetyResult;
};

export type OfflineScriptSafetyEntry = {
  elementOrdinal: number;
  originalType: string | null;
  source: string | null;
};

export type OfflineSpeculativeLinkEntry = {
  elementOrdinal: number;
  relationship: string;
  href: string | null;
};

export type OfflineScriptSafetyResult = {
  disabledCount: number;
  scripts: OfflineScriptSafetyEntry[];
  removedSpeculativeLinkCount: number;
  speculativeLinks: OfflineSpeculativeLinkEntry[];
};

export type HtmlCssRewriteResult = {
  elementOrdinal: number;
  tagName: string;
  sourceType: EmbeddedCssSourceType;
  attributeName: 'style' | (typeof SVG_PRESENTATION_ATTRIBUTES)[number] | null;
  originalValue: string;
  result: CssRewriteResult;
};

export type HtmlSrcsetRewriteResult = {
  elementOrdinal: number;
  tagName: 'img' | 'source' | 'link';
  attributeName: 'srcset' | 'imagesrcset';
  originalValue: string;
  result: SrcsetRewriteResult;
};

export type RewriteHtmlResourceOptions = {
  html: string;
  documentUrl: string;
  baseUrl: string;
  documentPath: string;
  savedResourceMappings: readonly ResourcePathMapping[];
  uncapturedResourcePolicy?: 'preserve' | 'neutralize';
  disableExecutableScripts?: boolean;
  parser?: HtmlDomParser;
};

const DISABLED_SCRIPT_TYPE = 'application/sitecapsule-disabled';
const SPECULATIVE_LINK_RELATIONSHIPS = new Set([
  'dns-prefetch',
  'modulepreload',
  'preconnect',
  'prefetch',
  'prerender',
]);

function isExecutableScript(element: Element): boolean {
  const type = (element.getAttribute('type') ?? '').trim().toLowerCase();
  return (
    type === '' ||
    type === 'module' ||
    type === 'text/javascript' ||
    type === 'application/javascript' ||
    type === 'text/ecmascript' ||
    type === 'application/ecmascript'
  );
}

function disableExecutableScripts(
  document: Document,
  elementOrdinals: ReadonlyMap<Element, number>,
): OfflineScriptSafetyResult {
  const scripts: OfflineScriptSafetyEntry[] = [];
  const speculativeLinks: OfflineSpeculativeLinkEntry[] = [];
  for (const script of Array.from(document.querySelectorAll('script'))) {
    if (script.hasAttribute('data-sitecapsule-service-worker-policy')) continue;
    if (!isExecutableScript(script)) continue;
    const originalType = script.getAttribute('type');
    scripts.push({
      elementOrdinal: elementOrdinals.get(script) ?? 0,
      originalType,
      source: script.getAttribute('src'),
    });
    script.setAttribute('type', DISABLED_SCRIPT_TYPE);
    script.setAttribute('data-sitecapsule-original-script-type', originalType ?? 'classic');
  }
  for (const link of Array.from(document.querySelectorAll('link[rel]'))) {
    const relationships = (link.getAttribute('rel') ?? '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!relationships.some((value) => SPECULATIVE_LINK_RELATIONSHIPS.has(value))) continue;
    speculativeLinks.push({
      elementOrdinal: elementOrdinals.get(link) ?? 0,
      relationship: relationships.join(' '),
      href: link.getAttribute('href'),
    });
    link.remove();
  }
  return {
    disabledCount: scripts.length,
    scripts,
    removedSpeculativeLinkCount: speculativeLinks.length,
    speculativeLinks,
  };
}

function createParser(parser?: HtmlDomParser): HtmlDomParser {
  if (parser) return parser;
  if (typeof DOMParser === 'undefined') {
    throw new Error('DOMParser is unavailable; HTML rewriting must run in a DOM-capable context.');
  }
  return new DOMParser();
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
        if (options.uncapturedResourcePolicy === 'neutralize') {
          element.removeAttribute(attributeName);
          if (element.hasAttribute('integrity')) element.removeAttribute('integrity');
          references.push({ ...common, status: 'invalid', neutralizedValue: null });
        } else references.push({ ...common, status: 'invalid' });
        continue;
      }

      if (!isNetworkProtocol(resolved.protocol)) {
        const neutralize =
          options.uncapturedResourcePolicy === 'neutralize' && resolved.protocol !== 'data:';
        if (neutralize) {
          element.removeAttribute(attributeName);
          if (element.hasAttribute('integrity')) element.removeAttribute('integrity');
        }
        references.push({
          ...common,
          status: 'unsupported',
          resolvedUrl: resolved.href,
          protocol: resolved.protocol,
          ...(neutralize ? { neutralizedValue: null } : {}),
        });
        continue;
      }

      const fragment = resolved.hash;
      const normalizedUrl = normalizeResourceUrl(resolved.href);
      if (normalizedUrl === null) {
        if (options.uncapturedResourcePolicy === 'neutralize') {
          element.removeAttribute(attributeName);
          if (element.hasAttribute('integrity')) element.removeAttribute('integrity');
          references.push({ ...common, status: 'invalid', neutralizedValue: null });
        } else references.push({ ...common, status: 'invalid' });
        continue;
      }
      const mapping = savedResources.get(normalizedUrl);
      if (!mapping) {
        const neutralize = options.uncapturedResourcePolicy === 'neutralize';
        if (neutralize) {
          element.removeAttribute(attributeName);
          if (element.hasAttribute('integrity')) element.removeAttribute('integrity');
        }
        references.push({
          ...common,
          status: 'unmapped',
          resolvedUrl: resolved.href,
          normalizedUrl,
          ...(neutralize ? { neutralizedValue: null } : {}),
        });
        continue;
      }

      const rewrittenValue = createLocalArchiveReference(
        options.documentPath,
        mapping.relativePath,
        fragment,
      );
      element.setAttribute(attributeName, rewrittenValue);
      if (element.hasAttribute('integrity')) element.removeAttribute('integrity');
      if (element.hasAttribute('crossorigin')) element.removeAttribute('crossorigin');
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

  const srcsetRewrites: HtmlSrcsetRewriteResult[] = [];
  for (const element of elements) {
    for (const attributeName of ['srcset', 'imagesrcset'] as const) {
      if (!isDomResourceAttribute(element, attributeName)) continue;
      const originalValue = element.getAttribute(attributeName);
      if (originalValue === null || originalValue.trim() === '') continue;

      const result = rewriteSrcsetResource({
        srcset: originalValue,
        baseUrl,
        sourcePath: options.documentPath,
        savedResourceMappings: options.savedResourceMappings,
        uncapturedResourcePolicy: options.uncapturedResourcePolicy,
      });
      if (result.changedCount > 0) {
        element.setAttribute(attributeName, result.srcset);
        if (element.hasAttribute('crossorigin')) element.removeAttribute('crossorigin');
      }
      srcsetRewrites.push({
        elementOrdinal: elementOrdinals.get(element) ?? 0,
        tagName: element.tagName.toLowerCase() as 'img' | 'source' | 'link',
        attributeName,
        originalValue,
        result,
      });
    }
  }

  const cssRewrites: HtmlCssRewriteResult[] = [];
  for (const element of elements) {
    const common = {
      elementOrdinal: elementOrdinals.get(element) ?? 0,
      tagName: element.tagName.toLowerCase(),
    };

    if (element.tagName.toLowerCase() === 'style' && element.textContent?.trim()) {
      const originalValue = element.textContent;
      const result = rewriteCssResource({
        cssText: originalValue,
        context: 'stylesheet',
        baseUrl,
        sourcePath: options.documentPath,
        savedResourceMappings: options.savedResourceMappings,
        uncapturedResourcePolicy: options.uncapturedResourcePolicy,
      });
      if (result.changedCount > 0) element.textContent = result.cssText;
      cssRewrites.push({
        ...common,
        sourceType: 'style-element',
        attributeName: null,
        originalValue,
        result,
      });
    }

    const style = element.getAttribute('style');
    if (style?.trim()) {
      const result = rewriteCssResource({
        cssText: style,
        context: 'declaration-list',
        baseUrl,
        sourcePath: options.documentPath,
        savedResourceMappings: options.savedResourceMappings,
        uncapturedResourcePolicy: options.uncapturedResourcePolicy,
      });
      if (result.changedCount > 0) element.setAttribute('style', result.cssText);
      cssRewrites.push({
        ...common,
        sourceType: 'style-attribute',
        attributeName: 'style',
        originalValue: style,
        result,
      });
    }

    if (element.namespaceURI !== 'http://www.w3.org/2000/svg') continue;
    for (const attributeName of SVG_PRESENTATION_ATTRIBUTES) {
      const value = element.getAttribute(attributeName);
      if (!value?.trim()) continue;
      const result = rewriteCssResource({
        cssText: value,
        context: 'value',
        baseUrl,
        sourcePath: options.documentPath,
        savedResourceMappings: options.savedResourceMappings,
        uncapturedResourcePolicy: options.uncapturedResourcePolicy,
      });
      if (result.changedCount > 0) element.setAttribute(attributeName, result.cssText);
      cssRewrites.push({
        ...common,
        sourceType: 'svg-presentation-attribute',
        attributeName,
        originalValue: value,
        result,
      });
    }
  }

  const serviceWorkerSafety = applyServiceWorkerSafetyPolicy(document, elementOrdinals);
  const scriptSafety = options.disableExecutableScripts
    ? disableExecutableScripts(document, elementOrdinals)
    : {
        disabledCount: 0,
        scripts: [],
        removedSpeculativeLinkCount: 0,
        speculativeLinks: [],
      };
  const rewrittenNormalizedUrls = new Set<string>();
  for (const reference of references) {
    if (reference.status === 'rewritten') rewrittenNormalizedUrls.add(reference.normalizedUrl);
  }
  for (const rewrite of srcsetRewrites) {
    for (const reference of rewrite.result.references) {
      if (reference.status === 'rewritten') rewrittenNormalizedUrls.add(reference.normalizedUrl);
    }
  }
  for (const rewrite of cssRewrites) {
    for (const reference of rewrite.result.references) {
      if (reference.status === 'rewritten') rewrittenNormalizedUrls.add(reference.normalizedUrl);
    }
  }
  const rewrittenResourceTypes = new Set<ResourceType>();
  for (const normalizedUrl of rewrittenNormalizedUrls) {
    const mapping = savedResources.get(normalizedUrl);
    if (mapping) rewrittenResourceTypes.add(mapping.resourceType);
  }
  const cspAdjustment = adjustContentSecurityPolicies(
    document,
    RESOURCE_TYPES.filter((resourceType) => rewrittenResourceTypes.has(resourceType)),
    elementOrdinals,
  );
  const contentChanges = buildContentChangeReport({
    documentPath: options.documentPath,
    references,
    baseHrefRemovals,
    cssRewrites,
    srcsetRewrites,
    serviceWorkerSafety,
    cspAdjustment,
    scriptSafety,
  });

  return {
    html: serializeHtmlDocument(document),
    documentPath: options.documentPath,
    rewrittenCount: references.filter((reference) => reference.status === 'rewritten').length,
    references,
    baseHrefRemovals,
    cssRewrittenCount: cssRewrites.reduce(
      (total, rewrite) => total + rewrite.result.rewrittenCount,
      0,
    ),
    cssRewrites,
    srcsetRewrittenCount: srcsetRewrites.reduce(
      (total, rewrite) => total + rewrite.result.rewrittenCount,
      0,
    ),
    srcsetRewrites,
    serviceWorkerSafety,
    cspAdjustment,
    contentChanges,
    scriptSafety,
  };
}
