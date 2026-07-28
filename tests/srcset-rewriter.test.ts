import {
  createResourcePathMappings,
  rewriteSrcsetResource,
  type ResourcePathInput,
} from '@sitecapsule/archive';
import { describe, expect, it } from 'vitest';

const BASE_URL = 'https://cdn.example.test/assets/';
const DOCUMENT_PATH = 'assets/origins/https/dns-page.example.test/default/documents/index.html';

async function savedMappings(inputs: readonly ResourcePathInput[]) {
  return createResourcePathMappings(inputs);
}

describe('srcset archive URL rewriting', () => {
  it('rewrites mapped candidates in place while preserving layout and descriptors', async () => {
    const heroUrl = 'https://cdn.example.test/assets/images/hero.png?width=640';
    const retinaUrl = 'https://cdn.example.test/assets/images/retina.png';
    const mappings = await savedMappings([
      { url: heroUrl, resourceType: 'image' },
      { url: retinaUrl, resourceType: 'image' },
    ]);
    const source =
      'data:image/png;base64,AAAA 1x,\n  images/hero.png?width=640#mobile 640w, images/retina.png,  #local 2x';
    const result = rewriteSrcsetResource({
      srcset: source,
      baseUrl: BASE_URL,
      sourcePath: DOCUMENT_PATH,
      savedResourceMappings: mappings,
    });

    expect(result.rewrittenCount).toBe(2);
    expect(
      result.references.map(({ originalValue, descriptor, status }) => ({
        originalValue,
        descriptor,
        status,
      })),
    ).toEqual([
      { originalValue: 'data:image/png;base64,AAAA', descriptor: '1x', status: 'unsupported' },
      {
        originalValue: 'images/hero.png?width=640#mobile',
        descriptor: '640w',
        status: 'rewritten',
      },
      { originalValue: 'images/retina.png', descriptor: null, status: 'rewritten' },
      { originalValue: '#local', descriptor: '2x', status: 'fragment' },
    ]);
    expect(result.srcset.startsWith('data:image/png;base64,AAAA 1x,\n  ')).toBe(true);
    expect(result.srcset).toContain('#mobile 640w, ');
    expect(result.srcset).toContain(',  #local 2x');
    expect(result.srcset).toContain('--q-');
    expect(result.srcset).not.toContain(', images/retina.png,');
  });

  it('keeps unmapped, Blob, fragment, and invalid candidates unchanged with diagnostics', () => {
    const source = './missing.png 1x, blob:https://cdn.example.test/id 2x, #icon 3x, http://[ 4x';
    const result = rewriteSrcsetResource({
      srcset: source,
      baseUrl: BASE_URL,
      sourcePath: DOCUMENT_PATH,
      savedResourceMappings: [],
    });

    expect(result.srcset).toBe(source);
    expect(result.rewrittenCount).toBe(0);
    expect(result.references.map((reference) => reference.status)).toEqual([
      'unmapped',
      'unsupported',
      'fragment',
      'invalid',
    ]);
  });

  it('preserves attached commas and candidate order when replacing URLs', async () => {
    const oneUrl = 'https://cdn.example.test/assets/one.png';
    const twoUrl = 'https://cdn.example.test/assets/two.png';
    const mappings = await savedMappings([
      { url: oneUrl, resourceType: 'image' },
      { url: twoUrl, resourceType: 'image' },
    ]);
    const result = rewriteSrcsetResource({
      srcset: 'one.png, two.png 2x',
      baseUrl: BASE_URL,
      sourcePath: DOCUMENT_PATH,
      savedResourceMappings: mappings,
    });

    expect(result.rewrittenCount).toBe(2);
    expect(result.srcset).toMatch(/\.png, .*\.png 2x$/);
    expect(result.references.map((reference) => reference.candidateOrdinal)).toEqual([1, 2]);
  });

  it('does not rewrite mapped URLs with invalid descriptors', async () => {
    const imageUrl = 'https://cdn.example.test/assets/image.png';
    const mappings = await savedMappings([{ url: imageUrl, resourceType: 'image' }]);
    const source = 'image.png 0w, image.png 0x, image.png 1x 2x';
    const result = rewriteSrcsetResource({
      srcset: source,
      baseUrl: BASE_URL,
      sourcePath: DOCUMENT_PATH,
      savedResourceMappings: mappings,
    });

    expect(result.srcset).toBe(source);
    expect(result.rewrittenCount).toBe(0);
    expect(result.references.map((reference) => reference.status)).toEqual([
      'invalid',
      'invalid',
      'invalid',
    ]);
  });

  it('rejects unsafe paths, non-network bases, and ambiguous saved mappings', async () => {
    const [mapping] = await savedMappings([
      { url: 'https://cdn.example.test/assets/image.png', resourceType: 'image' },
    ]);
    if (!mapping) throw new Error('Fixture mapping missing.');
    const options = {
      srcset: 'image.png 1x',
      baseUrl: BASE_URL,
      sourcePath: DOCUMENT_PATH,
      savedResourceMappings: [mapping],
    };

    expect(() => rewriteSrcsetResource({ ...options, sourcePath: '../index.html' })).toThrow(
      'dot path segments',
    );
    expect(() => rewriteSrcsetResource({ ...options, baseUrl: 'file:///tmp/' })).toThrow(
      'HTTP or HTTPS',
    );
    expect(() =>
      rewriteSrcsetResource({
        ...options,
        savedResourceMappings: [
          mapping,
          { ...mapping, relativePath: `${mapping.directoryPath}/other.png` },
        ],
      }),
    ).toThrow('ambiguous archive paths');
  });
});
