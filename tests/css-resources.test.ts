import {
  discoverCssResources,
  isCssResourceCandidate,
  type EmbeddedCssSource,
} from '@sitecapsule/discovery';
import { describe, expect, it } from 'vitest';

const DOCUMENT_URL = 'https://site.example.test/gallery/page.html';
const BASE_URL = 'https://cdn.example.test/assets/';

function styleElement(cssText: string, ordinal = 1): EmbeddedCssSource {
  return {
    source: 'style-element',
    ordinal,
    tagName: 'style',
    cssText,
    documentUrl: DOCUMENT_URL,
    baseUrl: BASE_URL,
  };
}

describe('CSS AST resource discovery', () => {
  it('extracts url(), @import, and @font-face sources in source order', () => {
    const candidates = discoverCssResources([
      styleElement(`
        @import "./theme.css" screen;
        @font-face {
          font-family: Archive;
          src: url('./archive.woff2') format("woff2"), url(./archive.woff) format(woff);
        }
        .hero {
          background-image: url("../images/hero image.png?size=2#crop");
          mask-image: url(./icons/my\\ image.svg);
        }
      `),
    ]);

    expect(
      candidates.map(({ kind, rawUrl, fontFormat }) => ({ kind, rawUrl, fontFormat })),
    ).toEqual([
      { kind: 'import', rawUrl: './theme.css', fontFormat: null },
      { kind: 'font-face', rawUrl: './archive.woff2', fontFormat: 'woff2' },
      { kind: 'font-face', rawUrl: './archive.woff', fontFormat: 'woff' },
      { kind: 'url', rawUrl: '../images/hero image.png?size=2#crop', fontFormat: null },
      { kind: 'url', rawUrl: './icons/my image.svg', fontFormat: null },
    ]);
    expect(candidates.map((candidate) => candidate.resolvedUrl)).toEqual([
      'https://cdn.example.test/assets/theme.css',
      'https://cdn.example.test/assets/archive.woff2',
      'https://cdn.example.test/assets/archive.woff',
      'https://cdn.example.test/images/hero%20image.png?size=2#crop',
      'https://cdn.example.test/assets/icons/my%20image.svg',
    ]);
    expect(candidates.every(isCssResourceCandidate)).toBe(true);
    expect(candidates[0]?.location).toEqual({
      startOffset: 17,
      endOffset: 30,
      startLine: 2,
      startColumn: 17,
      endLine: 2,
      endColumn: 30,
    });
  });

  it('uses declaration-list and value contexts for inline and SVG presentation CSS', () => {
    const candidates = discoverCssResources([
      {
        source: 'style-attribute',
        ordinal: 1,
        tagName: 'main',
        attributeName: 'style',
        cssText: `background: url( './inline image.png' ); cursor: url(cursors/pointer.cur), auto`,
        documentUrl: DOCUMENT_URL,
        baseUrl: BASE_URL,
      },
      {
        source: 'svg-presentation-attribute',
        ordinal: 2,
        tagName: 'image',
        attributeName: 'filter',
        cssText: 'url(./effects.svg#soften)',
        documentUrl: DOCUMENT_URL,
        baseUrl: BASE_URL,
      },
    ]);

    expect(
      candidates.map(({ cssSourceType, attributeName, propertyName, rawUrl }) => ({
        cssSourceType,
        attributeName,
        propertyName,
        rawUrl,
      })),
    ).toEqual([
      {
        cssSourceType: 'style-attribute',
        attributeName: 'style',
        propertyName: 'background',
        rawUrl: './inline image.png',
      },
      {
        cssSourceType: 'style-attribute',
        attributeName: 'style',
        propertyName: 'cursor',
        rawUrl: 'cursors/pointer.cur',
      },
      {
        cssSourceType: 'svg-presentation-attribute',
        attributeName: 'filter',
        propertyName: null,
        rawUrl: './effects.svg#soften',
      },
    ]);
  });

  it('retains data URLs and resolves document fragments without classifying protocols', () => {
    const candidates = discoverCssResources([
      styleElement(`
        .embedded { background: url("data:image/svg+xml,%3Csvg%3E%3C/svg%3E"); }
        .local { filter: url(#blur); }
      `),
    ]);

    expect(candidates.map(({ rawUrl, resolvedUrl }) => ({ rawUrl, resolvedUrl }))).toEqual([
      {
        rawUrl: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
        resolvedUrl: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
      },
      {
        rawUrl: '#blur',
        resolvedUrl: 'https://cdn.example.test/assets/#blur',
      },
    ]);
  });

  it('isolates malformed CSS and rejects malformed serialized candidates', () => {
    const candidates = discoverCssResources([
      styleElement('@import url("unterminated); .broken { background: url(', 1),
      styleElement('.valid { background: url(./valid.png) }', 2),
    ]);

    expect(candidates).toHaveLength(1);
    const candidate = candidates[0];
    expect(candidate).toMatchObject({
      ordinal: 1,
      cssSourceOrdinal: 2,
      rawUrl: './valid.png',
    });
    expect(isCssResourceCandidate(candidate)).toBe(true);
    expect(isCssResourceCandidate({ ...candidate, ordinal: 0 })).toBe(false);
    expect(isCssResourceCandidate({ ...candidate, resolvedUrl: './valid.png' })).toBe(false);
    expect(isCssResourceCandidate({ ...candidate, attributeName: 'onclick' })).toBe(false);
    expect(isCssResourceCandidate({ ...candidate, attributeName: 'style' })).toBe(false);
    expect(isCssResourceCandidate({ ...candidate, kind: 'import' })).toBe(false);
    expect(isCssResourceCandidate({ ...candidate, unexpected: true })).toBe(false);
  });
});
