import type { CssResourceCandidate, DomResourceCandidate } from '@sitecapsule/discovery';
import {
  inferResourceMetadata,
  isResourceMetadataInference,
  matchesResourceMetadataInference,
  type PerformanceResourceRecord,
  type ResourceDiscoveryEvidence,
} from '@sitecapsule/page';
import { describe, expect, it } from 'vitest';

const DOCUMENT_URL = 'https://example.test/page';
const BASE_URL = 'https://example.test/assets/';

function domEvidence(
  tagName: string,
  url: string,
  attributeName: DomResourceCandidate['attributeName'] = 'src',
): ResourceDiscoveryEvidence {
  return {
    source: 'dom',
    channel: 'dom-attribute',
    sourceOrdinal: 1,
    candidate: {
      source: 'dom',
      tagName,
      attributeName,
      attributeValue: url,
      rawUrl: url,
      resolvedUrl: url,
      documentUrl: DOCUMENT_URL,
      baseUrl: BASE_URL,
    },
  };
}

function cssEvidence(
  kind: CssResourceCandidate['kind'],
  url: string,
  propertyName: string | null = null,
): ResourceDiscoveryEvidence {
  return {
    source: 'css',
    channel: 'css-ast',
    sourceOrdinal: 1,
    candidate: {
      source: 'css',
      kind,
      ordinal: 1,
      cssSourceOrdinal: 1,
      cssSourceType: 'style-element',
      tagName: 'style',
      attributeName: null,
      propertyName: kind === 'font-face' ? 'src' : propertyName,
      rawUrl: url,
      resolvedUrl: url,
      fontFormat: kind === 'font-face' ? 'woff2' : null,
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
    },
  };
}

function performanceEvidence(
  initiatorType: PerformanceResourceRecord['initiatorType'],
  url: string,
): ResourceDiscoveryEvidence {
  return {
    source: 'performance',
    channel: 'performance',
    sourceOrdinal: 1,
    candidate: {
      url,
      initiatorType,
      startTimeMs: 1,
      durationMs: 2,
      transferSize: 3,
      encodedBodySize: 3,
      decodedBodySize: 3,
    },
  };
}

