import { RESOURCE_TYPES, type ResourceType } from '@sitecapsule/domain';

export const CSP_HTTP_EQUIV_VALUE = 'content-security-policy';
export const CSP_REPORT_ONLY_HTTP_EQUIV_VALUE = 'content-security-policy-report-only';
export const SERVICE_WORKER_GUARD_HASH_SOURCE =
  "'sha256-taNJo/C8iv0PJfe4SjwnwM+Xrcs2R/60BlYEnLxbGSc='";

export const CSP_ADJUSTMENT_REASONS = [
  'allow-service-worker-guard',
  'allow-local-document',
  'allow-local-stylesheet',
  'allow-local-image',
  'allow-local-font',
  'allow-local-script',
  'allow-local-media',
  'allow-local-wasm',
  'allow-local-manifest',
  'allow-local-model',
  'allow-local-data',
  'allow-local-other',
] as const;

export const CSP_ADJUSTMENT_LIMITATIONS = [
  'http-header-policies-not-available-in-html-snapshot',
  'meta-policy-applies-only-after-its-document-position',
  'report-only-meta-is-not-supported-by-browsers',
  'outside-head-meta-is-not-enforced',
  'duplicate-directives-preserved-first-wins',
  'meta-unsupported-directives-preserved',
] as const;

export type CspAdjustmentReason = (typeof CSP_ADJUSTMENT_REASONS)[number];
export type CspAdjustmentLimitation = (typeof CSP_ADJUSTMENT_LIMITATIONS)[number];
export type CspMetaPolicyStatus =
  'adjusted' | 'unchanged' | 'empty-policy' | 'outside-head' | 'report-only-unsupported';

export type CspDirectiveChange = {
  directiveName: string;
  addedSources: string[];
  removedSources: string[];
  reasons: CspAdjustmentReason[];
};

export type CspMetaPolicyResult = {
  elementOrdinal: number;
  status: CspMetaPolicyStatus;
  originalPolicy: string;
  adjustedPolicy: string;
  directiveChanges: CspDirectiveChange[];
};

export type CspAdjustmentResult = {
  policiesFound: number;
  policiesAdjusted: number;
  guardHashSource: string;
  policies: CspMetaPolicyResult[];
  limitations: CspAdjustmentLimitation[];
};

type ParsedDirective = {
  name: string;
  sources: string[];
};

type MutableDirectiveChange = CspDirectiveChange & {
  directiveIndex: number;
};

type SourceRequirement = {
  fallback: readonly string[];
  sources: readonly string[];
  reason: CspAdjustmentReason;
};

const NONE_SOURCE = "'none'";
const SELF_SOURCE = "'self'";
const META_UNSUPPORTED_DIRECTIVES = new Set(['frame-ancestors', 'report-uri', 'sandbox']);

const RESOURCE_REQUIREMENTS: Record<ResourceType, SourceRequirement> = {
  document: {
    fallback: ['frame-src', 'child-src', 'default-src'],
    sources: [SELF_SOURCE],
    reason: 'allow-local-document',
  },
  stylesheet: {
    fallback: ['style-src-elem', 'style-src', 'default-src'],
    sources: [SELF_SOURCE],
    reason: 'allow-local-stylesheet',
  },
  image: {
    fallback: ['img-src', 'default-src'],
    sources: [SELF_SOURCE],
    reason: 'allow-local-image',
  },
  font: {
    fallback: ['font-src', 'default-src'],
    sources: [SELF_SOURCE],
    reason: 'allow-local-font',
  },
  script: {
    fallback: ['script-src-elem', 'script-src', 'default-src'],
    sources: [SELF_SOURCE],
    reason: 'allow-local-script',
  },
  video: {
    fallback: ['media-src', 'default-src'],
    sources: [SELF_SOURCE],
    reason: 'allow-local-media',
  },
  audio: {
    fallback: ['media-src', 'default-src'],
    sources: [SELF_SOURCE],
    reason: 'allow-local-media',
  },
  wasm: {
    fallback: ['connect-src', 'default-src'],
    sources: [SELF_SOURCE],
    reason: 'allow-local-wasm',
  },
  manifest: {
    fallback: ['manifest-src', 'default-src'],
    sources: [SELF_SOURCE],
    reason: 'allow-local-manifest',
  },
  model: {
    fallback: ['connect-src', 'default-src'],
    sources: [SELF_SOURCE],
    reason: 'allow-local-model',
  },
  texture: {
    fallback: ['img-src', 'default-src'],
    sources: [SELF_SOURCE],
    reason: 'allow-local-image',
  },
  data: {
    fallback: ['connect-src', 'default-src'],
    sources: [SELF_SOURCE],
    reason: 'allow-local-data',
  },
  other: {
    fallback: ['connect-src', 'default-src'],
    sources: [SELF_SOURCE],
    reason: 'allow-local-other',
  },
};

