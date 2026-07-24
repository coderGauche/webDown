import {
  PAGE_ACCESS_ORIGINS,
  checkCurrentSiteAccess,
  createPageAccessRequest,
  type PageAccessRequest,
} from '@sitecapsule/permissions';
import { describe, expect, it, vi } from 'vitest';

describe('current site access permissions', () => {
  it('keeps broad HTTP/HTTPS patterns only as optional manifest capabilities', () => {
    expect(PAGE_ACCESS_ORIGINS).toEqual(['http://*/*', 'https://*/*']);
  });

  it.each([
    ['https://Example.COM:443/path?q=1#section', 'https://example.com/*'],
    ['http://example.com:80/path', 'http://example.com/*'],
    ['https://example.com:8443/path', 'https://example.com/*'],
    ['https://assets.example.com/path', 'https://assets.example.com/*'],
  ])('checks only the canonical current origin for %s', async (pageUrl, permissionPattern) => {
    const contains = vi
      .fn<(request: PageAccessRequest) => Promise<boolean>>()
      .mockResolvedValue(false);

    const result = await checkCurrentSiteAccess(pageUrl, contains);

    expect(result).toEqual({
      status: 'not-granted',
      pageUrl: new URL(pageUrl).href,
      origin: new URL(pageUrl).origin,
      permissionPattern,
    });
    expect(contains).toHaveBeenCalledOnce();
    expect(contains).toHaveBeenCalledWith({ origins: [permissionPattern] });
  });

  it('reports granted access and creates a fresh single-origin request', async () => {
    const result = await checkCurrentSiteAccess('https://example.com/page', async () => true);
    expect(result.status).toBe('granted');
    if (result.status === 'restricted') throw new Error('Expected a grantable site result.');

    const first = createPageAccessRequest(result);
    first.origins.pop();

    expect(createPageAccessRequest(result)).toEqual({ origins: ['https://example.com/*'] });
  });

  it.each([
    [undefined, 'missing-url', null],
    ['', 'missing-url', null],
    ['not a URL', 'invalid-url', null],
    ['chrome://extensions/', 'unsupported-protocol', 'chrome:'],
    ['file:///tmp/page.html', 'unsupported-protocol', 'file:'],
    ['data:text/html,hello', 'unsupported-protocol', 'data:'],
  ])('marks %s as restricted without querying permissions', async (pageUrl, reason, protocol) => {
    const contains = vi.fn<(request: PageAccessRequest) => Promise<boolean>>();

    const result = await checkCurrentSiteAccess(pageUrl, contains);

    expect(result).toMatchObject({
      status: 'restricted',
      origin: null,
      permissionPattern: null,
      reason,
      protocol,
    });
    expect(contains).not.toHaveBeenCalled();
  });

  it('does not hide browser permission API failures', async () => {
    await expect(
      checkCurrentSiteAccess('https://example.com/', async () => {
        throw new Error('permissions API unavailable');
      }),
    ).rejects.toThrow('permissions API unavailable');
  });
});
