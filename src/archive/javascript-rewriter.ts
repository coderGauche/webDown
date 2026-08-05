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

type RewriteRecord = {
  originalUrl: string;
  normalizedUrl: string;
  targetPath: string;
  rewrittenValue: string;
};

type Replacement = {
  start: number;
  end: number;
  value: string;
  rewrites: RewriteRecord[];
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
  documentPath?: string;
  savedResourceMappings: readonly ResourcePathMapping[];
};

export type JavascriptResourceReference = {
  originalValue: string;
  normalizedUrl: string;
};

export type JavascriptResourceDiscoveryResult = {
  references: JavascriptResourceReference[];
  parseError: boolean;
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

function isJsonParseCall(node: AstNode): boolean {
  if (node.type !== 'CallExpression' || !isAstNode(node.callee)) return false;
  const callee = node.callee;
  return (
    callee.type === 'MemberExpression' &&
    identifierName(callee.object) === 'JSON' &&
    identifierName(callee.property) === 'parse'
  );
}

function literalString(value: unknown): { node: AstNode; value: string } | null {
  if (!isAstNode(value)) return null;
  if (value.type === 'Literal' && typeof value.value === 'string') {
    return { node: value, value: value.value };
  }
  if (value.type !== 'TemplateLiteral') return null;
  const expressions = Array.isArray(value.expressions) ? value.expressions : [];
  const quasis = Array.isArray(value.quasis) ? value.quasis : [];
  if (expressions.length > 0 || quasis.length !== 1 || !isAstNode(quasis[0])) return null;
  const cooked = (quasis[0].value as { cooked?: unknown } | undefined)?.cooked;
  return typeof cooked === 'string' ? { node: value, value: cooked } : null;
}

function isGeneratedResourceReference(value: string): boolean {
  const hasSupportedPrefix =
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('/') ||
    value.startsWith('https://') ||
    value.startsWith('http://');
  if (!hasSupportedPrefix) return false;
  try {
    const pathname = new URL(value, 'https://archive.invalid/').pathname;
    return /\.[a-z0-9]{1,12}$/i.test(pathname);
  } catch {
    return false;
  }
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

  // Bundlers such as Vite/Rolldown keep lazy chunk and asset references in
  // generated string tables before passing them to import(). Rewrite only
  // exact saved-resource matches, so ordinary application strings stay intact.
  const generatedReference = literalString(node);
  return generatedReference && isGeneratedResourceReference(generatedReference.value)
    ? generatedReference
    : null;
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

function visitJsonStrings(value: unknown, visitor: (value: string) => string): unknown {
  if (typeof value === 'string') return visitor(value);
  if (Array.isArray(value)) return value.map((item) => visitJsonStrings(item, visitor));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, visitJsonStrings(item, visitor)]),
  );
}

function parseEmbeddedJson(node: AstNode): { node: AstNode; value: unknown } | null {
  if (!isJsonParseCall(node)) return null;
  const args = Array.isArray(node.arguments) ? node.arguments : [];
  const literal = literalString(args[0]);
  if (!literal) return null;
  try {
    return { node: literal.node, value: JSON.parse(literal.value) as unknown };
  } catch {
    return null;
  }
}

function resolveNormalizedReference(value: string, baseUrl: URL): string | null {
  try {
    return normalizeResourceUrl(new URL(value, baseUrl).href);
  } catch {
    return null;
  }
}

function createJavascriptArchiveReference(
  sourcePath: string,
  targetPath: string,
  fragment: string,
): string {
  const reference = createLocalArchiveReference(sourcePath, targetPath, fragment);
  return reference.startsWith('../') || reference.startsWith('./') ? reference : `./${reference}`;
}

