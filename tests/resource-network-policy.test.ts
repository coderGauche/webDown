import type { ResourceRedirectHop } from '@sitecapsule/domain';
import {
  checkResourceNetworkAccess,
  checkResourceResponseNetworkPolicy,
  createSecureResourceFetchInit,
  inspectResourceNetworkTarget,
  type ResourceNetworkPermissionContains,
} from '@sitecapsule/download';
import { inspectResourceResponse, type ResourceResponseSource } from '@sitecapsule/download';
import { describe, expect, it, vi } from 'vitest';

function allow(...patterns: string[]): ResourceNetworkPermissionContains {
  return async ({ origins }) => origins.every((origin) => patterns.includes(origin));
}

function response(url: string, redirected: boolean): ResourceResponseSource {
  return {
    url,
    redirected,
    status: 200,
    headers: { get: () => null },
  };
}

function metadata(
  originalUrl: string,
  finalUrl = originalUrl,
  redirectHops?: readonly ResourceRedirectHop[],
) {
  return inspectResourceResponse(originalUrl, response(finalUrl, finalUrl !== originalUrl), {
    ...(redirectHops ? { redirectHops } : {}),
  }).metadata;
}

describe('resource network safety policy', () => {
  it.each([
    ['https://Example.COM:443/a/../asset.js#fragment', 'https://example.com/asset.js'],
    ['http://example.com:80/style.css?q=1', 'http://example.com/style.css?q=1'],
    ['https://cdn.example.com:8443/image.png', 'https://cdn.example.com:8443/image.png'],
    ['https://[2606:4700:4700::1111]/dns', 'https://[2606:4700:4700::1111]/dns'],
    ['https://localhost.evil.example/file', 'https://localhost.evil.example/file'],
  ])('allows and canonicalizes public target %s', (value, expectedUrl) => {
    expect(inspectResourceNetworkTarget(value)).toMatchObject({
      status: 'eligible',
      url: expectedUrl,
      origin: new URL(expectedUrl).origin,
    });
  });

  it.each([
    [undefined, 'missing-url'],
    ['', 'missing-url'],
    ['not a URL', 'invalid-url'],
    ['data:text/plain,hello', 'unsupported-protocol'],
    ['blob:https://example.com/id', 'unsupported-protocol'],
    ['file:///tmp/private', 'unsupported-protocol'],
    ['ftp://example.com/file', 'unsupported-protocol'],
    ['chrome://settings/', 'unsupported-protocol'],
  ])('blocks invalid or unsupported target %s', (value, reason) => {
    expect(inspectResourceNetworkTarget(value)).toMatchObject({ status: 'blocked', reason });
  });

  it('blocks embedded URL credentials without returning the secret', () => {
    const result = inspectResourceNetworkTarget('https://alice:super-secret@example.com/a');
    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'embedded-credentials',
      url: 'https://example.com/a',
    });
    expect(JSON.stringify(result)).not.toContain('super-secret');
  });

  it.each([
    ['http://localhost/', 'local-hostname'],
    ['http://api.localhost./', 'local-hostname'],
    ['http://printer.local/', 'local-hostname'],
    ['http://router.home.arpa/', 'local-hostname'],
    ['http://service.internal/', 'local-hostname'],
    ['http://intranet/', 'local-hostname'],
    ['http://printer/', 'single-label-hostname'],
    ['http://0.0.0.0/', 'unspecified'],
    ['http://127.0.0.1/', 'loopback'],
    ['http://127.1/', 'loopback'],
    ['http://2130706433/', 'loopback'],
    ['http://0x7f000001/', 'loopback'],
    ['http://10.0.0.1/', 'private'],
    ['http://172.16.0.1/', 'private'],
    ['http://172.31.255.255/', 'private'],
    ['http://192.168.1.1/', 'private'],
    ['http://100.64.0.1/', 'shared'],
    ['http://169.254.169.254/latest/meta-data/', 'link-local'],
    ['http://198.18.0.1/', 'benchmark'],
    ['http://224.0.0.1/', 'multicast'],
    ['http://255.255.255.255/', 'reserved'],
    ['http://[::]/', 'unspecified'],
    ['http://[::1]/', 'loopback'],
    ['http://[fc00::1]/', 'private'],
    ['http://[fd12:3456::1]/', 'private'],
    ['http://[fe80::1]/', 'link-local'],
    ['http://[ff02::1]/', 'multicast'],
    ['http://[::ffff:127.0.0.1]/', 'loopback'],
    ['http://[::ffff:10.0.0.1]/', 'private'],
  ])('blocks local-network target %s as %s', (value, localNetworkKind) => {
    expect(inspectResourceNetworkTarget(value)).toMatchObject({
      status: 'blocked',
      reason: 'local-network',
      localNetworkKind,
    });
  });

  it.each([
    'http://1.1.1.1/',
    'http://8.8.8.8/',
    'http://172.15.255.255/',
    'http://172.32.0.1/',
    'http://192.169.0.1/',
    'http://[2001:4860:4860::8888]/',
    'http://[::ffff:8.8.8.8]/',
  ])('does not over-block public IP target %s', (value) => {
    expect(inspectResourceNetworkTarget(value).status).toBe('eligible');
  });

  it('requires exact scheme and hostname permission without inheriting parent access', async () => {
    const contains = vi
      .fn<ResourceNetworkPermissionContains>()
      .mockImplementation(async ({ origins }) => origins[0] === 'https://example.com/*');

    await expect(
      checkResourceNetworkAccess('https://example.com/a', contains),
    ).resolves.toMatchObject({ status: 'allowed', permissionPattern: 'https://example.com/*' });
    await expect(
      checkResourceNetworkAccess('https://cdn.example.com/a', contains),
    ).resolves.toMatchObject({ status: 'blocked', reason: 'permission-denied' });
    await expect(
      checkResourceNetworkAccess('http://example.com/a', contains),
    ).resolves.toMatchObject({ status: 'blocked', reason: 'permission-denied' });
    expect(contains.mock.calls).toEqual([
      [{ origins: ['https://example.com/*'] }],
      [{ origins: ['https://cdn.example.com/*'] }],
      [{ origins: ['http://example.com/*'] }],
    ]);
  });

  it('does not query permissions for a statically blocked target and propagates API failure', async () => {
    const contains = vi.fn<ResourceNetworkPermissionContains>();
    await expect(checkResourceNetworkAccess('http://127.0.0.1/', contains)).resolves.toMatchObject({
      status: 'blocked',
      reason: 'local-network',
    });
    expect(contains).not.toHaveBeenCalled();

    await expect(
      checkResourceNetworkAccess('https://example.com/', async () => {
        throw new Error('permission unavailable');
      }),
    ).rejects.toThrow('permission unavailable');
  });

  it('checks original, each observed redirect target, and final URL with permission caching', async () => {
    const chain = metadata('https://a.example/start', 'https://c.example/final', [
      {
        fromUrl: 'https://a.example/start',
        toUrl: 'https://b.example/middle',
        httpStatus: 302,
      },
      {
        fromUrl: 'https://b.example/middle',
        toUrl: 'https://c.example/final',
        httpStatus: 307,
      },
    ]);
    const contains = vi.fn<ResourceNetworkPermissionContains>().mockResolvedValue(true);

    const result = await checkResourceResponseNetworkPolicy(chain, contains);

    expect(result).toMatchObject({ status: 'allowed' });
    if (result.status !== 'allowed') throw new Error('Expected an allowed chain.');
    expect(
      result.targets.map(({ stage, redirectIndex, hostname }) => ({
        stage,
        redirectIndex,
        hostname,
      })),
    ).toEqual([
      { stage: 'original', redirectIndex: null, hostname: 'a.example' },
      { stage: 'redirect', redirectIndex: 0, hostname: 'b.example' },
      { stage: 'redirect', redirectIndex: 1, hostname: 'c.example' },
      { stage: 'final', redirectIndex: null, hostname: 'c.example' },
    ]);
    expect(contains).toHaveBeenCalledTimes(3);
  });

  it('blocks an unauthorized redirect target and a local final URL', async () => {
    const unauthorized = metadata('https://a.example/start', 'https://b.example/final', [
      {
        fromUrl: 'https://a.example/start',
        toUrl: 'https://b.example/final',
        httpStatus: 302,
      },
    ]);
    await expect(
      checkResourceResponseNetworkPolicy(unauthorized, allow('https://a.example/*')),
    ).resolves.toMatchObject({
      status: 'blocked',
      stage: 'redirect',
      redirectIndex: 0,
      target: { reason: 'permission-denied' },
    });

    const localFinal = metadata('https://a.example/start', 'http://127.0.0.1/private');
    await expect(
      checkResourceResponseNetworkPolicy(localFinal, allow('https://a.example/*')),
    ).resolves.toMatchObject({
      status: 'blocked',
      stage: 'final',
      target: { reason: 'local-network', localNetworkKind: 'loopback' },
    });
  });

  it('rechecks the final URL when Fetch only exposes an incomplete redirect trace', async () => {
    const redirected = metadata('https://a.example/start', 'https://b.example/final');
    expect(redirected.redirectTrace.complete).toBe(false);
    await expect(
      checkResourceResponseNetworkPolicy(
        redirected,
        allow('https://a.example/*', 'https://b.example/*'),
      ),
    ).resolves.toMatchObject({ status: 'allowed' });
  });

  it('creates immutable credential-free Fetch options and preserves the signal', () => {
    const controller = new AbortController();
    const init = createSecureResourceFetchInit(controller.signal);
    expect(init).toEqual({
      method: 'GET',
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: controller.signal,
    });
    expect(Object.isFrozen(init)).toBe(true);
  });
});
