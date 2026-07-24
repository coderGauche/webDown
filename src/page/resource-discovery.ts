import {
  isCssResourceCandidate,
  isDomResourceCandidate,
  isSvgResourceCandidate,
  type CssResourceCandidate,
  type DomResourceCandidate,
  type SvgResourceCandidate,
} from '@sitecapsule/discovery';
import type { ResourceDiscoverySource } from '@sitecapsule/domain';

import {
  PERFORMANCE_RESOURCE_INITIATORS,
  type PerformanceResourceRecord,
} from './performance-resources';
import { isNormalizedResourceUrl, normalizeResourceUrl } from './resource-url';

export const MERGED_RESOURCE_DISCOVERY_SOURCES = [
  'dom',
  'css',
  'performance',
] as const satisfies readonly ResourceDiscoverySource[];
export const RESOURCE_DISCOVERY_CHANNELS = [
  'dom-attribute',
  'svg-attribute',
  'css-ast',
  'performance',
] as const;

export type MergedResourceDiscoverySource = (typeof MERGED_RESOURCE_DISCOVERY_SOURCES)[number];
export type ResourceDiscoveryChannel = (typeof RESOURCE_DISCOVERY_CHANNELS)[number];

export type DomResourceEvidence = {
  source: 'dom';
  channel: 'dom-attribute';
  sourceOrdinal: number;
  candidate: DomResourceCandidate;
};

export type SvgResourceEvidence = {
  source: 'dom';
  channel: 'svg-attribute';
  sourceOrdinal: number;
  candidate: SvgResourceCandidate;
};

export type CssResourceEvidence = {
  source: 'css';
  channel: 'css-ast';
  sourceOrdinal: number;
  candidate: CssResourceCandidate;
};

export type PerformanceResourceEvidence = {
  source: 'performance';
  channel: 'performance';
  sourceOrdinal: number;
  candidate: PerformanceResourceRecord;
};

export type ResourceDiscoveryEvidence =
  DomResourceEvidence | SvgResourceEvidence | CssResourceEvidence | PerformanceResourceEvidence;

export type MergedResourceCandidate = {
  ordinal: number;
  url: string;
  discoverySources: MergedResourceDiscoverySource[];
  evidence: ResourceDiscoveryEvidence[];
};

export type MergeResourceCandidatesInput = {
  domResources: readonly DomResourceCandidate[];
  svgResources: readonly SvgResourceCandidate[];
  cssResources: readonly CssResourceCandidate[];
  performanceResources: readonly PerformanceResourceRecord[];
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

function isCanonicalAbsoluteUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    return new URL(value).href === value;
  } catch {
    return false;
  }
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPerformanceResourceRecord(value: unknown): value is PerformanceResourceRecord {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'url',
      'initiatorType',
      'startTimeMs',
      'durationMs',
      'transferSize',
      'encodedBodySize',
      'decodedBodySize',
    ]) &&
    isCanonicalAbsoluteUrl(value.url) &&
    PERFORMANCE_RESOURCE_INITIATORS.includes(
      value.initiatorType as PerformanceResourceRecord['initiatorType'],
    ) &&
    isNonNegativeFiniteNumber(value.startTimeMs) &&
    isNonNegativeFiniteNumber(value.durationMs) &&
    isNonNegativeSafeInteger(value.transferSize) &&
    isNonNegativeSafeInteger(value.encodedBodySize) &&
    isNonNegativeSafeInteger(value.decodedBodySize)
  );
}

function evidenceUrl(evidence: ResourceDiscoveryEvidence): string {
  return evidence.source === 'performance'
    ? evidence.candidate.url
    : evidence.candidate.resolvedUrl;
}

