export const EMBEDDED_CSS_SOURCE_TYPES = [
  'style-attribute',
  'style-element',
  'svg-presentation-attribute',
] as const;
export const SVG_RESOURCE_ATTRIBUTES = ['href', 'xlink:href'] as const;
export const SVG_PRESENTATION_ATTRIBUTES = [
  'clip-path',
  'cursor',
  'fill',
  'filter',
  'marker',
  'marker-end',
  'marker-mid',
  'marker-start',
  'mask',
  'stroke',
] as const;

export type EmbeddedCssSourceType = (typeof EMBEDDED_CSS_SOURCE_TYPES)[number];
export type SvgResourceAttribute = (typeof SVG_RESOURCE_ATTRIBUTES)[number];
export type SvgPresentationAttribute = (typeof SVG_PRESENTATION_ATTRIBUTES)[number];

export type EmbeddedCssSource = {
  source: EmbeddedCssSourceType;
  ordinal: number;
  tagName: string;
  cssText: string;
  attributeName?: 'style' | SvgPresentationAttribute;
  documentUrl: string;
  baseUrl: string;
};

export type SvgResourceCandidate = {
  source: 'svg';
  ordinal: number;
  tagName: string;
  attributeName: SvgResourceAttribute;
  attributeValue: string;
  rawUrl: string;
  resolvedUrl: string;
  documentUrl: string;
  baseUrl: string;
};

export type EmbeddedResourceSource = Pick<Document, 'URL' | 'baseURI'> & {
  querySelectorAll(selectors: string): NodeListOf<Element> | readonly Element[];
};

export type EmbeddedResourceDiscovery = {
  cssSources: EmbeddedCssSource[];
  svgResources: SvgResourceCandidate[];
};

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const SVG_RESOURCE_TAGS = new Set([
  'clippath',
  'feimage',
  'filter',
  'image',
  'lineargradient',
  'mask',
  'mpath',
  'pattern',
  'radialgradient',
  'script',
  'textpath',
  'use',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => actualKeys.includes(key));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isCanonicalAbsoluteUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    return new URL(value).href === value;
  } catch {
    return false;
  }
}

function isNormalizedTagName(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.toLowerCase() === value;
}

export function isEmbeddedCssSource(value: unknown): value is EmbeddedCssSource {
  if (!isRecord(value)) return false;
  const commonKeys = ['source', 'ordinal', 'tagName', 'cssText', 'documentUrl', 'baseUrl'] as const;
  const hasValidCommonFields =
    EMBEDDED_CSS_SOURCE_TYPES.includes(value.source as EmbeddedCssSourceType) &&
    isPositiveSafeInteger(value.ordinal) &&
    isNormalizedTagName(value.tagName) &&
    typeof value.cssText === 'string' &&
    value.cssText.trim() !== '' &&
    isCanonicalAbsoluteUrl(value.documentUrl) &&
    isCanonicalAbsoluteUrl(value.baseUrl);
  if (!hasValidCommonFields) return false;

  if (value.source === 'style-element') {
    return hasExactKeys(value, commonKeys) && value.tagName === 'style';
  }
  if (!hasExactKeys(value, [...commonKeys, 'attributeName'])) return false;
  if (value.source === 'style-attribute') return value.attributeName === 'style';
  return SVG_PRESENTATION_ATTRIBUTES.includes(value.attributeName as SvgPresentationAttribute);
}

export function isSvgResourceCandidate(value: unknown): value is SvgResourceCandidate {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'source',
      'ordinal',
      'tagName',
      'attributeName',
      'attributeValue',
      'rawUrl',
      'resolvedUrl',
      'documentUrl',
      'baseUrl',
    ]) &&
    value.source === 'svg' &&
    isPositiveSafeInteger(value.ordinal) &&
    isNormalizedTagName(value.tagName) &&
    SVG_RESOURCE_TAGS.has(value.tagName) &&
    SVG_RESOURCE_ATTRIBUTES.includes(value.attributeName as SvgResourceAttribute) &&
    typeof value.attributeValue === 'string' &&
    value.attributeValue.trim() !== '' &&
    typeof value.rawUrl === 'string' &&
    value.rawUrl.trim() === value.rawUrl &&
    value.rawUrl !== '' &&
    !value.rawUrl.startsWith('#') &&
    isCanonicalAbsoluteUrl(value.resolvedUrl) &&
    isCanonicalAbsoluteUrl(value.documentUrl) &&
    isCanonicalAbsoluteUrl(value.baseUrl)
  );
}

function createCssSource(
  source: EmbeddedResourceSource,
  element: Element,
  sourceType: EmbeddedCssSourceType,
  cssText: string,
  ordinal: number,
  attributeName?: 'style' | SvgPresentationAttribute,
): EmbeddedCssSource {
  return {
    source: sourceType,
    ordinal,
    tagName: element.tagName.toLowerCase(),
    cssText,
    ...(attributeName ? { attributeName } : {}),
    documentUrl: source.URL,
    baseUrl: source.baseURI,
  };
}

function createSvgCandidate(
  source: EmbeddedResourceSource,
  element: Element,
  attributeName: SvgResourceAttribute,
  attributeValue: string,
  ordinal: number,
): SvgResourceCandidate | null {
  const rawUrl = attributeValue.trim();
  if (!rawUrl || rawUrl.startsWith('#')) return null;

  let resolvedUrl: string;
  try {
    resolvedUrl = new URL(rawUrl, source.baseURI).href;
  } catch {
    return null;
  }

  return {
    source: 'svg',
    ordinal,
    tagName: element.tagName.toLowerCase(),
    attributeName,
    attributeValue,
    rawUrl,
    resolvedUrl,
    documentUrl: source.URL,
    baseUrl: source.baseURI,
  };
}

export function discoverEmbeddedResources(
  source: EmbeddedResourceSource,
): EmbeddedResourceDiscovery {
  const cssSources: EmbeddedCssSource[] = [];
  const svgResources: SvgResourceCandidate[] = [];

  for (const element of Array.from(source.querySelectorAll('*'))) {
    const tagName = element.tagName.toLowerCase();
    const inlineStyle = element.getAttribute('style');
    if (inlineStyle?.trim()) {
      cssSources.push(
        createCssSource(
          source,
          element,
          'style-attribute',
          inlineStyle,
          cssSources.length + 1,
          'style',
        ),
      );
    }

    if (element.namespaceURI === SVG_NAMESPACE) {
      for (const attributeName of SVG_PRESENTATION_ATTRIBUTES) {
        const attributeValue = element.getAttribute(attributeName);
        if (!attributeValue?.trim()) continue;
        cssSources.push(
          createCssSource(
            source,
            element,
            'svg-presentation-attribute',
            attributeValue,
            cssSources.length + 1,
            attributeName,
          ),
        );
      }
    }

    if (tagName === 'style' && element.textContent?.trim()) {
      cssSources.push(
        createCssSource(
          source,
          element,
          'style-element',
          element.textContent,
          cssSources.length + 1,
        ),
      );
    }

    if (element.namespaceURI !== SVG_NAMESPACE || !SVG_RESOURCE_TAGS.has(tagName)) continue;
    for (const attributeName of SVG_RESOURCE_ATTRIBUTES) {
      const attributeValue = element.getAttribute(attributeName);
      if (attributeValue === null) continue;
      const candidate = createSvgCandidate(
        source,
        element,
        attributeName,
        attributeValue,
        svgResources.length + 1,
      );
      if (candidate) svgResources.push(candidate);
    }
  }

  return { cssSources, svgResources };
}
