import {
  ARCHIVE_MANIFEST_FORMAT_VERSION,
  ARCHIVE_MANIFEST_PRODUCT,
  ARCHIVE_METADATA_PATHS,
  buildArchiveLayout,
  buildArchiveManifest,
  createArchiveManifestBytes,
  createArchiveManifestEntry,
  type ArchiveManifestInput,
} from '@sitecapsule/archive';
import { describe, expect, it } from 'vitest';

const decoder = new TextDecoder();

function manifestInput(): ArchiveManifestInput {
  return {
    capturedAt: '2026-07-22T12:00:00.000Z',
    startUrl: 'HTTPS://Example.COM:443/start?theme=dark#intro',
    finalUrl: 'https://example.com/final?lang=zh#content',
    mode: 'current-page',
    captureProfile: 'standard',
    pages: 1,
    resources: 142,
    failedResources: 3,
    requiresLocalHttpServer: true,
    onlineDependencies: [
      'https://api.example.com/data?lang=zh#response',
      'HTTPS://CDN.Example.COM:443/font.woff2',
    ],
  };
}

describe('archive.json manifest', () => {
  it('builds the versioned product manifest in its stable field order', () => {
    expect(buildArchiveManifest(manifestInput())).toEqual({
      formatVersion: 1,
      product: 'SiteCapsule',
      capturedAt: '2026-07-22T12:00:00.000Z',
      startUrl: 'https://example.com/start?theme=dark#intro',
      finalUrl: 'https://example.com/final?lang=zh#content',
      mode: 'current-page',
      captureProfile: 'standard',
      pages: 1,
      resources: 142,
      failedResources: 3,
      requiresLocalHttpServer: true,
      onlineDependencies: [
        'https://api.example.com/data?lang=zh',
        'https://cdn.example.com/font.woff2',
      ],
    });
    expect(ARCHIVE_MANIFEST_FORMAT_VERSION).toBe(1);
    expect(ARCHIVE_MANIFEST_PRODUCT).toBe('SiteCapsule');
  });

  it('emits pretty UTF-8 JSON with one trailing newline at the reserved layout path', () => {
    const input = manifestInput();
    const bytes = createArchiveManifestBytes(input);
    const entry = createArchiveManifestEntry(input);
    const text = decoder.decode(bytes);

    expect(entry.path).toBe(ARCHIVE_METADATA_PATHS.archive);
    expect(entry.bytes).toEqual(bytes);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(text).toContain('  "formatVersion": 1');
    expect(JSON.parse(text)).toEqual(buildArchiveManifest(input));
    expect(
      buildArchiveLayout({
        indexHtml: new Uint8Array(),
        metadata: [entry],
      }).entries.map(({ path }) => path),
    ).toEqual(['_sitecapsule/archive.json', 'index.html']);
  });

  it('deduplicates and sorts normalized online dependencies without mutating input', () => {
    const input = manifestInput();
    input.onlineDependencies = [
      'https://z.example.test/api#one',
      'HTTPS://A.Example.Test:443/api',
      'https://z.example.test/api#two',
    ];
    const snapshot = [...input.onlineDependencies];
    const manifest = buildArchiveManifest(input);

    expect(manifest.onlineDependencies).toEqual([
      'https://a.example.test/api',
      'https://z.example.test/api',
    ]);
    expect(input.onlineDependencies).toEqual(snapshot);
  });

  it('produces identical bytes for equivalent dependency order and URL spelling', () => {
    const first = manifestInput();
    const second: ArchiveManifestInput = {
      ...first,
      startUrl: 'https://example.com/start?theme=dark#intro',
      onlineDependencies: [...first.onlineDependencies].reverse(),
    };

    expect(createArchiveManifestBytes(first)).toEqual(createArchiveManifestBytes(second));
  });

  it('redacts common secret query parameters and sensitive URL fragments', () => {
    const manifest = buildArchiveManifest({
      ...manifestInput(),
      startUrl: 'https://example.com/?access_token=start-secret&theme=dark',
      finalUrl: 'https://example.com/callback#access_token=fragment-secret&state=ok',
      onlineDependencies: [
        'https://api.example.com/data?api_key=dependency-secret&X-Amz-Security-Token=cloud-secret&lang=zh',
      ],
    });
    const serialized = JSON.stringify(manifest);

    expect(manifest.startUrl).toBe('https://example.com/?access_token=REDACTED&theme=dark');
    expect(manifest.finalUrl).toBe('https://example.com/callback#REDACTED');
    expect(manifest.onlineDependencies).toEqual([
      'https://api.example.com/data?api_key=REDACTED&X-Amz-Security-Token=REDACTED&lang=zh',
    ]);
    expect(serialized).not.toContain('start-secret');
    expect(serialized).not.toContain('fragment-secret');
    expect(serialized).not.toContain('dependency-secret');
    expect(serialized).not.toContain('cloud-secret');
  });

  it.each([
    ['', 'valid timestamp string'],
    ['not-a-date', 'valid timestamp string'],
    ['2026-07-22T12:00:00Z', 'canonical ISO 8601 UTC'],
    ['2026-07-22T14:00:00.000+02:00', 'canonical ISO 8601 UTC'],
  ])('rejects non-canonical capture timestamp %j', (capturedAt, message) => {
    expect(() => buildArchiveManifest({ ...manifestInput(), capturedAt })).toThrow(message);
  });

  it.each([
    ['startUrl', 'relative/page', 'absolute URL'],
    ['startUrl', 'file:///tmp/page.html', 'HTTP or HTTPS'],
    ['startUrl', 'https://user:secret@example.com/', 'must not contain credentials'],
    ['finalUrl', 'data:text/html,hello', 'HTTP or HTTPS'],
  ] as const)('rejects invalid %s value %s', (field, value, message) => {
    expect(() => buildArchiveManifest({ ...manifestInput(), [field]: value })).toThrow(message);
  });

  it.each([
    ['pages', 0, 'greater than zero'],
    ['pages', -1, 'non-negative safe integer'],
    ['resources', 1.5, 'non-negative safe integer'],
    ['failedResources', Number.NaN, 'non-negative safe integer'],
    ['failedResources', Number.MAX_SAFE_INTEGER + 1, 'non-negative safe integer'],
  ] as const)('rejects invalid %s count', (field, value, message) => {
    expect(() => buildArchiveManifest({ ...manifestInput(), [field]: value })).toThrow(message);
  });

  it('rejects unsupported vocabulary, malformed dependencies, and non-boolean server flags', () => {
    expect(() => buildArchiveManifest({ ...manifestInput(), mode: 'tab' as never })).toThrow(
      'capture mode is not supported',
    );
    expect(() =>
      buildArchiveManifest({ ...manifestInput(), captureProfile: 'maximum' as never }),
    ).toThrow('capture profile is not supported');
    expect(() =>
      buildArchiveManifest({ ...manifestInput(), onlineDependencies: 'api' as never }),
    ).toThrow('onlineDependencies must be an array');
    expect(() =>
      buildArchiveManifest({
        ...manifestInput(),
        onlineDependencies: ['blob:https://example.com/id'],
      }),
    ).toThrow('must use HTTP or HTTPS');
    const sparseDependencies = Array<string>(1);
    expect(() =>
      buildArchiveManifest({ ...manifestInput(), onlineDependencies: sparseDependencies }),
    ).toThrow('online dependency at index 0 must be a non-empty URL string');
    expect(() =>
      buildArchiveManifest({ ...manifestInput(), requiresLocalHttpServer: 1 as never }),
    ).toThrow('requiresLocalHttpServer must be a boolean');
  });

  it('requires exactly the documented business fields', () => {
    const { finalUrl: _finalUrl, ...missingField } = manifestInput();
    expect(() => buildArchiveManifest(missingField as never)).toThrow(
      'exactly the supported fields',
    );
    expect(() =>
      buildArchiveManifest({ ...manifestInput(), jobId: 'private-job-id' } as never),
    ).toThrow('exactly the supported fields');
    expect(() => buildArchiveManifest(null as never)).toThrow('exactly the supported fields');
  });
});
