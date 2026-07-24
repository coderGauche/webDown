import {
  parse,
  walk,
  type Atrule,
  type CssLocation,
  type CssNode,
  type FunctionNode,
  type ListItem,
  type StringNode,
  type Url,
  type WalkContext,
} from 'css-tree';

import {
  EMBEDDED_CSS_SOURCE_TYPES,
  SVG_PRESENTATION_ATTRIBUTES,
  type EmbeddedCssSource,
  type EmbeddedCssSourceType,
  type SvgPresentationAttribute,
} from './embedded-resources';

export const CSS_RESOURCE_KINDS = ['url', 'import', 'font-face'] as const;

export type CssResourceKind = (typeof CSS_RESOURCE_KINDS)[number];

export type CssSourceLocation = {
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

export type CssResourceCandidate = {
  source: 'css';
  kind: CssResourceKind;
  ordinal: number;
  cssSourceOrdinal: number;
  cssSourceType: EmbeddedCssSourceType;
  tagName: string;
  attributeName: 'style' | SvgPresentationAttribute | null;
  propertyName: string | null;
  rawUrl: string;
  resolvedUrl: string;
  fontFormat: string | null;
  location: CssSourceLocation;
  documentUrl: string;
  baseUrl: string;
};

const CSS_PARSE_CONTEXT: Record<EmbeddedCssSourceType, 'declarationList' | 'stylesheet' | 'value'> =
  {
    'style-attribute': 'declarationList',
    'style-element': 'stylesheet',
    'svg-presentation-attribute': 'value',
  };

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

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isCanonicalAbsoluteUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    return new URL(value).href === value;
  } catch {
    return false;
  }
}

function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.trim() !== '');
}

function isCssAttributeName(value: unknown): value is CssResourceCandidate['attributeName'] {
  return (
    value === null ||
    value === 'style' ||
    SVG_PRESENTATION_ATTRIBUTES.includes(value as SvgPresentationAttribute)
  );
}

function hasMatchingCssSourceFields(value: Record<string, unknown>): boolean {
  if (value.cssSourceType === 'style-element') return value.attributeName === null;
  if (value.cssSourceType === 'style-attribute') return value.attributeName === 'style';
  return SVG_PRESENTATION_ATTRIBUTES.includes(value.attributeName as SvgPresentationAttribute);
}

export function isCssSourceLocation(value: unknown): value is CssSourceLocation {
  if (!isRecord(value)) return false;
  return (
    hasExactKeys(value, [
      'startOffset',
      'endOffset',
      'startLine',
      'startColumn',
      'endLine',
      'endColumn',
    ]) &&
    isNonNegativeSafeInteger(value.startOffset) &&
    isNonNegativeSafeInteger(value.endOffset) &&
    value.endOffset >= value.startOffset &&
    isPositiveSafeInteger(value.startLine) &&
    isPositiveSafeInteger(value.startColumn) &&
    isPositiveSafeInteger(value.endLine) &&
    isPositiveSafeInteger(value.endColumn)
  );
}

export function isCssResourceCandidate(value: unknown): value is CssResourceCandidate {
  if (!isRecord(value)) return false;
  return (
    hasExactKeys(value, [
      'source',
      'kind',
      'ordinal',
      'cssSourceOrdinal',
      'cssSourceType',
      'tagName',
      'attributeName',
      'propertyName',
      'rawUrl',
      'resolvedUrl',
      'fontFormat',
      'location',
      'documentUrl',
      'baseUrl',
    ]) &&
    value.source === 'css' &&
    CSS_RESOURCE_KINDS.includes(value.kind as CssResourceKind) &&
    isPositiveSafeInteger(value.ordinal) &&
    isPositiveSafeInteger(value.cssSourceOrdinal) &&
    EMBEDDED_CSS_SOURCE_TYPES.includes(value.cssSourceType as EmbeddedCssSourceType) &&
    typeof value.tagName === 'string' &&
    value.tagName !== '' &&
    value.tagName.toLowerCase() === value.tagName &&
    isCssAttributeName(value.attributeName) &&
    hasMatchingCssSourceFields(value) &&
    isNullableNonEmptyString(value.propertyName) &&
    typeof value.rawUrl === 'string' &&
    value.rawUrl.trim() === value.rawUrl &&
    value.rawUrl !== '' &&
    isCanonicalAbsoluteUrl(value.resolvedUrl) &&
    isNullableNonEmptyString(value.fontFormat) &&
    isCssSourceLocation(value.location) &&
    isCanonicalAbsoluteUrl(value.documentUrl) &&
    isCanonicalAbsoluteUrl(value.baseUrl) &&
    (value.kind === 'font-face'
      ? value.cssSourceType === 'style-element' && value.propertyName === 'src'
      : value.fontFormat === null) &&
    (value.kind !== 'import' ||
      (value.cssSourceType === 'style-element' && value.propertyName === null))
  );
}

