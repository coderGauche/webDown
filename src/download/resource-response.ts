import type {
  ResourceRecord,
  ResourceRedirectHop,
  ResourceRedirectTrace,
} from '@sitecapsule/domain';
import { normalizeResourceUrl } from '@sitecapsule/page';

import { isRetryableHttpStatus, type RequestAttemptResult } from './request-retry';

const MIME_TYPE_TOKEN_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export type ResponseHeadersSource = {
  get(name: string): string | null;
};

export type ResourceResponseSource = {
  url: string;
  redirected: boolean;
  status: number;
  headers: ResponseHeadersSource;
};

export type ResourceResponseInspectionOptions = {
  redirectHops?: readonly ResourceRedirectHop[];
};

export type ResourceResponseMetadata = {
  originalUrl: string;
  finalUrl: string;
  redirected: boolean;
  redirectTrace: ResourceRedirectTrace;
  httpStatus: number;
  ok: boolean;
  mimeType: string | null;
};

export type InspectedResourceResponse<TResponse extends ResourceResponseSource> = {
  response: TResponse;
  metadata: ResourceResponseMetadata;
};

export type ResourceHttpFailure<TResponse extends ResourceResponseSource> = {
  kind: 'http-status';
  response: TResponse;
  metadata: ResourceResponseMetadata;
};

function normalizeNetworkUrl(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string.`);
  const normalized = normalizeResourceUrl(value);
  if (normalized === null || !/^https?:\/\//.test(normalized)) {
    throw new RangeError(`${field} must be an absolute HTTP or HTTPS URL.`);
  }
  return normalized;
}

function isHttpStatus(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 100 && (value as number) <= 599;
}

function normalizeRedirectHop(hop: ResourceRedirectHop, index: number): ResourceRedirectHop {
  if (typeof hop !== 'object' || hop === null) {
    throw new TypeError(`Redirect hop ${index} must be an object.`);
  }
  if (
    !Number.isInteger(hop.httpStatus) ||
    (hop.httpStatus as number) < 300 ||
    (hop.httpStatus as number) > 399
  ) {
    throw new RangeError(`Redirect hop ${index} must have a 3xx HTTP status.`);
  }
  return {
    fromUrl: normalizeNetworkUrl(hop.fromUrl, `Redirect hop ${index} source URL`),
    toUrl: normalizeNetworkUrl(hop.toUrl, `Redirect hop ${index} target URL`),
    httpStatus: hop.httpStatus,
  };
}

function createRedirectTrace(
  originalUrl: string,
  finalUrl: string,
  redirected: boolean,
  redirectHops: readonly ResourceRedirectHop[] | undefined,
): ResourceRedirectTrace {
  if (redirectHops === undefined) {
    return redirected
      ? { complete: false, hops: [{ fromUrl: originalUrl, toUrl: finalUrl }] }
      : { complete: true, hops: [] };
  }

  const hops = redirectHops.map(normalizeRedirectHop);
  if (redirected !== hops.length > 0) {
    throw new RangeError('Redirect hops do not match the response redirected flag.');
  }
  if (hops.length === 0) return { complete: true, hops: [] };
  if (hops[0]?.fromUrl !== originalUrl || hops.at(-1)?.toUrl !== finalUrl) {
    throw new RangeError('Redirect chain endpoints do not match the response URLs.');
  }
  for (let index = 1; index < hops.length; index += 1) {
    if (hops[index - 1]?.toUrl !== hops[index]?.fromUrl) {
      throw new RangeError('Redirect chain must be continuous.');
    }
  }
  return { complete: true, hops };
}

export function normalizeResponseMimeType(contentType: unknown): string | null {
  if (typeof contentType !== 'string') return null;
  const essence = contentType.split(';', 1)[0]?.trim();
  if (!essence) return null;

  const separator = essence.indexOf('/');
  if (
    separator <= 0 ||
    separator !== essence.lastIndexOf('/') ||
    separator === essence.length - 1
  ) {
    return null;
  }

  const type = essence.slice(0, separator);
  const subtype = essence.slice(separator + 1);
  if (!MIME_TYPE_TOKEN_PATTERN.test(type) || !MIME_TYPE_TOKEN_PATTERN.test(subtype)) return null;
  return `${type.toLowerCase()}/${subtype.toLowerCase()}`;
}

export function inspectResourceResponse<TResponse extends ResourceResponseSource>(
  originalUrl: string,
  response: TResponse,
  options: ResourceResponseInspectionOptions = {},
): InspectedResourceResponse<TResponse> {
  const normalizedOriginalUrl = normalizeNetworkUrl(originalUrl, 'Original URL');
  const finalUrl = normalizeNetworkUrl(response.url, 'Final URL');
  if (typeof response.redirected !== 'boolean') {
    throw new TypeError('Response redirected flag must be a boolean.');
  }
  if (!isHttpStatus(response.status)) {
    throw new RangeError('HTTP status must be an integer from 100 through 599.');
  }
  if (typeof response.headers?.get !== 'function') {
    throw new TypeError('Response headers must provide get().');
  }

  const redirected = response.redirected;
  const metadata: ResourceResponseMetadata = {
    originalUrl: normalizedOriginalUrl,
    finalUrl,
    redirected,
    redirectTrace: createRedirectTrace(
      normalizedOriginalUrl,
      finalUrl,
      redirected,
      options.redirectHops,
    ),
    httpStatus: response.status,
    ok: response.status >= 200 && response.status <= 299,
    mimeType: normalizeResponseMimeType(response.headers.get('content-type')),
  };

  return { response, metadata };
}

export function classifyResourceResponse<TResponse extends ResourceResponseSource>(
  originalUrl: string,
  response: TResponse,
  options: ResourceResponseInspectionOptions = {},
): RequestAttemptResult<InspectedResourceResponse<TResponse>, ResourceHttpFailure<TResponse>> {
  const inspected = inspectResourceResponse(originalUrl, response, options);
  if (inspected.metadata.ok) return { status: 'succeeded', value: inspected };

  return {
    status: 'failed',
    error: { kind: 'http-status', ...inspected },
    retryable: isRetryableHttpStatus(inspected.metadata.httpStatus),
    retryAfter: response.headers.get('retry-after'),
  };
}

export function applyResourceResponseMetadata(
  resource: ResourceRecord,
  metadata: ResourceResponseMetadata,
): ResourceRecord {
  const resourceOriginalUrl = normalizeNetworkUrl(resource.originalUrl, 'Resource original URL');
  if (resourceOriginalUrl !== metadata.originalUrl) {
    throw new RangeError('Response metadata does not belong to this resource.');
  }

  const redirectTrace: ResourceRedirectTrace = metadata.redirectTrace.complete
    ? { complete: true, hops: metadata.redirectTrace.hops.map((hop) => ({ ...hop })) }
    : { complete: false, hops: [{ ...metadata.redirectTrace.hops[0] }] };
  const {
    finalUrl: _finalUrl,
    redirectTrace: _redirectTrace,
    httpStatus: _httpStatus,
    mimeType: _mimeType,
    ...base
  } = resource;
  return {
    ...base,
    finalUrl: metadata.finalUrl,
    redirectTrace,
    httpStatus: metadata.httpStatus,
    ...(metadata.mimeType === null ? {} : { mimeType: metadata.mimeType }),
  };
}
