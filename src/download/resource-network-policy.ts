import type { ResourceResponseMetadata } from './resource-response';

export const RESOURCE_NETWORK_RESTRICTION_REASONS = [
  'missing-url',
  'invalid-url',
  'unsupported-protocol',
  'embedded-credentials',
  'local-network',
  'permission-denied',
] as const;

export const LOCAL_NETWORK_KINDS = [
  'local-hostname',
  'single-label-hostname',
  'unspecified',
  'loopback',
  'private',
  'shared',
  'link-local',
  'benchmark',
  'multicast',
  'reserved',
] as const;

export type ResourceNetworkRestrictionReason =
  (typeof RESOURCE_NETWORK_RESTRICTION_REASONS)[number];
export type LocalNetworkKind = (typeof LOCAL_NETWORK_KINDS)[number];

export type ResourceNetworkPermissionRequest = { origins: string[] };
export type ResourceNetworkPermissionContains = (
  request: ResourceNetworkPermissionRequest,
) => Promise<boolean>;

export type ResourceNetworkTarget = {
  status: 'eligible';
  url: string;
  origin: string;
  protocol: 'http:' | 'https:';
  hostname: string;
  permissionPattern: string;
};

export type BlockedResourceNetworkTarget = {
  status: 'blocked';
  reason: Exclude<ResourceNetworkRestrictionReason, 'permission-denied'>;
  url: string | null;
  protocol: string | null;
  hostname: string | null;
  localNetworkKind: LocalNetworkKind | null;
};

export type ResourceNetworkTargetInspection = ResourceNetworkTarget | BlockedResourceNetworkTarget;

export type AuthorizedResourceNetworkTarget = Omit<ResourceNetworkTarget, 'status'> & {
  status: 'allowed';
};

export type DeniedResourceNetworkTarget = Omit<ResourceNetworkTarget, 'status'> & {
  status: 'blocked';
  reason: 'permission-denied';
  localNetworkKind: null;
};

export type ResourceNetworkAccessResult =
  AuthorizedResourceNetworkTarget | BlockedResourceNetworkTarget | DeniedResourceNetworkTarget;

export type ResourceNetworkPolicyStage = 'original' | 'redirect' | 'final';

export type ResourceNetworkPolicyTarget = AuthorizedResourceNetworkTarget & {
  stage: ResourceNetworkPolicyStage;
  redirectIndex: number | null;
};

export type ResourceResponseNetworkPolicyResult =
  | { status: 'allowed'; targets: ResourceNetworkPolicyTarget[] }
  | {
      status: 'blocked';
      stage: ResourceNetworkPolicyStage;
      redirectIndex: number | null;
      target: Exclude<ResourceNetworkAccessResult, AuthorizedResourceNetworkTarget>;
    };

const LOCAL_HOSTNAME_SUFFIXES = [
  'localhost',
  'local',
  'localdomain',
  'home',
  'home.arpa',
  'internal',
  'intranet',
  'lan',
] as const;

function blocked(
  reason: BlockedResourceNetworkTarget['reason'],
  options: {
    url?: string | null;
    protocol?: string | null;
    hostname?: string | null;
    localNetworkKind?: LocalNetworkKind | null;
  } = {},
): BlockedResourceNetworkTarget {
  return {
    status: 'blocked',
    reason,
    url: options.url ?? null,
    protocol: options.protocol ?? null,
    hostname: options.hostname ?? null,
    localNetworkKind: options.localNetworkKind ?? null,
  };
}

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  return octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? (octets as [number, number, number, number])
    : null;
}

function parseIpv6(hostname: string): number[] | null {
  const value =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const parseHalf = (half: string) => {
    if (half === '') return [];
    const parts = half.split(':');
    if (parts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
    return parts.map((part) => Number.parseInt(part, 16));
  };
  const left = parseHalf(halves[0] ?? '');
  const right = parseHalf(halves[1] ?? '');
  if (left === null || right === null) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  return missing >= 1 ? [...left, ...Array<number>(missing).fill(0), ...right] : null;
}

function classifyIpv4(octets: readonly number[]): LocalNetworkKind | null {
  const [first, second] = octets;
  if (first === 0) return 'unspecified';
  if (first === 10 || (first === 172 && second !== undefined && second >= 16 && second <= 31)) {
    return 'private';
  }
  if (first === 192 && second === 168) return 'private';
  if (first === 100 && second !== undefined && second >= 64 && second <= 127) return 'shared';
  if (first === 127) return 'loopback';
  if (first === 169 && second === 254) return 'link-local';
  if (first === 192 && second === 0) return 'reserved';
  if (first === 198 && (second === 18 || second === 19)) return 'benchmark';
  if (first !== undefined && first >= 224 && first <= 239) return 'multicast';
  if (first !== undefined && first >= 240) return 'reserved';
  return null;
}

function classifyIpv6(segments: readonly number[]): LocalNetworkKind | null {
  if (segments.every((segment) => segment === 0)) return 'unspecified';
  if (segments.slice(0, 7).every((segment) => segment === 0) && segments[7] === 1) {
    return 'loopback';
  }
  const first = segments[0] as number;
  if ((first & 0xfe00) === 0xfc00) return 'private';
  if ((first & 0xffc0) === 0xfe80) return 'link-local';
  if ((first & 0xff00) === 0xff00) return 'multicast';

  const isMapped = segments.slice(0, 5).every((segment) => segment === 0) && segments[5] === 0xffff;
  const isCompatible = segments.slice(0, 6).every((segment) => segment === 0);
  if (isMapped || isCompatible) {
    const high = segments[6] as number;
    const low = segments[7] as number;
    return classifyIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }
  return null;
}

function classifyLocalNetwork(hostname: string): LocalNetworkKind | null {
  const ipv4 = parseIpv4(hostname);
  if (ipv4) return classifyIpv4(ipv4);
  const ipv6 = parseIpv6(hostname);
  if (ipv6) return classifyIpv6(ipv6);

  if (
    LOCAL_HOSTNAME_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))
  ) {
    return 'local-hostname';
  }
  if (!hostname.includes('.')) return 'single-label-hostname';
  return null;
}

