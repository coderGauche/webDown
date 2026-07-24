// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { capturePageSnapshot, isResourceGraph } from '@sitecapsule/page';
import { afterEach, describe, expect, it, vi } from 'vitest';

const DOCUMENT_URL = `${window.location.origin}/catalog/sections/page.html#view`;
const THEME_URL = 'https://cdn.example.test/assets/v1/theme.css?mode=dark&mode=contrast';
const DATA_URL = 'data:image/svg+xml,%3Csvg%3E,%3C/svg%3E';
const HERO_URL = 'https://cdn.example.test/assets/images/hero%20large.png?width=640&width=1280';
const FONT_URL = 'https://cdn.example.test/assets/fonts/archive.woff2?v=1';
const FALLBACK_URL = 'https://cdn.example.test/assets/v1/fallback%20image.png?x=%2f';
function readFixture(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function loadFixture(markup: string): void {
  window.history.replaceState({}, '', DOCUMENT_URL);
  document.open();
  document.write(markup);
  document.close();
}

function resourceEntry(
  name: string,
  initiatorType: string,
  startTime: number,
): PerformanceResourceTiming {
  return {
    name,
    entryType: 'resource',
    initiatorType,
    startTime,
    duration: 8,
    transferSize: 512,
    encodedBodySize: 384,
    decodedBodySize: 768,
  } as PerformanceResourceTiming;
}

function mockResourceTiming(): void {
  vi.spyOn(window.performance, 'getEntriesByType').mockImplementation((type) =>
    type === 'resource'
      ? [
          resourceEntry(`${THEME_URL}#runtime`, 'link', 1),
          resourceEntry(`${HERO_URL}#runtime`, 'img', 2),
          resourceEntry(`${FONT_URL}#runtime`, 'css', 3),
        ]
      : [],
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  document.open();
  document.write('<!doctype html><html><head></head><body></body></html>');
  document.close();
});

describe('M4 complex resource pipeline', () => {
  it('preserves complex srcset candidates through normalization and provenance tracking', () => {
    loadFixture(readFixture('./fixtures/resource-pipeline/index.html'));
    mockResourceTiming();

    const snapshot = capturePageSnapshot(document, DOCUMENT_URL);
    const srcsetResources = snapshot.domResources.filter(
      (resource) => resource.attributeName === 'srcset',
    );

    expect(
      srcsetResources.map(({ rawUrl, resolvedUrl, descriptor }) => ({
        rawUrl,
        resolvedUrl,
        descriptor,
      })),
    ).toEqual([
      {
        rawUrl: DATA_URL,
        resolvedUrl: DATA_URL,
        descriptor: '1x',
      },
      {
        rawUrl: '../images/hero%20large.png?width=640&width=1280#mobile',
        resolvedUrl: `${HERO_URL}#mobile`,
        descriptor: '640w',
      },
      {
        rawUrl: '../images/hero%20large.png?width=640&width=1280#retina',
        resolvedUrl: `${HERO_URL}#retina`,
        descriptor: '2x',
      },
      {
        rawUrl: './fallback%20image.png?x=%2f#dom',
        resolvedUrl: `${FALLBACK_URL}#dom`,
        descriptor: '3x',
      },
    ]);

    expect(snapshot.mergedResources.map((resource) => resource.url)).toEqual([
      DATA_URL,
      HERO_URL,
      FONT_URL,
      FALLBACK_URL,
      THEME_URL,
    ]);
    expect(snapshot.resourceGraph.nodes.map((node) => node.url)).toEqual(
      snapshot.mergedResources.map((resource) => resource.url),
    );

    const heroEdges = snapshot.resourceGraph.edges.filter((edge) => edge.targetUrl === HERO_URL);
    expect(
      heroEdges.map(({ channel, sourceOrdinal, evidence }) => ({
        channel,
        sourceOrdinal,
        observedUrl:
          evidence.source === 'performance'
            ? evidence.candidate.url
            : evidence.candidate.resolvedUrl,
      })),
    ).toEqual([
      {
        channel: 'dom-attribute',
        sourceOrdinal: 2,
        observedUrl: `${HERO_URL}#mobile`,
      },
      {
        channel: 'dom-attribute',
        sourceOrdinal: 4,
        observedUrl: `${HERO_URL}#retina`,
      },
      {
        channel: 'css-ast',
        sourceOrdinal: 3,
        observedUrl: `${HERO_URL}#css`,
      },
      {
        channel: 'performance',
        sourceOrdinal: 2,
        observedUrl: HERO_URL,
      },
    ]);
    expect(isResourceGraph(snapshot.resourceGraph)).toBe(true);
  });

  it('parses nested CSS and retains duplicate and conflicting inference evidence', () => {
    loadFixture(readFixture('./fixtures/resource-pipeline/index.html'));
    mockResourceTiming();

    const snapshot = capturePageSnapshot(document, DOCUMENT_URL);

    expect(
      snapshot.cssResources.map(({ kind, rawUrl, resolvedUrl, fontFormat }) => ({
        kind,
        rawUrl,
        resolvedUrl,
        fontFormat,
      })),
    ).toEqual([
      {
        kind: 'import',
        rawUrl: './css/../theme.css?mode=dark&mode=contrast#sheet',
        resolvedUrl: `${THEME_URL}#sheet`,
        fontFormat: null,
      },
      {
        kind: 'font-face',
        rawUrl: '../fonts/archive.woff2?v=1#font',
        resolvedUrl: `${FONT_URL}#font`,
        fontFormat: 'woff2',
      },
      {
        kind: 'url',
        rawUrl: '../images/hero%20large.png?width=640&width=1280#css',
        resolvedUrl: `${HERO_URL}#css`,
        fontFormat: null,
      },
      {
        kind: 'url',
        rawUrl: './fallback image.png?x=%2f#css',
        resolvedUrl: `${FALLBACK_URL}#css`,
        fontFormat: null,
      },
    ]);

    const evidenceCountByUrl = Object.fromEntries(
      snapshot.mergedResources.map((resource) => [resource.url, resource.evidence.length]),
    );
    expect(evidenceCountByUrl).toEqual({
      [THEME_URL]: 2,
      [DATA_URL]: 1,
      [HERO_URL]: 4,
      [FONT_URL]: 3,
      [FALLBACK_URL]: 2,
    });
    expect(snapshot.resourceGraph.edges).toHaveLength(12);

    const fontNode = snapshot.resourceGraph.nodes.find((node) => node.url === FONT_URL);
    expect(fontNode?.inference).toMatchObject({
      resourceType: 'image',
      resourceTypeSource: 'dom-context',
      resourceTypeConfidence: 'high',
      mimeTypeHint: null,
      mimeTypeHintSource: null,
      mimeTypeHintConfidence: 'unknown',
      hasConflict: true,
    });
    expect(
      fontNode?.inference.evidence.map(({ source, resourceType, confidence }) => ({
        source,
        resourceType,
        confidence,
      })),
    ).toEqual([
      { source: 'dom-context', resourceType: 'image', confidence: 'high' },
      { source: 'css-context', resourceType: 'font', confidence: 'high' },
      { source: 'url-extension', resourceType: 'font', confidence: 'low' },
    ]);

    expect(capturePageSnapshot(document, DOCUMENT_URL)).toEqual(snapshot);
  });
});
