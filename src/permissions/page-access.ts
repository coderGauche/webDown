export const PAGE_ACCESS_ORIGINS = ['http://*/*', 'https://*/*'] as const;
export const SITE_ACCESS_STATUSES = ['granted', 'not-granted', 'restricted'] as const;
export const SITE_ACCESS_RESTRICTION_REASONS = [
  'missing-url',
  'invalid-url',
  'unsupported-protocol',
] as const;

export type SiteAccessStatus = (typeof SITE_ACCESS_STATUSES)[number];
export type SiteAccessRestrictionReason = (typeof SITE_ACCESS_RESTRICTION_REASONS)[number];

export type PageAccessRequest = {
  origins: string[];
};

export type SiteAccessGrantableResult = {
  status: 'granted' | 'not-granted';
  pageUrl: string;
  origin: string;
  permissionPattern: string;
};

export type SiteAccessRestrictedResult = {
  status: 'restricted';
  pageUrl: string | null;
  origin: null;
  permissionPattern: null;
  reason: SiteAccessRestrictionReason;
  protocol: string | null;
};

export type SiteAccessResult = SiteAccessGrantableResult | SiteAccessRestrictedResult;
export type SiteAccessTarget = Omit<SiteAccessGrantableResult, 'status'>;
export type PageAccessContains = (request: PageAccessRequest) => Promise<boolean>;

function restrictedResult(
  pageUrl: string | null,
  reason: SiteAccessRestrictionReason,
  protocol: string | null = null,
): SiteAccessRestrictedResult {
  return {
    status: 'restricted',
    pageUrl,
    origin: null,
    permissionPattern: null,
    reason,
    protocol,
  };
}

export function resolveSiteAccessTarget(
  pageUrl: unknown,
): SiteAccessTarget | SiteAccessRestrictedResult {
  if (typeof pageUrl !== 'string' || pageUrl.trim() === '') {
    return restrictedResult(null, 'missing-url');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(pageUrl);
  } catch {
    return restrictedResult(pageUrl, 'invalid-url');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return restrictedResult(parsedUrl.href, 'unsupported-protocol', parsedUrl.protocol);
  }

  // Chrome host permissions cannot scope a normal match pattern to one port.
  return {
    pageUrl: parsedUrl.href,
    origin: parsedUrl.origin,
    permissionPattern: `${parsedUrl.protocol}//${parsedUrl.hostname}/*`,
  };
}

export function createPageAccessRequest(access: SiteAccessGrantableResult): PageAccessRequest {
  return { origins: [access.permissionPattern] };
}

export async function checkCurrentSiteAccess(
  pageUrl: unknown,
  contains: PageAccessContains,
): Promise<SiteAccessResult> {
  const target = resolveSiteAccessTarget(pageUrl);
  if ('reason' in target) return target;

  const access = { ...target, status: 'not-granted' as const };
  const granted = await contains(createPageAccessRequest(access));
  return { ...target, status: granted ? 'granted' : 'not-granted' };
}
