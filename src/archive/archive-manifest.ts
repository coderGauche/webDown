import {
  CAPTURE_MODES,
  CAPTURE_PROFILES,
  type CaptureMode,
  type CaptureProfile,
} from '@sitecapsule/domain';

import { ARCHIVE_METADATA_PATHS } from './archive-layout';
import type { ZipArchiveEntry } from './zip-codec';

export const ARCHIVE_MANIFEST_FORMAT_VERSION = 1;
export const ARCHIVE_MANIFEST_PRODUCT = 'SiteCapsule';
export const ARCHIVE_MANIFEST_REDACTED_VALUE = 'REDACTED';

export interface ArchiveManifestInput {
  capturedAt: string;
  startUrl: string;
  finalUrl: string;
  mode: CaptureMode;
  captureProfile: CaptureProfile;
  pages: number;
  resources: number;
  failedResources: number;
  requiresLocalHttpServer: boolean;
  onlineDependencies: readonly string[];
}

export interface ArchiveManifest {
  formatVersion: typeof ARCHIVE_MANIFEST_FORMAT_VERSION;
  product: typeof ARCHIVE_MANIFEST_PRODUCT;
  capturedAt: string;
  startUrl: string;
  finalUrl: string;
  mode: CaptureMode;
  captureProfile: CaptureProfile;
  pages: number;
  resources: number;
  failedResources: number;
  requiresLocalHttpServer: boolean;
  onlineDependencies: string[];
}

const INPUT_KEYS = [
  'capturedAt',
  'startUrl',
  'finalUrl',
  'mode',
  'captureProfile',
  'pages',
  'resources',
  'failedResources',
  'requiresLocalHttpServer',
  'onlineDependencies',
] as const satisfies readonly (keyof ArchiveManifestInput)[];

const SENSITIVE_QUERY_PARAMETER =
  /(?:^|[-_.])(?:access[-_.]?token|refresh[-_.]?token|id[-_.]?token|token|jwt|auth|authorization|api[-_.]?key|apikey|secret|client[-_.]?secret|password|passwd|pwd|session|session[-_.]?id|sid|signature|sig|credential|code)(?:$|[-_.])/i;

const UTF8_ENCODER = new TextEncoder();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactInputKeys(value: Record<string, unknown>): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === INPUT_KEYS.length &&
    INPUT_KEYS.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || !Number.isFinite(Date.parse(value))) {
    throw new TypeError('Archive capturedAt must be a valid timestamp string.');
  }
  const normalized = new Date(value).toISOString();
  if (normalized !== value) {
    throw new TypeError('Archive capturedAt must use canonical ISO 8601 UTC format.');
  }
  return normalized;
}

function hasSensitiveFragmentParameter(fragment: string): boolean {
  return fragment.split(/[?&]/).some((part) => {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex <= 0) return false;
    try {
      return SENSITIVE_QUERY_PARAMETER.test(decodeURIComponent(part.slice(0, separatorIndex)));
    } catch {
      return false;
    }
  });
}

function normalizeManifestUrl(value: unknown, label: string, removeFragment: boolean): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty URL string.`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RangeError(`${label} must use HTTP or HTTPS.`);
  }
  if (url.username || url.password) {
    throw new RangeError(`${label} must not contain credentials.`);
  }

  const sanitizedParameters = Array.from(
    url.searchParams.entries(),
    ([name, parameterValue]): [string, string] => [
      name,
      SENSITIVE_QUERY_PARAMETER.test(name) ? ARCHIVE_MANIFEST_REDACTED_VALUE : parameterValue,
    ],
  );
  url.search = '';
  for (const [name, parameterValue] of sanitizedParameters) {
    url.searchParams.append(name, parameterValue);
  }

  if (removeFragment) url.hash = '';
  else if (hasSensitiveFragmentParameter(url.hash.slice(1))) {
    url.hash = ARCHIVE_MANIFEST_REDACTED_VALUE;
  }
  return url.href;
}

function validateNonNegativeCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
  return value as number;
}

function validatePositiveCount(value: unknown, label: string): number {
  const count = validateNonNegativeCount(value, label);
  if (count === 0) throw new RangeError(`${label} must be greater than zero.`);
  return count;
}

function normalizeOnlineDependencies(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Archive onlineDependencies must be an array.');
  }

  const normalized = Array.from(value.entries(), ([index, dependency]) =>
    normalizeManifestUrl(dependency, `Archive online dependency at index ${index}`, true),
  );
  return Array.from(new Set(normalized)).sort(compareText);
}

export function buildArchiveManifest(input: ArchiveManifestInput): ArchiveManifest {
  if (!isRecord(input) || !hasExactInputKeys(input)) {
    throw new TypeError('Archive manifest input must contain exactly the supported fields.');
  }
  if (!CAPTURE_MODES.includes(input.mode as CaptureMode)) {
    throw new TypeError('Archive capture mode is not supported.');
  }
  if (!CAPTURE_PROFILES.includes(input.captureProfile as CaptureProfile)) {
    throw new TypeError('Archive capture profile is not supported.');
  }
  if (typeof input.requiresLocalHttpServer !== 'boolean') {
    throw new TypeError('Archive requiresLocalHttpServer must be a boolean.');
  }

  return {
    formatVersion: ARCHIVE_MANIFEST_FORMAT_VERSION,
    product: ARCHIVE_MANIFEST_PRODUCT,
    capturedAt: normalizeTimestamp(input.capturedAt),
    startUrl: normalizeManifestUrl(input.startUrl, 'Archive start URL', false),
    finalUrl: normalizeManifestUrl(input.finalUrl, 'Archive final URL', false),
    mode: input.mode,
    captureProfile: input.captureProfile,
    pages: validatePositiveCount(input.pages, 'Archive page count'),
    resources: validateNonNegativeCount(input.resources, 'Archive resource count'),
    failedResources: validateNonNegativeCount(
      input.failedResources,
      'Archive failed resource count',
    ),
    requiresLocalHttpServer: input.requiresLocalHttpServer,
    onlineDependencies: normalizeOnlineDependencies(input.onlineDependencies),
  };
}

export function createArchiveManifestBytes(input: ArchiveManifestInput): Uint8Array {
  return UTF8_ENCODER.encode(`${JSON.stringify(buildArchiveManifest(input), null, 2)}\n`);
}

export function createArchiveManifestEntry(input: ArchiveManifestInput): ZipArchiveEntry {
  return {
    path: ARCHIVE_METADATA_PATHS.archive,
    bytes: createArchiveManifestBytes(input),
  };
}
