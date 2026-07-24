import { isNormalizedResourceUrl, normalizeResourceUrl } from '@sitecapsule/page';
import { describe, expect, it } from 'vitest';

describe('resource URL normalization', () => {
  it('resolves relative paths and applies WHATWG host, port, and dot-segment normalization', () => {
    expect(normalizeResourceUrl('../img/icon.svg', 'HTTPS://EXAMPLE.test:443/a/b/')).toBe(
      'https://example.test/a/img/icon.svg',
    );
    expect(normalizeResourceUrl('HTTP://EXAMPLE.TEST:80/a/../b?q=1#section')).toBe(
      'http://example.test/b?q=1',
    );
  });

  it('removes network fragments while preserving query order, values, and empty entries', () => {
    expect(normalizeResourceUrl('https://example.test/app.js?b=2&a=A%2fb&a=3&empty=#module')).toBe(
      'https://example.test/app.js?b=2&a=A%2fb&a=3&empty=',
    );
    expect(normalizeResourceUrl('https://example.test/app.js?x=1#one')).toBe(
      normalizeResourceUrl('https://example.test/app.js?x=1#two'),
    );
    expect(normalizeResourceUrl('https://example.test/app.js?x=1')).not.toBe(
      normalizeResourceUrl('https://example.test/app.js?x=2'),
    );
  });

  it('uppercases path percent escapes without decoding them or changing query escapes', () => {
    expect(
      normalizeResourceUrl('../img/%7eicon%2f.svg?token=A%2fb', 'https://example.test/a/b/'),
    ).toBe('https://example.test/a/img/%7Eicon%2F.svg?token=A%2fb');
    expect(normalizeResourceUrl('https://example.test/%7easset')).not.toBe(
      normalizeResourceUrl('https://example.test/~asset'),
    );
  });

  it('leaves non-network fragments intact for later protocol classification', () => {
    expect(normalizeResourceUrl('data:image/svg+xml,%3Csvg%3E#paint')).toBe(
      'data:image/svg+xml,%3Csvg%3E#paint',
    );
    expect(normalizeResourceUrl('blob:https://example.test/id#part')).toBe(
      'blob:https://example.test/id#part',
    );
  });

  it('rejects empty and invalid inputs and recognizes normalized values', () => {
    expect(normalizeResourceUrl('   ')).toBeNull();
    expect(normalizeResourceUrl('relative.png')).toBeNull();
    expect(normalizeResourceUrl('http://[invalid')).toBeNull();
    expect(isNormalizedResourceUrl('https://example.test/image.png?q=1')).toBe(true);
    expect(isNormalizedResourceUrl('https://EXAMPLE.test:443/image.png#crop')).toBe(false);
    expect(isNormalizedResourceUrl('https://example.test/%7eimage.png')).toBe(false);
  });
});
