import {
  ARCHIVE_METADATA_PATHS,
  ARCHIVE_RESOURCE_MANIFEST_FORMAT_VERSION,
  ArchiveVerificationError,
  buildArchiveLayout,
  createZipArchiveSync,
  verifySiteCapsuleArchiveSync,
  type ArchiveLayout,
  type ZipArchiveEntry,
} from '@sitecapsule/archive';
import { describe, expect, it } from 'vitest';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

function baseEntries(): ZipArchiveEntry[] {
  const indexHtml = encoder.encode('<!doctype html><title>Home</title>');
  const assetPath = 'assets/origins/https/dns-example.test/default/images/hero.png';
  const assetBytes = new Uint8Array([0, 1, 2, 3, 255]);
  const archiveManifest = {
    formatVersion: 1,
    product: 'SiteCapsule',
    capturedAt: '2026-07-29T08:30:00.000Z',
    startUrl: 'https://example.test/',
    finalUrl: 'https://example.test/',
    mode: 'current-page',
    captureProfile: 'standard',
    pages: 1,
    resources: 2,
    failedResources: 0,
    requiresLocalHttpServer: false,
    onlineDependencies: [],
  };
  const resourceManifest = {
    formatVersion: ARCHIVE_RESOURCE_MANIFEST_FORMAT_VERSION,
    resources: [
      {
        originalUrl: 'https://example.test/',
        finalUrl: 'https://example.test/',
        referrerUrl: 'https://example.test/',
        localPath: 'index.html',
        resourceType: 'document',
        discoverySources: ['dom'],
        redirectTrace: null,
        mimeType: 'text/html',
        httpStatus: 200,
        byteLength: indexHtml.byteLength,
        sha256: null,
      },
      {
        originalUrl: 'https://cdn.example.test/hero.png',
        finalUrl: 'https://cdn.example.test/hero.png',
        referrerUrl: 'https://example.test/',
        localPath: assetPath,
        resourceType: 'image',
        discoverySources: ['performance'],
        redirectTrace: null,
        mimeType: 'image/png',
        httpStatus: 200,
        byteLength: assetBytes.byteLength,
        sha256: null,
      },
    ],
  };
  const originalUrls = {
    formatVersion: ARCHIVE_RESOURCE_MANIFEST_FORMAT_VERSION,
    mappings: [
      {
        originalUrl: 'https://example.test/',
        finalUrl: 'https://example.test/',
        localPath: 'index.html',
        resourceType: 'document',
      },
      {
        originalUrl: 'https://cdn.example.test/hero.png',
        finalUrl: 'https://cdn.example.test/hero.png',
        localPath: assetPath,
        resourceType: 'image',
      },
    ],
  };

  return [
    { path: 'index.html', bytes: indexHtml },
    { path: assetPath, bytes: assetBytes },
    { path: ARCHIVE_METADATA_PATHS.archive, bytes: jsonBytes(archiveManifest) },
    { path: ARCHIVE_METADATA_PATHS.resources, bytes: jsonBytes(resourceManifest) },
    {
      path: ARCHIVE_METADATA_PATHS.failures,
      bytes: jsonBytes({ formatVersion: 1, failures: [], skipped: [] }),
    },
    { path: ARCHIVE_METADATA_PATHS.originalUrls, bytes: jsonBytes(originalUrls) },
    { path: ARCHIVE_METADATA_PATHS.report, bytes: encoder.encode('<!doctype html><p>Report</p>') },
    { path: ARCHIVE_METADATA_PATHS.offlineReadme, bytes: encoder.encode('# Offline archive\n') },
  ];
}

function layoutFromEntries(entries: readonly ZipArchiveEntry[]): ArchiveLayout {
  const index = entries.find(({ path }) => path === 'index.html');
  if (!index) throw new Error('Fixture is missing index.html.');
  return buildArchiveLayout({
    indexHtml: index.bytes,
    pages: entries.filter(({ path }) => path.startsWith('pages/')),
    assets: entries.filter(({ path }) => path.startsWith('assets/')),
    metadata: entries.filter(({ path }) => path.startsWith('_sitecapsule/')),
    screenshots: entries.filter(({ path }) => path.startsWith('screenshots/')),
  });
}

