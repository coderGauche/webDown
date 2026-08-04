import { normalizeResourceUrl } from '@sitecapsule/page';
import { parse, type Node } from 'acorn';

import type { ResourcePathMapping } from './resource-path-mapping';
import {
  buildSavedResourceLookup,
  createLocalArchiveReference,
  validateArchivePath,
  validateNetworkUrl,
} from './rewrite-support';

type AstNode = Node & Record<string, unknown>;

type Replacement = {
  start: number;
  end: number;
  value: string;
  originalUrl: string;
  normalizedUrl: string;
  targetPath: string;
};

export type JavascriptRewriteResult = {
  javascript: string;
  rewrittenCount: number;
  parseError: boolean;
  rewrites: Array<{
    originalUrl: string;
    normalizedUrl: string;
    targetPath: string;
    rewrittenValue: string;
  }>;
};

export type RewriteJavascriptResourceOptions = {
  javascript: string;
  baseUrl: string;
  sourcePath: string;
  savedResourceMappings: readonly ResourcePathMapping[];
};

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    Number.isSafeInteger((value as { start?: unknown }).start) &&
    Number.isSafeInteger((value as { end?: unknown }).end)
  );
}

function visit(node: AstNode, visitor: (node: AstNode) => void): void {
  visitor(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
    if (isAstNode(value)) visit(value, visitor);
    else if (Array.isArray(value)) {
      for (const child of value) if (isAstNode(child)) visit(child, visitor);
    }
  }
}

function identifierName(value: unknown): string | null {
  return isAstNode(value) && value.type === 'Identifier' && typeof value.name === 'string'
    ? value.name
    : null;
}

function literalString(value: unknown): { node: AstNode; value: string } | null {
  if (!isAstNode(value) || value.type !== 'Literal' || typeof value.value !== 'string') return null;
  return { node: value, value: value.value };
}

function candidateLiteral(node: AstNode): { node: AstNode; value: string } | null {
  if (
    node.type === 'ImportDeclaration' ||
    node.type === 'ExportNamedDeclaration' ||
    node.type === 'ExportAllDeclaration' ||
    node.type === 'ImportExpression'
  ) {
    return literalString(node.source);
  }

  const calleeName = identifierName(node.callee);
  const args = Array.isArray(node.arguments) ? node.arguments : [];
  if (
    node.type === 'NewExpression' &&
    ['Worker', 'SharedWorker', 'URL', 'Request'].includes(calleeName ?? '')
  ) {
    return literalString(args[0]);
  }
  if (node.type === 'CallExpression' && ['fetch', 'importScripts'].includes(calleeName ?? '')) {
    return literalString(args[0]);
  }
  return null;
}

function parseJavascript(source: string): AstNode | null {
  for (const sourceType of ['module', 'script'] as const) {
    try {
      return parse(source, {
        ecmaVersion: 'latest',
        sourceType,
        allowHashBang: true,
      }) as unknown as AstNode;
    } catch {
      // Try the other source type before reporting an opaque bundle.
    }
  }
  return null;
}

export function rewriteJavascriptResource(
  options: RewriteJavascriptResourceOptions,
): JavascriptRewriteResult {
  if (typeof options.javascript !== 'string')
    throw new TypeError('JavaScript source must be a string.');
  validateArchivePath(options.sourcePath, 'JavaScript source path');
  const baseUrl = validateNetworkUrl(options.baseUrl, 'JavaScript base URL');
  const savedResources = buildSavedResourceLookup(options.savedResourceMappings);
  const program = parseJavascript(options.javascript);
  if (!program) {
    return { javascript: options.javascript, rewrittenCount: 0, parseError: true, rewrites: [] };
  }

  const replacements: Replacement[] = [];
  const occupiedOffsets = new Set<number>();
  visit(program, (node) => {
    const candidate = candidateLiteral(node);
    if (!candidate || occupiedOffsets.has(candidate.node.start)) return;
    let resolved: URL;
    try {
      resolved = new URL(candidate.value, baseUrl);
    } catch {
      return;
    }
    const normalizedUrl = normalizeResourceUrl(resolved.href);
    if (!normalizedUrl) return;
    const mapping = savedResources.get(normalizedUrl);
    if (!mapping) return;
    const localReference = createLocalArchiveReference(
      options.sourcePath,
      mapping.relativePath,
      resolved.hash,
    );
    replacements.push({
      start: candidate.node.start,
      end: candidate.node.end,
      value: JSON.stringify(localReference),
      originalUrl: candidate.value,
      normalizedUrl,
      targetPath: mapping.relativePath,
    });
    occupiedOffsets.add(candidate.node.start);
  });

  let javascript = options.javascript;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    javascript =
      javascript.slice(0, replacement.start) +
      replacement.value +
      javascript.slice(replacement.end);
  }
  return {
    javascript,
    rewrittenCount: replacements.length,
    parseError: false,
    rewrites: replacements
      .sort((left, right) => left.start - right.start)
      .map((replacement) => ({
        originalUrl: replacement.originalUrl,
        normalizedUrl: replacement.normalizedUrl,
        targetPath: replacement.targetPath,
        rewrittenValue: JSON.parse(replacement.value) as string,
      })),
  };
}
