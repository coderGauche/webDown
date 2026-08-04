import {
  generate,
  parse,
  walk,
  type Atrule,
  type CssNode,
  type StringNode,
  type Url,
  type WalkContext,
} from 'css-tree';
import { normalizeResourceUrl } from '@sitecapsule/page';

import type { ResourcePathMapping } from './resource-path-mapping';
import {
  buildSavedResourceLookup,
  createLocalArchiveReference,
  isNetworkProtocol,
  validateArchivePath,
  validateNetworkUrl,
} from './rewrite-support';

export const CSS_REWRITE_CONTEXTS = ['stylesheet', 'declaration-list', 'value'] as const;
export type CssRewriteContext = (typeof CSS_REWRITE_CONTEXTS)[number];
export type CssRewriteKind = 'url' | 'import' | 'font-face';

type CssReferenceCommon = {
  ordinal: number;
  kind: CssRewriteKind;
  propertyName: string | null;
  originalValue: string;
};

export type CssReferenceResult =
  | (CssReferenceCommon & {
      status: 'rewritten';
      resolvedUrl: string;
      normalizedUrl: string;
      targetPath: string;
      rewrittenValue: string;
    })
  | (CssReferenceCommon & {
      status: 'unmapped';
      resolvedUrl: string;
      normalizedUrl: string;
      neutralizedValue?: string;
    })
  | (CssReferenceCommon & {
      status: 'unsupported';
      resolvedUrl: string;
      protocol: string;
      neutralizedValue?: string;
    })
  | (CssReferenceCommon & {
      status: 'fragment';
    })
  | (CssReferenceCommon & {
      status: 'invalid';
      neutralizedValue?: string;
    });

export type CssRewriteResult = {
  originalCssText: string;
  cssText: string;
  context: CssRewriteContext;
  sourcePath: string;
  rewrittenCount: number;
  neutralizedCount: number;
  changedCount: number;
  parseError: boolean;
  references: CssReferenceResult[];
};

export type RewriteCssResourceOptions = {
  cssText: string;
  context: CssRewriteContext;
  baseUrl: string;
  sourcePath: string;
  savedResourceMappings: readonly ResourcePathMapping[];
  uncapturedResourcePolicy?: 'preserve' | 'neutralize';
};

const OFFLINE_EMPTY_RESOURCE = 'data:,';

const CSS_TREE_CONTEXT: Record<CssRewriteContext, 'stylesheet' | 'declarationList' | 'value'> = {
  stylesheet: 'stylesheet',
  'declaration-list': 'declarationList',
  value: 'value',
};

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