function archiveFor(entries: readonly ZipArchiveEntry[]): Uint8Array {
  return createZipArchiveSync(entries);
}

function replaceJsonEntry(
  entries: readonly ZipArchiveEntry[],
  path: string,
  update: (value: Record<string, unknown>) => Record<string, unknown>,
): ZipArchiveEntry[] {
  return entries.map((entry) => {
    if (entry.path !== path) return { path: entry.path, bytes: new Uint8Array(entry.bytes) };
    return {
      path,
      bytes: jsonBytes(update(JSON.parse(decoder.decode(entry.bytes)) as Record<string, unknown>)),
    };
  });
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function mutateFirstCrc(bytes: Uint8Array): Uint8Array {
  const output = new Uint8Array(bytes);
  const endOffset = output.byteLength - 22;
  const centralOffset = readUint32(output, endOffset + 16);
  const localOffset = readUint32(output, centralOffset + 42);
  const wrongCrc = readUint32(output, centralOffset + 16) ^ 0xffffffff;
  writeUint32(output, centralOffset + 16, wrongCrc);
  writeUint32(output, localOffset + 14, wrongCrc);
  return output;
}

function mutateDuplicateScreenshotName(bytes: Uint8Array): Uint8Array {
  const output = new Uint8Array(bytes);
  const endOffset = output.byteLength - 22;
  const centralOffset = readUint32(output, endOffset + 16);
  const count = readUint16(output, endOffset + 10);
  let offset = centralOffset;
  let firstName: Uint8Array | undefined;
  let firstLength = 0;
  for (let index = 0; index < count; index += 1) {
    const nameLength = readUint16(output, offset + 28);
    const extraLength = readUint16(output, offset + 30);
    const commentLength = readUint16(output, offset + 32);
    const name = output.slice(offset + 46, offset + 46 + nameLength);
    const decoded = decoder.decode(name);
    if (decoded.startsWith('screenshots/') && firstName === undefined) {
      firstName = name;
      firstLength = nameLength;
    } else if (decoded === 'screenshots/b.png' && firstName && firstLength === nameLength) {
      output.set(firstName, offset + 46);
      const localOffset = readUint32(output, offset + 42);
      output.set(firstName, localOffset + 30);
      return output;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error('Fixture did not contain same-length screenshot names.');
}

describe('SiteCapsule ZIP verification', () => {
  it('verifies CRC, paths, bytes, manifests, and counts without mutating inputs', () => {
    const entries = baseEntries();
    const layout = layoutFromEntries(entries);
    const archiveBytes = archiveFor(entries);
    const archiveSnapshot = new Uint8Array(archiveBytes);
    const pathsSnapshot = entries.map(({ path }) => path);

    const result = verifySiteCapsuleArchiveSync({
      archiveBytes,
      expectedEntries: layout.entries,
    });

    expect(result).toEqual({
      entryCount: 8,
      crcVerifiedEntries: 8,
      paths: layout.entries.map(({ path }) => path),
      layoutCounts: { pages: 0, assets: 1, metadata: 6, screenshots: 0, total: 8 },
      manifestCounts: { pages: 1, resources: 2, failedResources: 0, skippedResources: 0 },
    });
    expect(archiveBytes).toEqual(archiveSnapshot);
    expect(entries.map(({ path }) => path)).toEqual(pathsSnapshot);
  });

  it('rejects a CRC mismatch even when the ZIP remains decompressible', () => {
    const entries = baseEntries();
    expect(() =>
      verifySiteCapsuleArchiveSync({
        archiveBytes: mutateFirstCrc(archiveFor(entries)),
        expectedEntries: layoutFromEntries(entries).entries,
      }),
    ).toThrowError(
      expect.objectContaining({
        name: 'ArchiveVerificationError',
        code: 'zip-crc-mismatch',
      }),
    );
  });

  it('rejects truncated and duplicate-entry ZIP structures', () => {
    const entries = [
      ...baseEntries(),
      { path: 'screenshots/a.png', bytes: encoder.encode('a') },
      { path: 'screenshots/b.png', bytes: encoder.encode('b') },
    ];
    const expectedEntries = layoutFromEntries(entries).entries;
    expect(() =>
      verifySiteCapsuleArchiveSync({
        archiveBytes: archiveFor(entries).slice(0, -3),
        expectedEntries,
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-zip-structure' }));
    expect(() =>
      verifySiteCapsuleArchiveSync({
        archiveBytes: mutateDuplicateScreenshotName(archiveFor(entries)),
        expectedEntries,
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-zip-structure' }));
  });

  it('rejects missing and extra paths against the expected layout', () => {
    const entries = baseEntries();
    const expectedEntries = layoutFromEntries(entries).entries;
    expect(() =>
      verifySiteCapsuleArchiveSync({
        archiveBytes: archiveFor(entries.filter(({ path }) => path !== 'index.html')),
        expectedEntries,
      }),
    ).toThrowError(expect.objectContaining({ code: 'archive-path-mismatch' }));
    expect(() =>
      verifySiteCapsuleArchiveSync({
        archiveBytes: archiveFor([
          ...entries,
          { path: 'screenshots/extra.png', bytes: encoder.encode('extra') },
        ]),
        expectedEntries,
      }),
    ).toThrowError(expect.objectContaining({ code: 'archive-path-mismatch' }));
  });

  it('rejects content mismatch separately from CRC mismatch', () => {
    const entries = baseEntries();
    const expectedEntries = layoutFromEntries(entries).entries;
    const changed = entries.map((entry) =>
      entry.path === 'index.html'
        ? { path: entry.path, bytes: encoder.encode('<!doctype html><title>Test</title>') }
        : entry,
    );

    expect(() =>
      verifySiteCapsuleArchiveSync({
        archiveBytes: archiveFor(changed),
        expectedEntries,
      }),
    ).toThrowError(expect.objectContaining({ code: 'archive-content-mismatch' }));
  });

  it('rejects count and manifest inconsistencies inside a valid ZIP', () => {
    const entries = baseEntries();
    const expectedEntries = layoutFromEntries(entries).entries;
    const countMismatch = replaceJsonEntry(entries, ARCHIVE_METADATA_PATHS.archive, (manifest) => ({
      ...manifest,
      resources: 1,
    }));
    expect(() =>
      verifySiteCapsuleArchiveSync({
        archiveBytes: archiveFor(countMismatch),
        expectedEntries: layoutFromEntries(countMismatch).entries,
      }),
    ).toThrowError(expect.objectContaining({ code: 'archive-count-mismatch' }));

    const missingMapping = replaceJsonEntry(
      entries,
      ARCHIVE_METADATA_PATHS.originalUrls,
      (manifest) => ({
        ...manifest,
        mappings: (manifest.mappings as unknown[]).slice(1),
      }),
    );
    expect(() =>
      verifySiteCapsuleArchiveSync({
        archiveBytes: archiveFor(missingMapping),
        expectedEntries: layoutFromEntries(missingMapping).entries,
      }),
    ).toThrowError(expect.objectContaining({ code: 'archive-manifest-invalid' }));

    const invalidJson = entries.map((entry) =>
      entry.path === ARCHIVE_METADATA_PATHS.resources
        ? { path: entry.path, bytes: encoder.encode('{broken') }
        : entry,
    );
    expect(() =>
      verifySiteCapsuleArchiveSync({
        archiveBytes: archiveFor(invalidJson),
        expectedEntries: layoutFromEntries(invalidJson).entries,
      }),
    ).toThrowError(expect.objectContaining({ code: 'archive-manifest-invalid' }));

    expect(expectedEntries).toHaveLength(8);
  });

  it('rejects malformed verifier input before decoding', () => {
    const entries = baseEntries();
    const layout = layoutFromEntries(entries);
    expect(() => verifySiteCapsuleArchiveSync(null as never)).toThrow(TypeError);
    expect(() =>
      verifySiteCapsuleArchiveSync({
        archiveBytes: new Uint8Array(),
        expectedEntries: layout.entries,
        extra: true,
      } as never),
    ).toThrow(TypeError);
    expect(() =>
      verifySiteCapsuleArchiveSync({ archiveBytes: new Uint8Array(), expectedEntries: [] }),
    ).toThrow(TypeError);
  });

  it('does not claim to sandbox arbitrary ZIP input', () => {
    expect(ArchiveVerificationError.prototype).toBeInstanceOf(Error);
  });
});
