import { readPageMetadata, type PageMetadataSource } from '@sitecapsule/page';
import { describe, expect, it } from 'vitest';

describe('page metadata', () => {
  it('reads the title, resolved base URL, and final document URL independently', () => {
    const source: PageMetadataSource = {
      title: 'Redirected product page',
      baseURI: 'https://static.example.com/assets/',
      URL: 'https://www.example.com/products/final',
    };

    expect(readPageMetadata(source, 'https://www.example.com/products/current')).toEqual({
      title: 'Redirected product page',
      tabUrl: 'https://www.example.com/products/current',
      baseUrl: 'https://static.example.com/assets/',
      finalUrl: 'https://www.example.com/products/final',
    });
  });

  it('preserves an empty document title without substituting display text', () => {
    expect(
      readPageMetadata({
        title: '',
        baseURI: 'https://example.com/',
        URL: 'https://example.com/',
      }),
    ).toEqual({
      title: '',
      tabUrl: 'https://example.com/',
      baseUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
    });
  });
});
