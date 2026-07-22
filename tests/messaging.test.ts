import {
  createPageInfoError,
  createPageInfoRequest,
  createPageInfoResponse,
  isPageInfoRequest,
  isPageInfoResponse,
} from '@sitecapsule/messaging/protocol';
import { describe, expect, it } from 'vitest';

describe('page info messaging protocol', () => {
  it('accepts a valid Side Panel request', () => {
    expect(isPageInfoRequest(createPageInfoRequest(42))).toBe(true);
    expect(isPageInfoRequest({ type: 'page-info/request', tabId: '42' })).toBe(false);
  });

  it('validates successful and failed responses', () => {
    expect(
      isPageInfoResponse(createPageInfoResponse({ title: 'Example', url: 'https://example.com' })),
    ).toBe(true);
    expect(isPageInfoResponse(createPageInfoError('Unavailable'))).toBe(true);
    expect(isPageInfoResponse({ type: 'page-info/response', ok: true, page: { title: 1 } })).toBe(
      false,
    );
  });
});
