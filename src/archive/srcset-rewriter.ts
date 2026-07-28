import { parseSrcsetCandidateSegments } from '@sitecapsule/discovery';
import { normalizeResourceUrl } from '@sitecapsule/page';

import type { ResourcePathMapping } from './resource-path-mapping';
import {
  buildSavedResourceLookup,
  createLocalArchiveReference,
  isNetworkProtocol,
  validateArchivePath,
  validateNetworkUrl,
} from './rewrite-support';

type SrcsetReferenceCommon = {
  candidateOrdinal: number;
  originalValue: string;
  descriptor: string | null;
};

export type SrcsetReferenceResult =
  | (SrcsetReferenceCommon & {
      status: 'rewritten';
      resolvedUrl: string;
      normalizedUrl: string;
      targetPath: string;
      rewrittenValue: string;
    })
  | (SrcsetReferenceCommon & {
      status: 'unmapped';
      resolvedUrl: string;
      normalizedUrl: string;
    })
  | (SrcsetReferenceCommon & {
      status: 'unsupported';
      resolvedUrl: string;
      protocol: string;
    })
  | (SrcsetReferenceCommon & {
      status: 'fragment';
    })
  | (SrcsetReferenceCommon & {
      status: 'invalid';
    });

export type SrcsetRewriteResult = {
  srcset: string;
  sourcePath: string;
  rewrittenCount: number;
  references: SrcsetReferenceResult[];
};

export type RewriteSrcsetResourceOptions = {
  srcset: string;
  baseUrl: string;
  sourcePath: string;
  savedResourceMappings: readonly ResourcePathMapping[];
};

type Replacement = {
  start: number;
  end: number;
  value: string;
};

function applyReplacements(source: string, replacements: readonly Replacement[]): string {
  let result = '';
  let position = 0;
  for (const replacement of replacements) {
    result += source.slice(position, replacement.start);
    result += replacement.value;
    position = replacement.end;
  }
  return result + source.slice(position);
}

function isValidDescriptor(descriptor: string | undefined): boolean {
  if (descriptor === undefined) return true;
  if (/^\d+w$/.test(descriptor)) {
    const width = Number(descriptor.slice(0, -1));
    return Number.isSafeInteger(width) && width > 0;
  }
  if (/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?x$/i.test(descriptor)) {
    const density = Number(descriptor.slice(0, -1));
    return Number.isFinite(density) && density > 0;
  }
  return false;
}

export function rewriteSrcsetResource(options: RewriteSrcsetResourceOptions): SrcsetRewriteResult {
  if (!options || typeof options !== 'object') {
    throw new TypeError('Srcset rewrite options are required.');
  }
  if (typeof options.srcset !== 'string') throw new TypeError('Srcset source must be a string.');

  const baseUrl = validateNetworkUrl(options.baseUrl, 'Srcset base URL');
  validateArchivePath(options.sourcePath, 'Srcset source path');
  const savedResources = buildSavedResourceLookup(options.savedResourceMappings);
  const references: SrcsetReferenceResult[] = [];
  const replacements: Replacement[] = [];

  for (const [index, candidate] of parseSrcsetCandidateSegments(options.srcset).entries()) {
    const common: SrcsetReferenceCommon = {
      candidateOrdinal: index + 1,
      originalValue: candidate.rawUrl,
      descriptor: candidate.descriptor ?? null,
    };
    if (!isValidDescriptor(candidate.descriptor)) {
      references.push({ ...common, status: 'invalid' });
      continue;
    }
    if (candidate.rawUrl.startsWith('#')) {
      references.push({ ...common, status: 'fragment' });
      continue;
    }

    let resolved: URL;
    try {
      resolved = new URL(candidate.rawUrl, baseUrl);
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
      options.sourcePath,
      mapping.relativePath,
      fragment,
    );
    replacements.push({
      start: candidate.urlStart,
      end: candidate.urlEnd,
      value: rewrittenValue,
    });
    references.push({
      ...common,
      status: 'rewritten',
      resolvedUrl: resolved.href,
      normalizedUrl,
      targetPath: mapping.relativePath,
      rewrittenValue,
    });
  }

  return {
    srcset:
      replacements.length === 0 ? options.srcset : applyReplacements(options.srcset, replacements),
    sourcePath: options.sourcePath,
    rewrittenCount: replacements.length,
    references,
  };
}
