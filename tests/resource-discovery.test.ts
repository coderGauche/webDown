import type {
  CssResourceCandidate,
  DomResourceCandidate,
  SvgResourceCandidate,
} from '@sitecapsule/discovery';
import {
  isMergedResourceCandidate,
  isMergedResourceCandidates,
  mergeResourceCandidates,
  type PerformanceResourceRecord,
} from '@sitecapsule/page';
import { describe, expect, it } from 'vitest';

const DOCUMENT_URL = 'https://site.example.test/page';
const BASE_URL = 'https://cdn.example.test/assets/';

function domResource(resolvedUrl: string, rawUrl = resolvedUrl): DomResourceCandidate {
  return {
    source: 'dom',
    tagName: 'img',
    attributeName: 'src',
    attributeValue: rawUrl,
    rawUrl,
    resolvedUrl,
    documentUrl: DOCUMENT_URL,
    baseUrl: BASE_URL,
  };
}

function svgResource(resolvedUrl: string, ordinal = 1): SvgResourceCandidate {
  return {
    source: 'svg',
    ordinal,
    tagName: 'image',
    attributeName: 'href',
    attributeValue: resolvedUrl,
    rawUrl: resolvedUrl,
    resolvedUrl,
    documentUrl: DOCUMENT_URL,
    baseUrl: BASE_URL,
  };
}

function cssResource(resolvedUrl: string, ordinal = 1): CssResourceCandidate {
  return {
    source: 'css',
    kind: 'url',
    ordinal,
    cssSourceOrdinal: 1,
    cssSourceType: 'style-element',
    tagName: 'style',
    attributeName: null,
    propertyName: 'background-image',
    rawUrl: resolvedUrl,
    resolvedUrl,
    fontFormat: null,
    location: {
      startOffset: 0,
      endOffset: 12,
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 13,
    },
    documentUrl: DOCUMENT_URL,
    baseUrl: BASE_URL,
  };
}

function performanceResource(url: string): PerformanceResourceRecord {
  return {
    url,
    initiatorType: 'img',
    startTimeMs: 5,
    durationMs: 10,
    transferSize: 100,
    encodedBodySize: 90,
    decodedBodySize: 120,
  };
}

describe('merged resource discovery', () => {
  it('groups normalized URLs across every channel while retaining all evidence', () => {
    const url = 'https://cdn.example.test/assets/shared.png?v=2#crop';
    const normalizedUrl = 'https://cdn.example.test/assets/shared.png?v=2';
    const merged = mergeResourceCandidates({
      domResources: [domResource(url)],
      svgResources: [svgResource(url)],
      cssResources: [cssResource(url)],
      performanceResources: [performanceResource(url)],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      ordinal: 1,
      url: normalizedUrl,
      discoverySources: ['dom', 'css', 'performance'],
    });
    expect(
      merged[0]?.evidence.map(({ source, channel, sourceOrdinal }) => ({
        source,
        channel,
        sourceOrdinal,
      })),
    ).toEqual([
      { source: 'dom', channel: 'dom-attribute', sourceOrdinal: 1 },
      { source: 'dom', channel: 'svg-attribute', sourceOrdinal: 1 },
      { source: 'css', channel: 'css-ast', sourceOrdinal: 1 },
      { source: 'performance', channel: 'performance', sourceOrdinal: 1 },
    ]);
    expect(isMergedResourceCandidates(merged)).toBe(true);
  });

  it('keeps deterministic first-seen URL and channel order', () => {
    const first = 'https://cdn.example.test/a.png';
    const second = 'https://cdn.example.test/b.png';
    const third = 'https://cdn.example.test/c.svg#symbol';
    const fourth = 'https://cdn.example.test/d.js';
    const input = {
      domResources: [domResource(first), domResource(second)],
      svgResources: [svgResource(third)],
      cssResources: [cssResource(second)],
      performanceResources: [performanceResource(fourth), performanceResource(first)],
    };

    const merged = mergeResourceCandidates(input);
    expect(mergeResourceCandidates(input)).toEqual(merged);
    expect(merged.map(({ ordinal, url }) => ({ ordinal, url }))).toEqual([
      { ordinal: 1, url: first },
      { ordinal: 2, url: second },
      { ordinal: 3, url: 'https://cdn.example.test/c.svg' },
      { ordinal: 4, url: fourth },
    ]);
    expect(merged.map((resource) => resource.evidence.length)).toEqual([2, 2, 1, 1]);
  });

  it('returns an empty list for empty discovery channels', () => {
    expect(
      mergeResourceCandidates({
        domResources: [],
        svgResources: [],
        cssResources: [],
        performanceResources: [],
      }),
    ).toEqual([]);
    expect(isMergedResourceCandidates([])).toBe(true);
  });

  it('merges fragment variants but keeps distinct query strings', () => {
    const base = 'https://cdn.example.test/icon.svg?theme=dark';
    const otherQuery = 'https://cdn.example.test/icon.svg?theme=light#symbol';
    const merged = mergeResourceCandidates({
      domResources: [domResource(`${base}#first`), domResource(otherQuery)],
      svgResources: [],
      cssResources: [cssResource(`${base}#second`)],
      performanceResources: [performanceResource(base)],
    });

    expect(merged.map(({ url, evidence }) => ({ url, evidenceCount: evidence.length }))).toEqual([
      { url: base, evidenceCount: 3 },
      { url: 'https://cdn.example.test/icon.svg?theme=light', evidenceCount: 1 },
    ]);
    expect(
      merged[0]?.evidence.map((item) =>
        item.source === 'performance' ? item.candidate.url : item.candidate.resolvedUrl,
      ),
    ).toEqual([`${base}#first`, `${base}#second`, base]);
  });

  it('rejects malformed, mismatched, duplicate, and unstable merged records', () => {
    const url = 'https://cdn.example.test/shared.png';
    const [record] = mergeResourceCandidates({
      domResources: [domResource(url)],
      svgResources: [],
      cssResources: [],
      performanceResources: [performanceResource(url)],
    });
    expect(record).toBeDefined();
    if (!record) throw new Error('Missing merged resource fixture.');

    expect(isMergedResourceCandidate(record)).toBe(true);
    expect(
      isMergedResourceCandidate({ ...record, url: 'https://cdn.example.test/other.png' }),
    ).toBe(false);
    expect(isMergedResourceCandidate({ ...record, discoverySources: ['performance', 'dom'] })).toBe(
      false,
    );
    expect(
      isMergedResourceCandidate({ ...record, evidence: [...record.evidence, record.evidence[0]] }),
    ).toBe(false);
    expect(isMergedResourceCandidate({ ...record, unexpected: true })).toBe(false);
    expect(isMergedResourceCandidates([{ ...record, ordinal: 2 }])).toBe(false);
    expect(isMergedResourceCandidates([record, { ...record, ordinal: 2 }])).toBe(false);
  });
});