function sanitizeBlockedUrl(url: URL): string {
  url.username = '';
  url.password = '';
  url.hash = '';
  return url.href;
}

export function inspectResourceNetworkTarget(value: unknown): ResourceNetworkTargetInspection {
  if (typeof value !== 'string' || value.trim() === '') return blocked('missing-url');

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return blocked('invalid-url');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return blocked('unsupported-protocol', {
      url: sanitizeBlockedUrl(url),
      protocol: url.protocol,
      hostname: url.hostname || null,
    });
  }
  if (url.username || url.password) {
    return blocked('embedded-credentials', {
      url: sanitizeBlockedUrl(url),
      protocol: url.protocol,
      hostname: url.hostname,
    });
  }

  const hostname = url.hostname.replace(/\.+$/, '').toLowerCase();
  if (hostname !== url.hostname) url.hostname = hostname;
  url.hash = '';
  const localNetworkKind = classifyLocalNetwork(hostname);
  if (localNetworkKind !== null) {
    return blocked('local-network', {
      url: url.href,
      protocol: url.protocol,
      hostname,
      localNetworkKind,
    });
  }

  const protocol = url.protocol as 'http:' | 'https:';
  return {
    status: 'eligible',
    url: url.href,
    origin: url.origin,
    protocol,
    hostname,
    permissionPattern: `${protocol}//${hostname}/*`,
  };
}

export async function checkResourceNetworkAccess(
  value: unknown,
  contains: ResourceNetworkPermissionContains,
): Promise<ResourceNetworkAccessResult> {
  const target = inspectResourceNetworkTarget(value);
  if (target.status === 'blocked') return target;
  const granted = await contains({ origins: [target.permissionPattern] });
  return granted
    ? { ...target, status: 'allowed' }
    : { ...target, status: 'blocked', reason: 'permission-denied', localNetworkKind: null };
}

export async function checkResourceResponseNetworkPolicy(
  metadata: ResourceResponseMetadata,
  contains: ResourceNetworkPermissionContains,
): Promise<ResourceResponseNetworkPolicyResult> {
  const candidates: Array<{
    stage: ResourceNetworkPolicyStage;
    redirectIndex: number | null;
    url: string;
  }> = [{ stage: 'original', redirectIndex: null, url: metadata.originalUrl }];
  if (metadata.redirectTrace.complete) {
    metadata.redirectTrace.hops.forEach((hop, redirectIndex) => {
      candidates.push({ stage: 'redirect', redirectIndex, url: hop.toUrl });
    });
  }
  candidates.push({ stage: 'final', redirectIndex: null, url: metadata.finalUrl });

  const permissionCache = new Map<string, Promise<boolean>>();
  const targets: ResourceNetworkPolicyTarget[] = [];
  for (const candidate of candidates) {
    const inspected = inspectResourceNetworkTarget(candidate.url);
    if (inspected.status === 'blocked') {
      return { status: 'blocked', ...candidate, target: inspected };
    }
    let permission = permissionCache.get(inspected.permissionPattern);
    if (!permission) {
      permission = contains({ origins: [inspected.permissionPattern] });
      permissionCache.set(inspected.permissionPattern, permission);
    }
    if (!(await permission)) {
      return {
        status: 'blocked',
        stage: candidate.stage,
        redirectIndex: candidate.redirectIndex,
        target: {
          ...inspected,
          status: 'blocked',
          reason: 'permission-denied',
          localNetworkKind: null,
        },
      };
    }
    targets.push({
      ...inspected,
      status: 'allowed',
      stage: candidate.stage,
      redirectIndex: candidate.redirectIndex,
    });
  }
  return { status: 'allowed', targets };
}

export function createSecureResourceFetchInit(signal?: AbortSignal): Readonly<RequestInit> {
  return Object.freeze({
    method: 'GET',
    credentials: 'omit',
    redirect: 'follow',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
}