function uniquePush(values: string[], value: string): void {
  if (!values.some((candidate) => candidate.toLowerCase() === value.toLowerCase())) {
    values.push(value);
  }
}

function parsePolicy(policy: string): ParsedDirective[] {
  const directives: ParsedDirective[] = [];
  for (const serializedDirective of policy.split(';')) {
    const tokens = serializedDirective.trim().split(/\s+/u).filter(Boolean);
    const name = tokens.shift()?.toLowerCase();
    if (!name) continue;
    directives.push({ name, sources: tokens });
  }
  return directives;
}

function serializePolicy(directives: readonly ParsedDirective[]): string {
  return directives
    .map((directive) =>
      directive.sources.length > 0
        ? `${directive.name} ${directive.sources.join(' ')}`
        : directive.name,
    )
    .join('; ');
}

function firstDirectiveIndexes(directives: readonly ParsedDirective[]): Map<string, number> {
  const indexes = new Map<string, number>();
  for (const [index, directive] of directives.entries()) {
    if (!indexes.has(directive.name)) indexes.set(directive.name, index);
  }
  return indexes;
}

function applyRequirement(
  requirement: SourceRequirement,
  directives: ParsedDirective[],
  indexes: ReadonlyMap<string, number>,
  changes: Map<number, MutableDirectiveChange>,
): void {
  const directiveIndex = requirement.fallback
    .map((name) => indexes.get(name))
    .find((index): index is number => index !== undefined);
  if (directiveIndex === undefined) return;

  const directive = directives[directiveIndex];
  if (!directive) return;
  const sourcesToAdd = requirement.sources.filter(
    (source) =>
      !directive.sources.some((candidate) => candidate.toLowerCase() === source.toLowerCase()),
  );
  const hasConflictingNone = directive.sources.some(
    (source) => source.toLowerCase() === NONE_SOURCE,
  );
  if (sourcesToAdd.length === 0 && !hasConflictingNone) return;

  let change = changes.get(directiveIndex);
  if (!change) {
    change = {
      directiveIndex,
      directiveName: directive.name,
      addedSources: [],
      removedSources: [],
      reasons: [],
    };
    changes.set(directiveIndex, change);
  }

  const retainedSources = directive.sources.filter((source) => {
    if (source.toLowerCase() !== NONE_SOURCE) return true;
    uniquePush(change.removedSources, source);
    return false;
  });
  directive.sources = retainedSources;
  for (const source of sourcesToAdd) {
    directive.sources.push(source);
    uniquePush(change.addedSources, source);
  }
  if (!change.reasons.includes(requirement.reason)) change.reasons.push(requirement.reason);
}

function adjustPolicy(
  originalPolicy: string,
  requiredResourceTypes: readonly ResourceType[],
): {
  adjustedPolicy: string;
  changes: CspDirectiveChange[];
  duplicate: boolean;
  unsupported: boolean;
} {
  const directives = parsePolicy(originalPolicy);
  const indexes = firstDirectiveIndexes(directives);
  const duplicate = indexes.size !== directives.length;
  const unsupported = directives.some((directive) =>
    META_UNSUPPORTED_DIRECTIVES.has(directive.name),
  );
  const changes = new Map<number, MutableDirectiveChange>();

  applyRequirement(
    {
      fallback: ['script-src-elem', 'script-src', 'default-src'],
      sources: [SERVICE_WORKER_GUARD_HASH_SOURCE],
      reason: 'allow-service-worker-guard',
    },
    directives,
    indexes,
    changes,
  );
  for (const resourceType of requiredResourceTypes) {
    applyRequirement(RESOURCE_REQUIREMENTS[resourceType], directives, indexes, changes);
  }

  return {
    adjustedPolicy: changes.size > 0 ? serializePolicy(directives) : originalPolicy,
    changes: [...changes.values()]
      .sort((left, right) => left.directiveIndex - right.directiveIndex)
      .map(({ directiveIndex: _directiveIndex, ...change }) => change),
    duplicate,
    unsupported,
  };
}

