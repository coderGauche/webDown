import { normalizeResourceUrl } from './resource-url';

export const RESOURCE_URL_KINDS = ['network', 'data', 'blob', 'unsupported'] as const;
export const DATA_URL_ENCODINGS = ['percent-encoded', 'base64'] as const;
export const UNSUPPORTED_RESOURCE_REASONS = [
  'unsupported-protocol',
  'malformed-data-url',
  'malformed-blob-url',
] as const;

export type ResourceUrlKind = (typeof RESOURCE_URL_KINDS)[number];
export type DataUrlEncoding = (typeof DATA_URL_ENCODINGS)[number];
export type UnsupportedResourceReason = (typeof UNSUPPORTED_RESOURCE_REASONS)[number];

export type NetworkResourceUrlClassification = {
  kind: 'network';
  protocol: 'http:' | 'https:';
  networkFetchEligible: true;
};

export type DataResourceUrlClassification = {
  kind: 'data';
  protocol: 'data:';
  networkFetchEligible: false;
  header: string;
  encoding: DataUrlEncoding;
};

export type BlobResourceUrlClassification = {
  kind: 'blob';
  protocol: 'blob:';
  networkFetchEligible: false;
  limitation: 'document-session-bound';
};

export type UnsupportedResourceUrlClassification = {
  kind: 'unsupported';
  protocol: string;
  networkFetchEligible: false;
  reason: UnsupportedResourceReason;
};

export type ResourceUrlClassification =
  | NetworkResourceUrlClassification
  | DataResourceUrlClassification
  | BlobResourceUrlClassification
  | UnsupportedResourceUrlClassification;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => actualKeys.includes(key));
}

function isProtocol(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z\d+.-]*:$/.test(value);
}

function isValidBlobPath(pathname: string): boolean {
  const separatorIndex = pathname.lastIndexOf('/');
  if (separatorIndex <= 0 || separatorIndex === pathname.length - 1) return false;

  const serializedOrigin = pathname.slice(0, separatorIndex);
  if (serializedOrigin === 'null') return true;

  try {
    const origin = new URL(serializedOrigin);
    return (
      ['http:', 'https:'].includes(origin.protocol) &&
      origin.pathname === '/' &&
      origin.search === '' &&
      origin.hash === ''
    );
  } catch {
    return false;
  }
}

export function classifyResourceUrl(value: string): ResourceUrlClassification | null {
  const normalizedUrl = normalizeResourceUrl(value);
  if (!normalizedUrl) return null;
  const url = new URL(normalizedUrl);

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return { kind: 'network', protocol: url.protocol, networkFetchEligible: true };
  }

  if (url.protocol === 'data:') {
    const separatorIndex = url.pathname.indexOf(',');
    if (separatorIndex < 0) {
      return {
        kind: 'unsupported',
        protocol: 'data:',
        networkFetchEligible: false,
        reason: 'malformed-data-url',
      };
    }
    const header = url.pathname.slice(0, separatorIndex);
    const finalHeaderToken = header.split(';').at(-1)?.trim().toLowerCase();
    return {
      kind: 'data',
      protocol: 'data:',
      networkFetchEligible: false,
      header,
      encoding: finalHeaderToken === 'base64' ? 'base64' : 'percent-encoded',
    };
  }

  if (url.protocol === 'blob:') {
    return isValidBlobPath(url.pathname)
      ? {
          kind: 'blob',
          protocol: 'blob:',
          networkFetchEligible: false,
          limitation: 'document-session-bound',
        }
      : {
          kind: 'unsupported',
          protocol: 'blob:',
          networkFetchEligible: false,
          reason: 'malformed-blob-url',
        };
  }

  return {
    kind: 'unsupported',
    protocol: url.protocol,
    networkFetchEligible: false,
    reason: 'unsupported-protocol',
  };
}

export function isResourceUrlClassification(value: unknown): value is ResourceUrlClassification {
  if (!isRecord(value) || !isProtocol(value.protocol)) return false;

  if (value.kind === 'network') {
    return (
      hasExactKeys(value, ['kind', 'protocol', 'networkFetchEligible']) &&
      (value.protocol === 'http:' || value.protocol === 'https:') &&
      value.networkFetchEligible === true
    );
  }
  if (value.kind === 'data') {
    return (
      hasExactKeys(value, ['kind', 'protocol', 'networkFetchEligible', 'header', 'encoding']) &&
      value.protocol === 'data:' &&
      value.networkFetchEligible === false &&
      typeof value.header === 'string' &&
      DATA_URL_ENCODINGS.includes(value.encoding as DataUrlEncoding)
    );
  }
  if (value.kind === 'blob') {
    return (
      hasExactKeys(value, ['kind', 'protocol', 'networkFetchEligible', 'limitation']) &&
      value.protocol === 'blob:' &&
      value.networkFetchEligible === false &&
      value.limitation === 'document-session-bound'
    );
  }
  if (value.kind !== 'unsupported') return false;
  if (
    !hasExactKeys(value, ['kind', 'protocol', 'networkFetchEligible', 'reason']) ||
    value.networkFetchEligible !== false ||
    !UNSUPPORTED_RESOURCE_REASONS.includes(value.reason as UnsupportedResourceReason)
  ) {
    return false;
  }
  if (value.reason === 'malformed-data-url') return value.protocol === 'data:';
  if (value.reason === 'malformed-blob-url') return value.protocol === 'blob:';
  return !['http:', 'https:', 'data:', 'blob:'].includes(value.protocol);
}

export function matchesResourceUrlClassification(
  value: unknown,
  url: string,
): value is ResourceUrlClassification {
  const expected = classifyResourceUrl(url);
  return (
    expected !== null &&
    isResourceUrlClassification(value) &&
    JSON.stringify(value) === JSON.stringify(expected)
  );
}