export function discoverJavascriptResourceReferences(
  javascript: string,
  baseUrl: string,
): JavascriptResourceDiscoveryResult {
  if (typeof javascript !== 'string') throw new TypeError('JavaScript source must be a string.');
  const validatedBaseUrl = new URL(validateNetworkUrl(baseUrl, 'JavaScript base URL'));
  const program = parseJavascript(javascript);
  if (!program) return { references: [], parseError: true };

  const references = new Map<string, JavascriptResourceReference>();
  const addReference = (value: string) => {
    const normalizedUrl = resolveNormalizedReference(value, validatedBaseUrl);
    if (!normalizedUrl || references.has(normalizedUrl)) return;
    references.set(normalizedUrl, { originalValue: value, normalizedUrl });
  };
  visit(program, (node) => {
    const embeddedJson = parseEmbeddedJson(node);
    if (embeddedJson) {
      visitJsonStrings(embeddedJson.value, (value) => {
        if (isGeneratedResourceReference(value)) addReference(value);
        return value;
      });
    }
    const candidate = candidateLiteral(node);
    if (candidate) addReference(candidate.value);
  });
  return { references: [...references.values()], parseError: false };
}

export function rewriteJavascriptResource(
  options: RewriteJavascriptResourceOptions,
): JavascriptRewriteResult {
  if (typeof options.javascript !== 'string')
    throw new TypeError('JavaScript source must be a string.');
  validateArchivePath(options.sourcePath, 'JavaScript source path');
  const documentPath = options.documentPath ?? 'index.html';
  validateArchivePath(documentPath, 'JavaScript runtime document path');
  const baseUrl = validateNetworkUrl(options.baseUrl, 'JavaScript base URL');
  const savedResources = buildSavedResourceLookup(options.savedResourceMappings);
  const program = parseJavascript(options.javascript);
  if (!program) {
    return { javascript: options.javascript, rewrittenCount: 0, parseError: true, rewrites: [] };
  }

  const replacements: Replacement[] = [];
  const occupiedOffsets = new Set<number>();
  visit(program, (node) => {
    const embeddedJson = parseEmbeddedJson(node);
    if (embeddedJson && !occupiedOffsets.has(embeddedJson.node.start)) {
      const rewrites: RewriteRecord[] = [];
      const rewrittenJson = visitJsonStrings(embeddedJson.value, (value) => {
        if (!isGeneratedResourceReference(value)) return value;
        let resolved: URL;
        try {
          resolved = new URL(value, baseUrl);
        } catch {
          return value;
        }
        const normalizedUrl = normalizeResourceUrl(resolved.href);
        if (!normalizedUrl) return value;
        const mapping = savedResources.get(normalizedUrl);
        if (!mapping) return value;
        const rewrittenValue = createJavascriptArchiveReference(
          documentPath,
          mapping.relativePath,
          resolved.hash,
        );
        rewrites.push({
          originalUrl: value,
          normalizedUrl,
          targetPath: mapping.relativePath,
          rewrittenValue,
        });
        return rewrittenValue;
      });
      if (rewrites.length > 0) {
        replacements.push({
          start: embeddedJson.node.start,
          end: embeddedJson.node.end,
          value: JSON.stringify(JSON.stringify(rewrittenJson)),
          rewrites,
        });
        occupiedOffsets.add(embeddedJson.node.start);
      }
    }

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
    const localReference = createJavascriptArchiveReference(
      options.sourcePath,
      mapping.relativePath,
      resolved.hash,
    );
    replacements.push({
      start: candidate.node.start,
      end: candidate.node.end,
      value: JSON.stringify(localReference),
      rewrites: [
        {
          originalUrl: candidate.value,
          normalizedUrl,
          targetPath: mapping.relativePath,
          rewrittenValue: localReference,
        },
      ],
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
    rewrittenCount: replacements.reduce(
      (total, replacement) => total + replacement.rewrites.length,
      0,
    ),
    parseError: false,
    rewrites: replacements
      .sort((left, right) => left.start - right.start)
      .flatMap((replacement) => replacement.rewrites),
  };
}