describe('resource type and MIME inference', () => {
  it.each([
    ['script', domEvidence('script', 'https://example.test/api/module'), 'script'],
    ['image', domEvidence('img', 'https://example.test/api/hero'), 'image'],
    ['video', domEvidence('video', 'https://example.test/api/movie'), 'video'],
    ['audio', domEvidence('audio', 'https://example.test/api/sound'), 'audio'],
    ['document', domEvidence('iframe', 'https://example.test/api/frame'), 'document'],
    ['stylesheet', cssEvidence('import', 'https://example.test/api/theme'), 'stylesheet'],
    ['font', cssEvidence('font-face', 'https://example.test/api/archive'), 'font'],
    [
      'CSS image',
      cssEvidence('url', 'https://example.test/api/background', 'background-image'),
      'image',
    ],
  ])('infers %s from semantic context without inventing a MIME hint', (_label, evidence, type) => {
    const result = inferResourceMetadata(
      evidence.source === 'performance' ? evidence.candidate.url : evidence.candidate.resolvedUrl,
      [evidence],
    );

    expect(result.resourceType).toBe(type);
    expect(result.resourceTypeConfidence).toBe('high');
    expect(result.mimeTypeHint).toBeNull();
    expect(result.hasConflict).toBe(false);
  });

  it('uses Performance initiators as medium-confidence context', () => {
    const url = 'https://example.test/runtime/no-extension';
    const result = inferResourceMetadata(url, [performanceEvidence('script', url)]);

    expect(result).toMatchObject({
      resourceType: 'script',
      resourceTypeSource: 'performance-initiator',
      resourceTypeConfidence: 'medium',
      mimeTypeHint: null,
      hasConflict: false,
    });
  });

  it.each([
    ['site.css', 'stylesheet', 'text/css'],
    ['hero.png', 'image', 'image/png'],
    ['archive.woff2', 'font', 'font/woff2'],
    ['movie.mp4', 'video', 'video/mp4'],
    ['sound.mp3', 'audio', 'audio/mpeg'],
    ['index.html', 'document', 'text/html'],
    ['config.json', 'data', 'application/json'],
    ['runtime.wasm', 'wasm', 'application/wasm'],
    ['scene.glb', 'model', 'model/gltf-binary'],
    ['surface.ktx2', 'texture', 'image/ktx2'],
    ['captions.vtt', 'data', 'text/vtt'],
  ])('uses %s only as a low-confidence type and MIME hint', (fileName, type, mimeTypeHint) => {
    const result = inferResourceMetadata(`https://example.test/${fileName}`, []);

    expect(result).toMatchObject({
      resourceType: type,
      resourceTypeSource: 'url-extension',
      resourceTypeConfidence: 'low',
      mimeTypeHint,
      mimeTypeHintSource: 'url-extension',
      mimeTypeHintConfidence: 'low',
    });
  });

  it('uses declared and default data URL media types without calling them response MIME', () => {
    expect(inferResourceMetadata('data:image/svg+xml,%3Csvg%3E', [])).toMatchObject({
      resourceType: 'image',
      resourceTypeSource: 'data-url-header',
      resourceTypeConfidence: 'high',
      mimeTypeHint: 'image/svg+xml',
      mimeTypeHintSource: 'data-url-header',
      mimeTypeHintConfidence: 'high',
    });
    expect(inferResourceMetadata('data:,plain', [])).toMatchObject({
      resourceType: 'data',
      resourceTypeConfidence: 'medium',
      mimeTypeHint: 'text/plain',
      mimeTypeHintConfidence: 'medium',
    });
    expect(inferResourceMetadata('data:not-a-media-type,plain', [])).toEqual({
      resourceType: 'other',
      resourceTypeSource: null,
      resourceTypeConfidence: 'unknown',
      mimeTypeHint: null,
      mimeTypeHintSource: null,
      mimeTypeHintConfidence: 'unknown',
      hasConflict: false,
      evidence: [],
    });
  });

  it('falls back to other/unknown when no evidence is reliable', () => {
    expect(inferResourceMetadata('https://example.test/resource', [])).toEqual({
      resourceType: 'other',
      resourceTypeSource: null,
      resourceTypeConfidence: 'unknown',
      mimeTypeHint: null,
      mimeTypeHintSource: null,
      mimeTypeHintConfidence: 'unknown',
      hasConflict: false,
      evidence: [],
    });
  });

  it('keeps conflicting evidence and suppresses a contradictory extension MIME hint', () => {
    const url = 'https://example.test/disguised.png';
    const result = inferResourceMetadata(url, [domEvidence('script', url)]);

    expect(result).toMatchObject({
      resourceType: 'script',
      resourceTypeSource: 'dom-context',
      resourceTypeConfidence: 'high',
      mimeTypeHint: null,
      mimeTypeHintSource: null,
      mimeTypeHintConfidence: 'unknown',
      hasConflict: true,
    });
    expect(result.evidence).toEqual([
      {
        source: 'dom-context',
        resourceType: 'script',
        mimeTypeHint: null,
        confidence: 'high',
        detail: 'dom:dom-attribute',
      },
      {
        source: 'url-extension',
        resourceType: 'image',
        mimeTypeHint: 'image/png',
        confidence: 'low',
        detail: 'extension:.png',
      },
    ]);
  });

  it('deduplicates inference summaries while leaving graph provenance to retain every discovery', () => {
    const url = 'https://example.test/image';
    const evidence = domEvidence('img', url);
    const result = inferResourceMetadata(url, [evidence, { ...evidence, sourceOrdinal: 2 }]);

    expect(result.evidence).toHaveLength(1);
    expect(result).toMatchObject({
      resourceType: 'image',
      resourceTypeConfidence: 'high',
      hasConflict: false,
    });
    expect(isResourceMetadataInference(result)).toBe(true);
  });

  it('strictly validates the inference and rejects stale results', () => {
    const url = 'https://example.test/app.js';
    const evidence = [domEvidence('script', url)];
    const result = inferResourceMetadata(url, evidence);

    expect(isResourceMetadataInference(result)).toBe(true);
    expect(matchesResourceMetadataInference(result, url, evidence)).toBe(true);
    expect(isResourceMetadataInference({ ...result, resourceType: 'font' })).toBe(false);
    expect(matchesResourceMetadataInference(result, 'https://example.test/app.png', evidence)).toBe(
      false,
    );
  });
});
