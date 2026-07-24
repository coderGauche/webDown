const NETWORK_RESOURCE_PROTOCOLS = new Set(['http:', 'https:']);
const PERCENT_ESCAPE_PATTERN = /%[0-9a-fA-F]{2}/g;

function normalizePathPercentEscapes(pathname: string): string {
  return pathname.replace(PERCENT_ESCAPE_PATTERN, (escape) => escape.toUpperCase());
}

export function normalizeResourceUrl(value: string, baseUrl?: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;

  let url: URL;
  try {
    url = baseUrl === undefined ? new URL(candidate) : new URL(candidate, baseUrl);
  } catch {
    return null;
  }

  if (NETWORK_RESOURCE_PROTOCOLS.has(url.protocol)) {
    url.hash = '';
    url.pathname = normalizePathPercentEscapes(url.pathname);
  }

  return url.href;
}

export function isNormalizedResourceUrl(value: unknown): value is string {
  return typeof value === 'string' && normalizeResourceUrl(value) === value;
}
