import {
  CAPTURE_ERROR_CODES,
  RESOURCE_STATES,
  isCaptureError,
  type CaptureErrorCode,
  type ResourceRecord,
  type ResourceState,
} from '@sitecapsule/domain';
import { normalizeResourceUrl } from '@sitecapsule/page';

import type { CssReferenceResult, CssRewriteResult } from './css-rewriter';
import type {
  HtmlCssRewriteResult,
  HtmlReferenceResult,
  HtmlRewriteResult,
  HtmlSrcsetRewriteResult,
} from './html-rewriter';
import type { SrcsetReferenceResult, SrcsetRewriteResult } from './srcset-rewriter';
import { isNetworkProtocol } from './rewrite-support';

export const UNCAPTURED_DEPENDENCY_CHANNELS = ['html-attribute', 'css-ast', 'srcset'] as const;
export const UNCAPTURED_DEPENDENCY_REASONS = [
  'download-failed',
  'resource-skipped',
  'missing-mapping',
] as const;

export type UncapturedDependencyChannel = (typeof UNCAPTURED_DEPENDENCY_CHANNELS)[number];
export type UncapturedDependencyReason = (typeof UNCAPTURED_DEPENDENCY_REASONS)[number];

export type HtmlDependencySource = {
  channel: 'html-attribute';
  sourcePath: string;
  referenceOrdinal: number;
  elementOrdinal: number;
  tagName: string;
  attributeName: string;
  originalValue: string;
};

export type CssDependencySource = {
  channel: 'css-ast';
  sourcePath: string;
  referenceOrdinal: number;
  context: CssRewriteResult['context'];
  kind: CssReferenceResult['kind'];
  propertyName: string | null;
  originalValue: string;
  hostElementOrdinal: number | null;
  hostTagName: string | null;
  hostAttributeName: string | null;
};

export type SrcsetDependencySource = {
  channel: 'srcset';
  sourcePath: string;
  candidateOrdinal: number;
  descriptor: string | null;
  originalValue: string;
  hostElementOrdinal: number | null;
  hostTagName: string | null;
};

export type UncapturedDependencySource =
  HtmlDependencySource | CssDependencySource | SrcsetDependencySource;

export type UncapturedDependency = {
  normalizedUrl: string;
  reason: UncapturedDependencyReason;
  occurrenceCount: number;
  channels: UncapturedDependencyChannel[];
  resourceStates: ResourceState[];
  errorCodes: CaptureErrorCode[];
  sources: UncapturedDependencySource[];
};

export type RetainedReferenceCounts = {
  data: number;
  blob: number;
  fragment: number;
  unsupportedProtocol: number;
  invalid: number;
  cssParseError: number;
};

export type UncapturedDependencyReport = {
  dependencies: UncapturedDependency[];
  uniqueOnlineDependencies: number;
  onlineOccurrences: number;
  retainedReferences: RetainedReferenceCounts;
};

export type CollectUncapturedDependenciesOptions = {
  htmlResults?: readonly HtmlRewriteResult[];
  cssResults?: readonly CssRewriteResult[];
  srcsetResults?: readonly SrcsetRewriteResult[];
  resourceRecords?: readonly ResourceRecord[];
};

type PendingDependency = {
  normalizedUrl: string;
  sources: UncapturedDependencySource[];
};

