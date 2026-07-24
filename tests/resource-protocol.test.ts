import {
  classifyResourceUrl,
  isResourceUrlClassification,
  matchesResourceUrlClassification,
} from '@sitecapsule/page';
import { describe, expect, it } from 'vitest';

describe('resource protocol classification', () => {
  it('classifies normalized HTTP and HTTPS URLs as network-fetch eligible', () => {
    expect(classifyResourceUrl('  HTTPS://EXAMPLE.test:443/a/../asset.js#module  ')).toEqual({
      kind: 'network',
      protocol: 'https:',
      networkFetchEligible: true,
    });
    expect(classifyResourceUrl('http://example.test/image.png')).toEqual({
      kind: 'network',
      protocol: 'http:',
      networkFetchEligible: true,
    });
  });

  it('preserves data headers and identifies percent and base64 encodings', () => {
    expect(classifyResourceUrl('data:image/svg+xml;charset=utf-8,%3Csvg%3E#paint')).toEqual({
      kind: 'data',
      protocol: 'data:',
      networkFetchEligible: false,
      header: 'image/svg+xml;charset=utf-8',
      encoding: 'percent-encoded',
    });
    expect(classifyResourceUrl('data:application/octet-stream;BASE64,AAAA')).toEqual({
      kind: 'data',
      protocol: 'data:',
      networkFetchEligible: false,
      header: 'application/octet-stream;BASE64',
      encoding: 'base64',
    });
    expect(classifyResourceUrl('data:,')).toEqual({
      kind: 'data',
      protocol: 'data:',
      networkFetchEligible: false,
      header: '',
      encoding: 'percent-encoded',
    });
  });

  it('marks malformed data URLs as unsupported without attempting MIME inference', () => {
    expect(classifyResourceUrl('data:text/plain')).toEqual({
      kind: 'unsupported',
      protocol: 'data:',
      networkFetchEligible: false,
      reason: 'malformed-data-url',
    });
  });

  it('marks valid Blob URLs as document-session-bound and rejects malformed forms', () => {
    for (const value of ['blob:https://example.test/id#part', 'blob:null/runtime-id']) {
      expect(classifyResourceUrl(value)).toEqual({
        kind: 'blob',
        protocol: 'blob:',
        networkFetchEligible: false,
        limitation: 'document-session-bound',
      });
    }
    for (const value of ['blob:', 'blob:https://example.test/']) {
      expect(classifyResourceUrl(value)).toEqual({
        kind: 'unsupported',
        protocol: 'blob:',
        networkFetchEligible: false,
        reason: 'malformed-blob-url',
      });
    }
  });

  it('keeps browser-internal, file, FTP, script, and custom protocols out of network fetches', () => {
    const classifications = [
      'chrome://extensions/',
      'chrome-extension://abcdefghijklmnop/icon.png',
      'file:///tmp/archive.html',
      'ftp://example.test/file.bin',
      'javascript:alert(1)',
      'custom:asset',
    ].map((url) => classifyResourceUrl(url));

    expect(classifications.map((classification) => classification?.kind)).toEqual(
      Array(6).fill('unsupported'),
    );
    expect(
      classifications.every((classification) => classification?.networkFetchEligible === false),
    ).toBe(true);
    expect(classifications.map((classification) => classification?.protocol)).toEqual([
      'chrome:',
      'chrome-extension:',
      'file:',
      'ftp:',
      'javascript:',
      'custom:',
    ]);
  });

  it('strictly validates classifications against their URL', () => {
    const network = classifyResourceUrl('https://example.test/app.js');
    expect(isResourceUrlClassification(network)).toBe(true);
    expect(matchesResourceUrlClassification(network, 'https://example.test/app.js')).toBe(true);
    expect(
      matchesResourceUrlClassification(
        { kind: 'network', protocol: 'http:', networkFetchEligible: true },
        'https://example.test/app.js',
      ),
    ).toBe(false);
    expect(
      isResourceUrlClassification({
        kind: 'unsupported',
        protocol: 'data:',
        networkFetchEligible: false,
        reason: 'unsupported-protocol',
      }),
    ).toBe(false);
    expect(classifyResourceUrl('not a URL')).toBeNull();
  });
});
