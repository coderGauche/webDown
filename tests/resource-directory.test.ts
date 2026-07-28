import { RESOURCE_TYPES, type ResourceType } from '@sitecapsule/domain';
import {
  ARCHIVE_ASSET_ROOT,
  RESOURCE_TYPE_DIRECTORIES,
  createResourceDirectoryMapping,
  createResourceOriginDirectory,
  getResourceTypeDirectory,
} from '@sitecapsule/archive';
import { describe, expect, it } from 'vitest';

describe('deterministic resource directories', () => {
  it('normalizes case, default HTTPS port, path, query, and fragment without changing origin folders', () => {
    const first = createResourceDirectoryMapping(
      'HTTPS://Example.COM:443/a/../assets/app.css?theme=dark#section',
      'stylesheet',
    );
    const second = createResourceDirectoryMapping(
      'https://example.com/another.css?theme=light',
      'stylesheet',
    );

    expect(first).toEqual({
      normalizedUrl: 'https://example.com/assets/app.css?theme=dark',
      origin: 'https://example.com',
      schemeDirectory: 'https',
      hostDirectory: 'dns-example.com',
      portDirectory: 'default',
      originDirectory: 'origins/https/dns-example.com/default',
      resourceType: 'stylesheet',
      typeDirectory: 'css',
      directoryPath: 'assets/origins/https/dns-example.com/default/css',
    });
    expect(second.originDirectory).toBe(first.originDirectory);
    expect(second.directoryPath).toBe(first.directoryPath);
  });

  it('keeps HTTP and HTTPS origins in separate deterministic directories', () => {
    const http = createResourceOriginDirectory('HTTP://Example.COM:80/a');
    const https = createResourceOriginDirectory('HTTPS://Example.COM:443/a');

    expect(http).toMatchObject({
      normalizedUrl: 'http://example.com/a',
      origin: 'http://example.com',
      originDirectory: 'origins/http/dns-example.com/default',
    });
    expect(https).toMatchObject({
      normalizedUrl: 'https://example.com/a',
      origin: 'https://example.com',
      originDirectory: 'origins/https/dns-example.com/default',
    });
    expect(http.originDirectory).not.toBe(https.originDirectory);
  });

  it('preserves non-default ports as a separate origin dimension', () => {
    const defaultPort = createResourceOriginDirectory('https://example.com/file');
    const customPort = createResourceOriginDirectory('https://example.com:8443/file');

    expect(customPort).toMatchObject({
      origin: 'https://example.com:8443',
      portDirectory: 'port-8443',
      originDirectory: 'origins/https/dns-example.com/port-8443',
    });
    expect(customPort.originDirectory).not.toBe(defaultPort.originDirectory);
  });

  it.each([
    [
      'https://203.0.113.10:9443/image.png',
      'ipv4-203.0.113.10',
      'origins/https/ipv4-203.0.113.10/port-9443',
    ],
    [
      'https://[2001:DB8::1]:9443/image.png',
      'ipv6-2001-db8--1',
      'origins/https/ipv6-2001-db8--1/port-9443',
    ],
  ])('creates a path-safe and typed host directory for %s', (url, hostDirectory, expected) => {
    expect(createResourceOriginDirectory(url)).toMatchObject({
      hostDirectory,
      originDirectory: expected,
    });
  });

  it.each(Object.entries(RESOURCE_TYPE_DIRECTORIES) as [ResourceType, string][])(
    'maps resource type %s to %s',
    (resourceType, expectedDirectory) => {
      expect(getResourceTypeDirectory(resourceType)).toBe(expectedDirectory);
      expect(
        createResourceDirectoryMapping('https://example.com/resource', resourceType).directoryPath,
      ).toBe(`${ARCHIVE_ASSET_ROOT}/origins/https/dns-example.com/default/${expectedDirectory}`);
    },
  );

  it('maps the unknown fallback resource type to other', () => {
    expect(getResourceTypeDirectory('other')).toBe('other');
  });

  it('is independent from discovery order and repeated evaluation', () => {
    const inputs: Array<[string, ResourceType]> = [
      ['https://cdn.example.test/app.js?one=1', 'script'],
      ['http://example.test:8080/photo.png', 'image'],
      ['https://[2001:db8::2]/font.woff2', 'font'],
    ];
    const forward = new Map(
      inputs.map(([url, type]) => [`${url}|${type}`, createResourceDirectoryMapping(url, type)]),
    );
    const reverse = new Map(
      [...inputs]
        .reverse()
        .map(([url, type]) => [`${url}|${type}`, createResourceDirectoryMapping(url, type)]),
    );

    expect(reverse).toEqual(forward);
    for (const [url, type] of inputs) {
      expect(createResourceDirectoryMapping(url, type)).toEqual(
        createResourceDirectoryMapping(url, type),
      );
    }
  });

  it.each([
    ['', 'absolute URL'],
    ['not-a-url', 'absolute URL'],
    ['data:text/plain,hello', 'HTTP and HTTPS'],
    ['blob:https://example.com/id', 'HTTP and HTTPS'],
    ['file:///tmp/archive', 'HTTP and HTTPS'],
    ['https://alice:secret@example.com/private', 'must not contain credentials'],
  ])('rejects unsupported URL %s', (url, expectedMessage) => {
    expect(() => createResourceOriginDirectory(url)).toThrow(expectedMessage);
  });

  it('rejects values outside the stable resource type vocabulary', () => {
    expect(RESOURCE_TYPES).toHaveLength(13);
    expect(() => getResourceTypeDirectory('binary')).toThrow('Resource type is not supported');
  });
});