type ResourceOutcome = {
  states: Set<ResourceState>;
  errorCodes: Set<CaptureErrorCode>;
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceSortKey(source: UncapturedDependencySource): string {
  if (source.channel === 'html-attribute') {
    return [
      '0',
      source.sourcePath,
      String(source.elementOrdinal).padStart(12, '0'),
      String(source.referenceOrdinal).padStart(12, '0'),
      source.tagName,
      source.attributeName,
      source.originalValue,
    ].join('\0');
  }
  if (source.channel === 'css-ast') {
    return [
      '1',
      source.sourcePath,
      String(source.hostElementOrdinal ?? 0).padStart(12, '0'),
      String(source.referenceOrdinal).padStart(12, '0'),
      source.kind,
      source.propertyName ?? '',
      source.originalValue,
    ].join('\0');
  }
  return [
    '2',
    source.sourcePath,
    String(source.hostElementOrdinal ?? 0).padStart(12, '0'),
    String(source.candidateOrdinal).padStart(12, '0'),
    source.descriptor ?? '',
    source.originalValue,
  ].join('\0');
}

function normalizeNetworkUrl(value: string): string | null {
  const normalized = normalizeResourceUrl(value);
  if (normalized === null) return null;
  const url = new URL(normalized);
  return isNetworkProtocol(url.protocol) ? normalized : null;
}

function observeRetainedReference(
  reference: HtmlReferenceResult | CssReferenceResult | SrcsetReferenceResult,
  counts: RetainedReferenceCounts,
): void {
  if (reference.status === 'fragment') {
    counts.fragment += 1;
    return;
  }
  if (reference.status === 'invalid') {
    counts.invalid += 1;
    return;
  }
  if (reference.status !== 'unsupported') return;

  if (reference.protocol === 'data:') counts.data += 1;
  else if (reference.protocol === 'blob:') counts.blob += 1;
  else counts.unsupportedProtocol += 1;
}

function addDependency(
  pending: Map<string, PendingDependency>,
  reference: Extract<
    HtmlReferenceResult | CssReferenceResult | SrcsetReferenceResult,
    { status: 'unmapped' }
  >,
  source: UncapturedDependencySource,
): void {
  const normalizedUrl = normalizeNetworkUrl(reference.normalizedUrl);
  if (normalizedUrl === null || normalizedUrl !== reference.normalizedUrl) {
    throw new TypeError('Unmapped dependency URL must be a normalized HTTP or HTTPS URL.');
  }
  const existing = pending.get(normalizedUrl);
  if (existing) existing.sources.push(source);
  else pending.set(normalizedUrl, { normalizedUrl, sources: [source] });
}

function collectCssResult(
  result: CssRewriteResult,
  pending: Map<string, PendingDependency>,
  counts: RetainedReferenceCounts,
  host: HtmlCssRewriteResult | null,
): void {
  if (result.parseError) counts.cssParseError += 1;
  for (const reference of result.references) {
    observeRetainedReference(reference, counts);
    if (reference.status !== 'unmapped') continue;
    addDependency(pending, reference, {
      channel: 'css-ast',
      sourcePath: result.sourcePath,
      referenceOrdinal: reference.ordinal,
      context: result.context,
      kind: reference.kind,
      propertyName: reference.propertyName,
      originalValue: reference.originalValue,
      hostElementOrdinal: host?.elementOrdinal ?? null,
      hostTagName: host?.tagName ?? null,
      hostAttributeName: host?.attributeName ?? null,
    });
  }
}

function collectSrcsetResult(
  result: SrcsetRewriteResult,
  pending: Map<string, PendingDependency>,
  counts: RetainedReferenceCounts,
  host: HtmlSrcsetRewriteResult | null,
): void {
  for (const reference of result.references) {
    observeRetainedReference(reference, counts);
    if (reference.status !== 'unmapped') continue;
    addDependency(pending, reference, {
      channel: 'srcset',
      sourcePath: result.sourcePath,
      candidateOrdinal: reference.candidateOrdinal,
      descriptor: reference.descriptor,
      originalValue: reference.originalValue,
      hostElementOrdinal: host?.elementOrdinal ?? null,
      hostTagName: host?.tagName ?? null,
    });
  }
}

function collectHtmlResult(
  result: HtmlRewriteResult,
  pending: Map<string, PendingDependency>,
  counts: RetainedReferenceCounts,
): void {
  for (const [index, reference] of result.references.entries()) {
    observeRetainedReference(reference, counts);
    if (reference.status !== 'unmapped') continue;
    addDependency(pending, reference, {
      channel: 'html-attribute',
      sourcePath: result.documentPath,
      referenceOrdinal: index + 1,
      elementOrdinal: reference.elementOrdinal,
      tagName: reference.tagName,
      attributeName: reference.attributeName,
      originalValue: reference.originalValue,
    });
  }
  for (const css of result.cssRewrites) {
    collectCssResult(css.result, pending, counts, css);
  }
  for (const srcset of result.srcsetRewrites) {
    collectSrcsetResult(srcset.result, pending, counts, srcset);
  }
}

function collectResourceOutcomes(records: readonly ResourceRecord[]): Map<string, ResourceOutcome> {
  const outcomes = new Map<string, ResourceOutcome>();
  for (const record of records) {
    if (!record || typeof record !== 'object') {
      throw new TypeError('Resource record must be an object.');
    }
    if (!RESOURCE_STATES.includes(record.state)) {
      throw new TypeError('Resource record state is not supported.');
    }
    if (typeof record.originalUrl !== 'string' || record.originalUrl.trim() === '') {
      throw new TypeError('Resource record original URL must be a non-empty string.');
    }
    if (
      record.finalUrl !== undefined &&
      (typeof record.finalUrl !== 'string' || record.finalUrl.trim() === '')
    ) {
      throw new TypeError('Resource record final URL must be a non-empty string when supplied.');
    }
    if (record.error !== undefined && !isCaptureError(record.error)) {
      throw new TypeError('Resource record error is invalid.');
    }
    const errorCode = record.error?.code;

    const urls = [record.originalUrl, ...(record.finalUrl ? [record.finalUrl] : [])];
    for (const value of urls) {
      const normalizedUrl = normalizeNetworkUrl(value);
      if (normalizedUrl === null) continue;
      const outcome = outcomes.get(normalizedUrl) ?? {
        states: new Set<ResourceState>(),
        errorCodes: new Set<CaptureErrorCode>(),
      };
      outcome.states.add(record.state);
      if (errorCode !== undefined) outcome.errorCodes.add(errorCode);
      outcomes.set(normalizedUrl, outcome);
    }
  }
  return outcomes;
}

function dependencyReason(outcome: ResourceOutcome | undefined): UncapturedDependencyReason {
  if (outcome?.states.has('failed')) return 'download-failed';
  if (outcome?.states.has('skipped')) return 'resource-skipped';
  return 'missing-mapping';
}

function channelsFromSources(
  sources: readonly UncapturedDependencySource[],
): UncapturedDependencyChannel[] {
  const present = new Set(sources.map((source) => source.channel));
  return UNCAPTURED_DEPENDENCY_CHANNELS.filter((channel) => present.has(channel));
}

export function collectUncapturedDependencies(
  options: CollectUncapturedDependenciesOptions,
): UncapturedDependencyReport {
  if (!options || typeof options !== 'object') {
    throw new TypeError('Uncaptured dependency options are required.');
  }
  if (
    (options.htmlResults !== undefined && !Array.isArray(options.htmlResults)) ||
    (options.cssResults !== undefined && !Array.isArray(options.cssResults)) ||
    (options.srcsetResults !== undefined && !Array.isArray(options.srcsetResults)) ||
    (options.resourceRecords !== undefined && !Array.isArray(options.resourceRecords))
  ) {
    throw new TypeError('Uncaptured dependency inputs must be arrays.');
  }
  const htmlResults = options.htmlResults ?? [];
  const cssResults = options.cssResults ?? [];
  const srcsetResults = options.srcsetResults ?? [];
  const resourceRecords = options.resourceRecords ?? [];

  const pending = new Map<string, PendingDependency>();
  const retainedReferences: RetainedReferenceCounts = {
    data: 0,
    blob: 0,
    fragment: 0,
    unsupportedProtocol: 0,
    invalid: 0,
    cssParseError: 0,
  };
  for (const result of htmlResults) collectHtmlResult(result, pending, retainedReferences);
  for (const result of cssResults) {
    collectCssResult(result, pending, retainedReferences, null);
  }
  for (const result of srcsetResults) {
    collectSrcsetResult(result, pending, retainedReferences, null);
  }

  const outcomes = collectResourceOutcomes(resourceRecords);
  const dependencies = [...pending.values()]
    .sort((left, right) => compareText(left.normalizedUrl, right.normalizedUrl))
    .map((dependency): UncapturedDependency => {
      const sources = [...dependency.sources].sort((left, right) =>
        compareText(sourceSortKey(left), sourceSortKey(right)),
      );
      const outcome = outcomes.get(dependency.normalizedUrl);
      return {
        normalizedUrl: dependency.normalizedUrl,
        reason: dependencyReason(outcome),
        occurrenceCount: sources.length,
        channels: channelsFromSources(sources),
        resourceStates: RESOURCE_STATES.filter((state) => outcome?.states.has(state)),
        errorCodes: CAPTURE_ERROR_CODES.filter((code) => outcome?.errorCodes.has(code)),
        sources,
      };
    });

  return {
    dependencies,
    uniqueOnlineDependencies: dependencies.length,
    onlineOccurrences: dependencies.reduce(
      (total, dependency) => total + dependency.occurrenceCount,
      0,
    ),
    retainedReferences,
  };
}