function toSourceLocation(location: CssLocation | undefined): CssSourceLocation | null {
  if (!location) return null;
  return {
    startOffset: location.start.offset,
    endOffset: location.end.offset,
    startLine: location.start.line,
    startColumn: location.start.column,
    endLine: location.end.line,
    endColumn: location.end.column,
  };
}

function resolveCssUrl(rawUrl: string, baseUrl: string): string | null {
  const normalizedUrl = rawUrl.trim();
  if (!normalizedUrl) return null;
  try {
    return new URL(normalizedUrl, baseUrl).href;
  } catch {
    return null;
  }
}

function readFormatValue(node: FunctionNode): string | null {
  if (node.name.toLowerCase() !== 'format') return null;
  for (const child of node.children) {
    if (child.type === 'String') return child.value.trim() || null;
    if (child.type === 'Identifier') return child.name.trim() || null;
  }
  return null;
}

function findFollowingFontFormat(item: ListItem<CssNode>): string | null {
  for (let current = item.next; current; current = current.next) {
    if (current.data.type === 'Operator' && current.data.value === ',') return null;
    if (current.data.type === 'Url') return null;
    if (current.data.type === 'Function') {
      const format = readFormatValue(current.data);
      if (format) return format;
    }
  }
  return null;
}

function firstImportUrl(atrule: Atrule): Url | StringNode | null {
  if (atrule.name.toLowerCase() !== 'import' || atrule.prelude?.type !== 'AtrulePrelude') {
    return null;
  }
  for (const child of atrule.prelude.children) {
    if (child.type === 'Url' || child.type === 'String') return child;
    if (child.type !== 'WhiteSpace') return null;
  }
  return null;
}

function hasCompleteResourceSyntax(cssText: string, node: Url | StringNode): boolean {
  if (!node.loc) return false;
  const sourceText = cssText.slice(node.loc.start.offset, node.loc.end.offset).trim();
  if (node.type === 'Url') {
    return sourceText.toLowerCase().startsWith('url(') && sourceText.endsWith(')');
  }
  const quote = sourceText[0];
  return (quote === '"' || quote === "'") && sourceText.at(-1) === quote;
}

function createCandidate(
  cssSource: EmbeddedCssSource,
  kind: CssResourceKind,
  ordinal: number,
  resourceNode: Url | StringNode,
  propertyName: string | null,
  fontFormat: string | null,
): CssResourceCandidate | null {
  if (!hasCompleteResourceSyntax(cssSource.cssText, resourceNode)) return null;
  const sourceLocation = toSourceLocation(resourceNode.loc);
  const normalizedUrl = resourceNode.value.trim();
  const resolvedUrl = resolveCssUrl(normalizedUrl, cssSource.baseUrl);
  if (!sourceLocation || !normalizedUrl || !resolvedUrl) return null;

  return {
    source: 'css',
    kind,
    ordinal,
    cssSourceOrdinal: cssSource.ordinal,
    cssSourceType: cssSource.source,
    tagName: cssSource.tagName,
    attributeName: cssSource.attributeName ?? null,
    propertyName,
    rawUrl: normalizedUrl,
    resolvedUrl,
    fontFormat,
    location: sourceLocation,
    documentUrl: cssSource.documentUrl,
    baseUrl: cssSource.baseUrl,
  };
}

export function discoverCssResources(
  cssSources: readonly EmbeddedCssSource[],
): CssResourceCandidate[] {
  const candidates: CssResourceCandidate[] = [];

  for (const cssSource of cssSources) {
    let ast: CssNode;
    try {
      ast = parse(cssSource.cssText, {
        context: CSS_PARSE_CONTEXT[cssSource.source],
        filename: cssSource.documentUrl,
        positions: true,
        parseCustomProperty: true,
      });
    } catch {
      continue;
    }

    walk(ast, {
      enter(this: WalkContext, node: CssNode, item: ListItem<CssNode>) {
        if (node.type === 'Atrule') {
          const importUrl = firstImportUrl(node);
          if (!importUrl) return;
          const candidate = createCandidate(
            cssSource,
            'import',
            candidates.length + 1,
            importUrl,
            null,
            null,
          );
          if (candidate) candidates.push(candidate);
          return;
        }

        if (node.type !== 'Url') return;
        if (this.atrule?.name.toLowerCase() === 'import') return;

        const propertyName = this.declaration?.property.toLowerCase() ?? null;
        const isFontFace =
          this.atrule?.name.toLowerCase() === 'font-face' && propertyName === 'src';
        const candidate = createCandidate(
          cssSource,
          isFontFace ? 'font-face' : 'url',
          candidates.length + 1,
          node,
          propertyName,
          isFontFace && item ? findFollowingFontFormat(item) : null,
        );
        if (candidate) candidates.push(candidate);
      },
    });
  }

  return candidates;
}
