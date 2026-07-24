export const PERFORMANCE_RESOURCE_INITIATORS = [
  'audio',
  'beacon',
  'body',
  'css',
  'early-hint',
  'embed',
  'fetch',
  'frame',
  'iframe',
  'image',
  'img',
  'input',
  'link',
  'navigation',
  'object',
  'ping',
  'script',
  'track',
  'video',
  'xmlhttprequest',
  'other',
] as const;

export type PerformanceResourceInitiator = (typeof PERFORMANCE_RESOURCE_INITIATORS)[number];

export type PerformanceResourceRecord = {
  url: string;
  initiatorType: PerformanceResourceInitiator;
  startTimeMs: number;
  durationMs: number;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
};

export type PerformanceResourceSource = Pick<Performance, 'getEntriesByType'>;

type ResourceTimingCandidate = Pick<
  PerformanceResourceTiming,
  | 'name'
  | 'entryType'
  | 'initiatorType'
  | 'startTime'
  | 'duration'
  | 'transferSize'
  | 'encodedBodySize'
  | 'decodedBodySize'
>;

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function normalizeResourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function normalizeInitiatorType(value: unknown): PerformanceResourceInitiator {
  if (typeof value !== 'string') return 'other';

  const normalized = value.trim().toLowerCase();
  return PERFORMANCE_RESOURCE_INITIATORS.includes(normalized as PerformanceResourceInitiator)
    ? (normalized as PerformanceResourceInitiator)
    : 'other';
}

function normalizeCandidate(entry: PerformanceEntry): PerformanceResourceRecord | null {
  const candidate = entry as unknown as ResourceTimingCandidate;
  if (candidate.entryType !== 'resource') return null;

  const url = normalizeResourceUrl(candidate.name);
  if (!url) return null;
  if (
    !isNonNegativeFiniteNumber(candidate.startTime) ||
    !isNonNegativeFiniteNumber(candidate.duration) ||
    !isNonNegativeSafeInteger(candidate.transferSize) ||
    !isNonNegativeSafeInteger(candidate.encodedBodySize) ||
    !isNonNegativeSafeInteger(candidate.decodedBodySize)
  ) {
    return null;
  }

  return {
    url,
    initiatorType: normalizeInitiatorType(candidate.initiatorType),
    startTimeMs: candidate.startTime,
    durationMs: candidate.duration,
    transferSize: candidate.transferSize,
    encodedBodySize: candidate.encodedBodySize,
    decodedBodySize: candidate.decodedBodySize,
  };
}

export function collectPerformanceResources(
  source: PerformanceResourceSource | null,
): PerformanceResourceRecord[] {
  if (!source) return [];

  let entries: PerformanceEntry[];
  try {
    entries = source.getEntriesByType('resource');
  } catch {
    return [];
  }

  const normalized = entries
    .map(normalizeCandidate)
    .filter((entry): entry is PerformanceResourceRecord => entry !== null)
    .sort(
      (left, right) =>
        left.startTimeMs - right.startTimeMs ||
        left.url.localeCompare(right.url) ||
        left.initiatorType.localeCompare(right.initiatorType),
    );
  const unique = new Map<string, PerformanceResourceRecord>();

  for (const resource of normalized) {
    if (!unique.has(resource.url)) unique.set(resource.url, resource);
  }

  return Array.from(unique.values());
}