function rewriteReference(
  node: Url | StringNode,
  kind: CssRewriteKind,
  propertyName: string | null,
  options: RewriteCssResourceOptions,
  baseUrl: string,
  savedResources: ReadonlyMap<string, ResourcePathMapping>,
  references: CssReferenceResult[],
): void {
  if (!hasCompleteResourceSyntax(options.cssText, node)) return;

  const originalValue = node.value.trim();
  const common: CssReferenceCommon = {
    ordinal: references.length + 1,
    kind,
    propertyName,
    originalValue,
  };
  if (!originalValue) {
    if (options.uncapturedResourcePolicy === 'neutralize') {
      node.value = OFFLINE_EMPTY_RESOURCE;
      references.push({
        ...common,
        status: 'invalid',
        neutralizedValue: OFFLINE_EMPTY_RESOURCE,
      });
    } else references.push({ ...common, status: 'invalid' });
    return;
  }
  if (originalValue.startsWith('#')) {
    references.push({ ...common, status: 'fragment' });
    return;
  }

  let resolved: URL;
  try {
    resolved = new URL(originalValue, baseUrl);
  } catch {
    if (options.uncapturedResourcePolicy === 'neutralize') {
      node.value = OFFLINE_EMPTY_RESOURCE;
      references.push({
        ...common,
        status: 'invalid',
        neutralizedValue: OFFLINE_EMPTY_RESOURCE,
      });
    } else references.push({ ...common, status: 'invalid' });
    return;
  }

  if (!isNetworkProtocol(resolved.protocol)) {
    const neutralize =
      options.uncapturedResourcePolicy === 'neutralize' && resolved.protocol !== 'data:';
    if (neutralize) node.value = OFFLINE_EMPTY_RESOURCE;
    references.push({
      ...common,
      status: 'unsupported',
      resolvedUrl: resolved.href,
      protocol: resolved.protocol,
      ...(neutralize ? { neutralizedValue: OFFLINE_EMPTY_RESOURCE } : {}),
    });
    return;
  }

  const fragment = resolved.hash;
  const normalizedUrl = normalizeResourceUrl(resolved.href);
  if (normalizedUrl === null) {
    if (options.uncapturedResourcePolicy === 'neutralize') {
      node.value = OFFLINE_EMPTY_RESOURCE;
      references.push({
        ...common,
        status: 'invalid',
        neutralizedValue: OFFLINE_EMPTY_RESOURCE,
      });
    } else references.push({ ...common, status: 'invalid' });
    return;
  }
  const mapping = savedResources.get(normalizedUrl);
  if (!mapping) {
    const neutralize = options.uncapturedResourcePolicy === 'neutralize';
    if (neutralize) node.value = OFFLINE_EMPTY_RESOURCE;
    references.push({
      ...common,
      status: 'unmapped',
      resolvedUrl: resolved.href,
      normalizedUrl,
      ...(neutralize ? { neutralizedValue: OFFLINE_EMPTY_RESOURCE } : {}),
    });
    return;
  }

  const rewrittenValue = createLocalArchiveReference(
    options.sourcePath,
    mapping.relativePath,
    fragment,
  );
  node.value = rewrittenValue;
  references.push({
    ...common,
    status: 'rewritten',
    resolvedUrl: resolved.href,
    normalizedUrl,
    targetPath: mapping.relativePath,
    rewrittenValue,
  });
}

export function rewriteCssResource(options: RewriteCssResourceOptions): CssRewriteResult {
  if (!options || typeof options !== 'object')
    throw new TypeError('CSS rewrite options are required.');
  if (typeof options.cssText !== 'string') throw new TypeError('CSS source must be a string.');
  if (!CSS_REWRITE_CONTEXTS.includes(options.context)) {
    throw new TypeError('CSS rewrite context is not supported.');
  }

  const baseUrl = validateNetworkUrl(options.baseUrl, 'CSS base URL');
  validateArchivePath(options.sourcePath, 'CSS source path');
  const savedResources = buildSavedResourceLookup(options.savedResourceMappings);
  let ast: CssNode;
  try {
    ast = parse(options.cssText, {
      context: CSS_TREE_CONTEXT[options.context],
      filename: baseUrl,
      positions: true,
      parseCustomProperty: true,
    });
  } catch {
    return {
      originalCssText: options.cssText,
      cssText: options.cssText,
      context: options.context,
      sourcePath: options.sourcePath,
      rewrittenCount: 0,
      neutralizedCount: 0,
      changedCount: 0,
      parseError: true,
      references: [],
    };
  }

  const references: CssReferenceResult[] = [];
  walk(ast, {
    enter(this: WalkContext, node: CssNode) {
      if (node.type === 'Atrule') {
        const importUrl = firstImportUrl(node);
        if (importUrl) {
          rewriteReference(importUrl, 'import', null, options, baseUrl, savedResources, references);
        }
        return;
      }

      if (node.type !== 'Url') return;
      if (this.atrule?.name.toLowerCase() === 'import' || this.atrulePrelude) return;
      if (options.context !== 'value' && !this.declaration) return;

      const propertyName = this.declaration?.property.toLowerCase() ?? null;
      const kind =
        this.atrule?.name.toLowerCase() === 'font-face' && propertyName === 'src'
          ? 'font-face'
          : 'url';
      rewriteReference(node, kind, propertyName, options, baseUrl, savedResources, references);
    },
  });

  const rewrittenCount = references.filter((reference) => reference.status === 'rewritten').length;
  const neutralizedCount = references.filter((reference) => 'neutralizedValue' in reference).length;
  const changedCount = rewrittenCount + neutralizedCount;
  return {
    originalCssText: options.cssText,
    cssText: changedCount === 0 ? options.cssText : generate(ast),
    context: options.context,
    sourcePath: options.sourcePath,
    rewrittenCount,
    neutralizedCount,
    changedCount,
    parseError: false,
    references,
  };
}