export function isResourceDiscoveryEvidence(value: unknown): value is ResourceDiscoveryEvidence {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['source', 'channel', 'sourceOrdinal', 'candidate']) ||
    !isPositiveSafeInteger(value.sourceOrdinal)
  ) {
    return false;
  }

  if (value.source === 'dom' && value.channel === 'dom-attribute') {
    return isDomResourceCandidate(value.candidate);
  }
  if (value.source === 'dom' && value.channel === 'svg-attribute') {
    return (
      isSvgResourceCandidate(value.candidate) && value.sourceOrdinal === value.candidate.ordinal
    );
  }
  if (value.source === 'css' && value.channel === 'css-ast') {
    return (
      isCssResourceCandidate(value.candidate) && value.sourceOrdinal === value.candidate.ordinal
    );
  }
  return (
    value.source === 'performance' &&
    value.channel === 'performance' &&
    isPerformanceResourceRecord(value.candidate)
  );
}

export function isMergedResourceCandidate(value: unknown): value is MergedResourceCandidate {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['ordinal', 'url', 'discoverySources', 'evidence']) ||
    !isPositiveSafeInteger(value.ordinal) ||
    !isNormalizedResourceUrl(value.url) ||
    !Array.isArray(value.evidence) ||
    value.evidence.length === 0 ||
    !value.evidence.every(isResourceDiscoveryEvidence) ||
    !Array.isArray(value.discoverySources)
  ) {
    return false;
  }

  const evidence = value.evidence as ResourceDiscoveryEvidence[];
  if (!evidence.every((item) => normalizeResourceUrl(evidenceUrl(item)) === value.url))
    return false;
  const evidenceKeys = evidence.map((item) => `${item.channel}:${item.sourceOrdinal}`);
  if (new Set(evidenceKeys).size !== evidenceKeys.length) return false;

  const expectedSources = Array.from(new Set(evidence.map((item) => item.source)));
  return (
    value.discoverySources.length === expectedSources.length &&
    value.discoverySources.every((source, index) => source === expectedSources[index])
  );
}

export function isMergedResourceCandidates(value: unknown): value is MergedResourceCandidate[] {
  if (!Array.isArray(value) || !value.every(isMergedResourceCandidate)) return false;
  const urls = value.map((resource) => resource.url);
  return (
    new Set(urls).size === urls.length &&
    value.every((resource, index) => resource.ordinal === index + 1)
  );
}

export function matchesMergedResourceCandidates(
  value: unknown,
  input: MergeResourceCandidatesInput,
): value is MergedResourceCandidate[] {
  return (
    isMergedResourceCandidates(value) &&
    JSON.stringify(value) === JSON.stringify(mergeResourceCandidates(input))
  );
}

export function mergeResourceCandidates({
  domResources,
  svgResources,
  cssResources,
  performanceResources,
}: MergeResourceCandidatesInput): MergedResourceCandidate[] {
  const mergedByUrl = new Map<string, MergedResourceCandidate>();

  const addEvidence = (observedUrl: string, evidence: ResourceDiscoveryEvidence) => {
    const url = normalizeResourceUrl(observedUrl);
    if (!url) return;
    let merged = mergedByUrl.get(url);
    if (!merged) {
      merged = {
        ordinal: mergedByUrl.size + 1,
        url,
        discoverySources: [],
        evidence: [],
      };
      mergedByUrl.set(url, merged);
    }
    if (!merged.discoverySources.includes(evidence.source)) {
      merged.discoverySources.push(evidence.source);
    }
    merged.evidence.push(evidence);
  };

  domResources.forEach((candidate, index) => {
    addEvidence(candidate.resolvedUrl, {
      source: 'dom',
      channel: 'dom-attribute',
      sourceOrdinal: index + 1,
      candidate,
    });
  });
  svgResources.forEach((candidate) => {
    addEvidence(candidate.resolvedUrl, {
      source: 'dom',
      channel: 'svg-attribute',
      sourceOrdinal: candidate.ordinal,
      candidate,
    });
  });
  cssResources.forEach((candidate) => {
    addEvidence(candidate.resolvedUrl, {
      source: 'css',
      channel: 'css-ast',
      sourceOrdinal: candidate.ordinal,
      candidate,
    });
  });
  performanceResources.forEach((candidate, index) => {
    addEvidence(candidate.url, {
      source: 'performance',
      channel: 'performance',
      sourceOrdinal: index + 1,
      candidate,
    });
  });

  return Array.from(mergedByUrl.values());
}
