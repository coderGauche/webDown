import {
  ARCHIVE_METADATA_PATHS,
  buildArchiveLayout,
  createArchiveLayoutZipSync,
  extractZipArchiveSync,
  type ArchiveLayoutInput,
  type ZipArchiveEntry,
} from '@sitecapsule/archive';
import { describe, expect, it } from 'vitest';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function entry(path: string, content = path): ZipArchiveEntry {
  return { path, bytes: encoder.encode(content) };
}

function completeInput(): ArchiveLayoutInput {
  return {
    indexHtml: encoder.encode('<!doctype html><title>Home</title>'),
    pages: [entry('pages/work/index.html'), entry('pages/about/index.html')],
    assets: [
      entry('assets/origins/https/dns-example.test/default/js/app.js'),
      entry('assets/origins/https/dns-cdn.example.test/default/images/hero.png'),
    ],
    metadata: [
      entry(ARCHIVE_METADATA_PATHS.resources),
      entry(ARCHIVE_METADATA_PATHS.archive),
      entry(ARCHIVE_METADATA_PATHS.failures),
      entry(ARCHIVE_METADATA_PATHS.originalUrls),
      entry(ARCHIVE_METADATA_PATHS.report),
      entry(ARCHIVE_METADATA_PATHS.offlineReadme),
    ],
    screenshots: [entry('screenshots/page.png')],
  };
}

describe('SiteCapsule archive layout', () => {
  it('assembles the prescribed regions in deterministic path order', () => {
    const layout = buildArchiveLayout(completeInput());

    expect(layout.entries.map(({ path }) => path)).toEqual([
      '_sitecapsule/README_OFFLINE.md',
      '_sitecapsule/archive.json',
      '_sitecapsule/failures.json',
      '_sitecapsule/original-urls.json',
      '_sitecapsule/report.html',
      '_sitecapsule/resources.json',
      'assets/origins/https/dns-cdn.example.test/default/images/hero.png',
      'assets/origins/https/dns-example.test/default/js/app.js',
      'index.html',
      'pages/about/index.html',
      'pages/work/index.html',
      'screenshots/page.png',
    ]);
    expect(layout.counts).toEqual({
      pages: 2,
      assets: 2,
      metadata: 6,
      screenshots: 1,
      total: 12,
    });
  });

  it('creates a deterministic ZIP with no synthetic directory entries', () => {
    const input = completeInput();
    const first = createArchiveLayoutZipSync(input);
    const reordered = createArchiveLayoutZipSync({
      ...input,
      pages: [...(input.pages ?? [])].reverse(),
      assets: [...(input.assets ?? [])].reverse(),
      metadata: [...(input.metadata ?? [])].reverse(),
    });
    const extracted = extractZipArchiveSync(first);

    expect(first).toEqual(reordered);
    expect(extracted.map(({ path }) => path)).toEqual(
      buildArchiveLayout(input).entries.map(({ path }) => path),
    );
    expect(extracted.some(({ path }) => path.endsWith('/'))).toBe(false);
    expect(decoder.decode(extracted.find(({ path }) => path === 'index.html')?.bytes)).toContain(
      '<title>Home</title>',
    );
  });

  it('allows an index-only layout while optional regions are absent', () => {
    const layout = buildArchiveLayout({ indexHtml: new Uint8Array() });

    expect(layout.entries).toEqual([{ path: 'index.html', bytes: new Uint8Array() }]);
    expect(layout.counts).toEqual({
      pages: 0,
      assets: 0,
      metadata: 0,
      screenshots: 0,
      total: 1,
    });
  });

  it('copies caller bytes and does not reorder caller collections', () => {
    const indexHtml = encoder.encode('index');
    const pages = [entry('pages/z/index.html'), entry('pages/a/index.html')];
    const originalPaths = pages.map(({ path }) => path);
    const layout = buildArchiveLayout({ indexHtml, pages });

    indexHtml.fill(0);
    pages[0]?.bytes.fill(0);
    expect(pages.map(({ path }) => path)).toEqual(originalPaths);
    expect(decoder.decode(layout.entries.find(({ path }) => path === 'index.html')?.bytes)).toBe(
      'index',
    );
    expect(
      decoder.decode(layout.entries.find(({ path }) => path === 'pages/z/index.html')?.bytes),
    ).toBe('pages/z/index.html');
  });

  it.each([
    ['pages', 'assets/file.js', 'under pages/'],
    ['assets', 'pages/index.html', 'under assets/'],
    ['metadata', 'screenshots/page.png', 'under _sitecapsule/'],
    ['screenshots', '_sitecapsule/report.html', 'under screenshots/'],
  ] as const)('rejects a %s entry assigned to another region', (collection, path, message) => {
    expect(() =>
      buildArchiveLayout({
        indexHtml: new Uint8Array(),
        [collection]: [entry(path)],
      }),
    ).toThrow(message);
  });

  it('accepts only reserved metadata file paths', () => {
    expect(() =>
      buildArchiveLayout({
        indexHtml: new Uint8Array(),
        metadata: [entry('_sitecapsule/custom.json')],
      }),
    ).toThrow('Archive metadata entry path is not reserved');
  });

  it.each([
    ['pages/../escape.html', 'must not contain empty or dot path segments'],
    ['pages\\escape.html', 'relative POSIX archive path'],
    ['pages/CON/index.html', 'non-portable path segment'],
    ['pages/e\u0301/index.html', 'non-portable path segment'],
  ])('rejects unsafe or non-portable path %s', (path, message) => {
    expect(() => buildArchiveLayout({ indexHtml: new Uint8Array(), pages: [entry(path)] })).toThrow(
      message,
    );
  });

  it('rejects exact, case-insensitive, and normalized path collisions across collections', () => {
    expect(() =>
      buildArchiveLayout({
        indexHtml: new Uint8Array(),
        pages: [entry('pages/a/index.html'), entry('pages/a/index.html')],
      }),
    ).toThrow('Archive paths collide after portable normalization');
    expect(() =>
      buildArchiveLayout({
        indexHtml: new Uint8Array(),
        pages: [entry('pages/About/index.html'), entry('pages/about/index.html')],
      }),
    ).toThrow('Archive paths collide after portable normalization');
  });

  it('requires an object input, binary index, binary entries, and array collections', () => {
    expect(() => buildArchiveLayout(null as never)).toThrow('input must be an object');
    expect(() => buildArchiveLayout({ indexHtml: 'html' as never })).toThrow(
      'index HTML must be a Uint8Array',
    );
    expect(() =>
      buildArchiveLayout({ indexHtml: new Uint8Array(), pages: 'pages' as never }),
    ).toThrow('pages entries must be an array');
    expect(() =>
      buildArchiveLayout({
        indexHtml: new Uint8Array(),
        pages: [{ path: 'pages/a/index.html', bytes: 'html' as never }],
      }),
    ).toThrow('entry bytes at index 0 must be a Uint8Array');
  });
});