function isMetaPolicy(meta: HTMLMetaElement): boolean {
  const value = (meta.getAttribute('http-equiv') ?? '').trim().toLowerCase();
  return value === CSP_HTTP_EQUIV_VALUE || value === CSP_REPORT_ONLY_HTTP_EQUIV_VALUE;
}

export function adjustContentSecurityPolicies(
  document: Document,
  requiredResourceTypes: readonly ResourceType[],
  elementOrdinals?: ReadonlyMap<Element, number>,
): CspAdjustmentResult {
  if (!document || typeof document.querySelectorAll !== 'function') {
    throw new TypeError('A DOM document is required for CSP adjustment.');
  }
  if (
    !Array.isArray(requiredResourceTypes) ||
    !requiredResourceTypes.every((resourceType) => RESOURCE_TYPES.includes(resourceType))
  ) {
    throw new TypeError('CSP resource types must be recognized resource types.');
  }
  const normalizedResourceTypes = RESOURCE_TYPES.filter((resourceType) =>
    requiredResourceTypes.includes(resourceType),
  );

  const metas = (Array.from(document.querySelectorAll('meta')) as HTMLMetaElement[]).filter(
    isMetaPolicy,
  );
  const policies: CspMetaPolicyResult[] = [];
  const limitations: CspAdjustmentLimitation[] = [
    'http-header-policies-not-available-in-html-snapshot',
    'meta-policy-applies-only-after-its-document-position',
  ];
  let duplicate = false;
  let unsupported = false;
  let reportOnly = false;
  let outsideHead = false;

  for (const [index, meta] of metas.entries()) {
    const elementOrdinal = elementOrdinals?.get(meta) ?? index + 1;
    const originalPolicy = meta.getAttribute('content') ?? '';
    const httpEquiv = (meta.getAttribute('http-equiv') ?? '').trim().toLowerCase();
    if (httpEquiv === CSP_REPORT_ONLY_HTTP_EQUIV_VALUE) {
      reportOnly = true;
      policies.push({
        elementOrdinal,
        status: 'report-only-unsupported',
        originalPolicy,
        adjustedPolicy: originalPolicy,
        directiveChanges: [],
      });
      continue;
    }
    if (!document.head?.contains(meta)) {
      outsideHead = true;
      policies.push({
        elementOrdinal,
        status: 'outside-head',
        originalPolicy,
        adjustedPolicy: originalPolicy,
        directiveChanges: [],
      });
      continue;
    }
    if (!originalPolicy.trim()) {
      policies.push({
        elementOrdinal,
        status: 'empty-policy',
        originalPolicy,
        adjustedPolicy: originalPolicy,
        directiveChanges: [],
      });
      continue;
    }

    const adjusted = adjustPolicy(originalPolicy, normalizedResourceTypes);
    duplicate ||= adjusted.duplicate;
    unsupported ||= adjusted.unsupported;
    if (adjusted.changes.length > 0) meta.setAttribute('content', adjusted.adjustedPolicy);
    policies.push({
      elementOrdinal,
      status: adjusted.changes.length > 0 ? 'adjusted' : 'unchanged',
      originalPolicy,
      adjustedPolicy: adjusted.adjustedPolicy,
      directiveChanges: adjusted.changes,
    });
  }

  if (reportOnly) limitations.push('report-only-meta-is-not-supported-by-browsers');
  if (outsideHead) limitations.push('outside-head-meta-is-not-enforced');
  if (duplicate) limitations.push('duplicate-directives-preserved-first-wins');
  if (unsupported) limitations.push('meta-unsupported-directives-preserved');

  return {
    policiesFound: policies.length,
    policiesAdjusted: policies.filter((policy) => policy.status === 'adjusted').length,
    guardHashSource: SERVICE_WORKER_GUARD_HASH_SOURCE,
    policies,
    limitations,
  };
}
