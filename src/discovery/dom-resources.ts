export const DOM_RESOURCE_ATTRIBUTES = ['src', 'href', 'srcset', 'poster'] as const;

export type DomResourceAttribute = (typeof DOM_RESOURCE_ATTRIBUTES)[number];

export type DomResourceCandidate = {
  source: 'dom';
  tagName: string;
  attributeName: DomResourceAttribute;
  attributeValue: string;
  rawUrl: string;
  resolvedUrl: string;
  documentUrl: string;
  baseUrl: string;
  descriptor?: string;
};

export type DomResourceSource = Pick<Document, 'URL' | 'baseURI'> & {
  querySelectorAll(selectors: string): NodeListOf<Element> | readonly Element[];
};

type SrcsetCandidate = {
  rawUrl: string;
  descriptor?: string;
};

const SRC_TAGS = new Set([
  'audio',
  'embed',
  'frame',
  'iframe',
  'img',
  'script',
  'source',
  'track',
  'video',
]);
const SRCSET_TAGS = new Set(['img', 'source']);
const LINK_RESOURCE_RELATIONS = new Set([
  'apple-touch-icon',
  'icon',
  'manifest',
  'mask-icon',
  'modulepreload',
  'preload',
  'stylesheet',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbsoluteUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    return new URL(value).href === value;
  } catch {
    return false;
  }
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function supportsAttribute(tagName: string, attributeName: DomResourceAttribute): boolean {
  if (attributeName === 'src') return SRC_TAGS.has(tagName) || tagName === 'input';
  if (attributeName === 'href') return tagName === 'link';
  if (attributeName === 'srcset') return SRCSET_TAGS.has(tagName);
  return tagName === 'video';
}

export function isDomResourceCandidate(value: unknown): value is DomResourceCandidate {
  if (!isRecord(value)) return false;
  if (
    !hasOnlyKeys(value, [
      'source',
      'tagName',
      'attributeName',
      'attributeValue',
      'rawUrl',
      'resolvedUrl',
      'documentUrl',
      'baseUrl',
      'descriptor',
    ]) ||
    value.source !== 'dom' ||
    typeof value.tagName !== 'string' ||
    !DOM_RESOURCE_ATTRIBUTES.includes(value.attributeName as DomResourceAttribute) ||
    typeof value.attributeValue !== 'string' ||
    value.attributeValue.trim() === '' ||
    typeof value.rawUrl !== 'string' ||
    value.rawUrl.trim() === '' ||
    value.rawUrl.trim() !== value.rawUrl ||
    !isAbsoluteUrl(value.resolvedUrl) ||
    !isAbsoluteUrl(value.documentUrl) ||
    !isAbsoluteUrl(value.baseUrl)
  ) {
    return false;
  }

  const tagName = value.tagName.toLowerCase();
  const attributeName = value.attributeName as DomResourceAttribute;
  if (tagName !== value.tagName || !supportsAttribute(tagName, attributeName)) return false;

  return attributeName === 'srcset'
    ? value.descriptor === undefined ||
        (typeof value.descriptor === 'string' &&
          value.descriptor.trim() !== '' &&
          value.descriptor.trim() === value.descriptor)
    : value.descriptor === undefined;
}

function isAsciiWhitespace(character: string): boolean {
  return (
    character === ' ' ||
    character === '\n' ||
    character === '\t' ||
    character === '\r' ||
    character === '\f'
  );
}

export function parseSrcsetCandidates(value: string): SrcsetCandidate[] {
  const candidates: SrcsetCandidate[] = [];
  let position = 0;

  while (position < value.length) {
    while (
      position < value.length &&
      (isAsciiWhitespace(value[position] ?? '') || value[position] === ',')
    ) {
      position += 1;
    }
    if (position >= value.length) break;

    const urlStart = position;
    while (position < value.length && !isAsciiWhitespace(value[position] ?? '')) position += 1;
    let rawUrl = value.slice(urlStart, position);

    if (rawUrl.endsWith(',')) {
      rawUrl = rawUrl.replace(/,+$/, '');
      if (rawUrl) candidates.push({ rawUrl });
      continue;
    }

    while (position < value.length && isAsciiWhitespace(value[position] ?? '')) position += 1;
    const descriptorStart = position;
    let parenthesisDepth = 0;

    while (position < value.length) {
      const character = value[position] ?? '';
      if (character === '(') parenthesisDepth += 1;
      if (character === ')' && parenthesisDepth > 0) parenthesisDepth -= 1;
      if (character === ',' && parenthesisDepth === 0) break;
      position += 1;
    }

    const descriptor = value.slice(descriptorStart, position).trim();
    if (position < value.length && value[position] === ',') position += 1;
    if (rawUrl) candidates.push({ rawUrl, ...(descriptor ? { descriptor } : {}) });
  }

  return candidates;
}

function isResourceLink(element: Element): boolean {
  if (element.tagName.toLowerCase() !== 'link') return false;
  const relations = (element.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return relations.some((relation) => LINK_RESOURCE_RELATIONS.has(relation));
}

function isResourceAttribute(element: Element, attributeName: DomResourceAttribute): boolean {
  const tagName = element.tagName.toLowerCase();
  if (!supportsAttribute(tagName, attributeName)) return false;
  if (attributeName === 'href') return isResourceLink(element);
  if (attributeName === 'src' && tagName === 'input') {
    return (element.getAttribute('type') ?? '').toLowerCase() === 'image';
  }
  return true;
}

function resolveCandidate(
  source: DomResourceSource,
  element: Element,
  attributeName: DomResourceAttribute,
  attributeValue: string,
  rawUrl: string,
  descriptor?: string,
): DomResourceCandidate | null {
  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl) return null;

  let resolvedUrl: string;
  try {
    resolvedUrl = new URL(trimmedUrl, source.baseURI).href;
  } catch {
    return null;
  }

  return {
    source: 'dom',
    tagName: element.tagName.toLowerCase(),
    attributeName,
    attributeValue,
    rawUrl: trimmedUrl,
    resolvedUrl,
    documentUrl: source.URL,
    baseUrl: source.baseURI,
    ...(descriptor ? { descriptor } : {}),
  };
}

export function discoverDomResources(source: DomResourceSource): DomResourceCandidate[] {
  const candidates: DomResourceCandidate[] = [];

  for (const element of Array.from(source.querySelectorAll('*'))) {
    for (const attributeName of DOM_RESOURCE_ATTRIBUTES) {
      if (!isResourceAttribute(element, attributeName)) continue;
      const attributeValue = element.getAttribute(attributeName);
      if (attributeValue === null || attributeValue.trim() === '') continue;

      const values =
        attributeName === 'srcset'
          ? parseSrcsetCandidates(attributeValue)
          : [{ rawUrl: attributeValue }];

      for (const value of values) {
        const candidate = resolveCandidate(
          source,
          element,
          attributeName,
          attributeValue,
          value.rawUrl,
          value.descriptor,
        );
        if (candidate) candidates.push(candidate);
      }
    }
  }

  return candidates;
}
