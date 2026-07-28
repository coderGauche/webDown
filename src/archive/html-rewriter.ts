import {
  isDomResourceAttribute,
  isSvgResourceAttribute,
  SVG_RESOURCE_ATTRIBUTES,
  SVG_PRESENTATION_ATTRIBUTES,
  type EmbeddedCssSourceType,
  type DomResourceAttribute,
  type SvgResourceAttribute,
} from '@sitecapsule/discovery';
import { normalizeResourceUrl, serializeDocumentType } from '@sitecapsule/page';

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
  cssRewrittenCount: number;
  cssRewrites: HtmlCssRewriteResult[];
  srcsetRewrittenCount: number;
  srcsetRewrites: HtmlSrcsetRewriteResult[];
};

export type HtmlCssRewriteResult = {
  elementOrdinal: number;
  tagName: string;
  sourceType: EmbeddedCssSourceType;
  attributeName: 'style' | (typeof SVG_PRESENTATION_ATTRIBUTES)[number] | null;
  result: CssRewriteResult;
};

export type HtmlSrcsetRewriteResult = {
  elementOrdinal: number;
  tagName: 'img' | 'source';
  attributeName: 'srcset';
  originalValue: string;
  result: SrcsetRewriteResult;
};

export type RewriteHtmlResourceOptions = {
  html: string;
  documentUrl: string;
  baseUrl: string;
  documentPath: string;
  savedResourceMappings: readonly ResourcePathMapping[];
  parser?: HtmlDomParser;
};

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
        references.push({ ...common, status: 'invalid' });
        continue;
      }

      if (!isNetworkProtocol(resolved.protocol)) {
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

      const rewrittenValue = createLocalArchiveReference(
        options.documentPath,
        mapping.relativePath,
        fragment,
      );
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

  const srcsetRewrites: HtmlSrcsetRewriteResult[] = [];
  for (const element of elements) {
    if (!isDomResourceAttribute(element, 'srcset')) continue;
    const originalValue = element.getAttribute('srcset');
    if (originalValue === null || originalValue.trim() === '') continue;

    const result = rewriteSrcsetResource({
      srcset: originalValue,
      baseUrl,
      sourcePath: options.documentPath,
      savedResourceMappings: options.savedResourceMappings,
    });
    if (result.rewrittenCount > 0) element.setAttribute('srcset', result.srcset);
    srcsetRewrites.push({
      elementOrdinal: elementOrdinals.get(element) ?? 0,
      tagName: element.tagName.toLowerCase() as 'img' | 'source',
      attributeName: 'srcset',
      originalValue,
      result,
    });
  }

  const cssRewrites: HtmlCssRewriteResult[] = [];
  for (const element of elements) {
    const common = {
      elementOrdinal: elementOrdinals.get(element) ?? 0,
      tagName: element.tagName.toLowerCase(),
    };

    if (element.tagName.toLowerCase() === 'style' && element.textContent?.trim()) {
      const result = rewriteCssResource({
        cssText: element.textContent,
        context: 'stylesheet',
        baseUrl,
        sourcePath: options.documentPath,
        savedResourceMappings: options.savedResourceMappings,
      });
      if (result.rewrittenCount > 0) element.textContent = result.cssText;
      cssRewrites.push({
        ...common,
        sourceType: 'style-element',
        attributeName: null,
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
      });
      if (result.rewrittenCount > 0) element.setAttribute('style', result.cssText);
      cssRewrites.push({
        ...common,
        sourceType: 'style-attribute',
        attributeName: 'style',
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
      });
      if (result.rewrittenCount > 0) element.setAttribute(attributeName, result.cssText);
      cssRewrites.push({
        ...common,
        sourceType: 'svg-presentation-attribute',
        attributeName,
        result,
      });
    }
  }

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
  };
}
