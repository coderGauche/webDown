import {
  ARCHIVE_METADATA_PATHS,
  ArchiveResourceSha256Error,
  SHA_256_HEX_LENGTH,
  applyArchiveResourceSha256,
  buildArchiveResourceManifests,
  createArchiveSha256Hex,
  createStableArchiveHash,
  type ArchiveResourceManifest,
  type ArchiveResourceSha256Input,
  type ZipArchiveEntry,
} from '@sitecapsule/archive';
import type { ResourceRecord } from '@sitecapsule/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function integrityFixture(): {
  manifest: ArchiveResourceManifest;
  entries: ZipArchiveEntry[];
} {
  const indexBytes = encoder.encode('abc');
  const pageBytes = new Uint8Array();
  const records: ResourceRecord[] = [
    {
      id: 'index',
      jobId: 'job-integrity',
      originalUrl: 'https://example.test/',
      referrerUrl: 'https://example.test/',
      type: 'document',
      discoverySources: ['dom'],
      mimeType: 'text/html',
      httpStatus: 200,
      localPath: 'index.html',
      byteLength: indexBytes.byteLength,
      sha256: 'f'.repeat(64),
      state: 'saved',
    },
    {
      id: 'about',
      jobId: 'job-integrity',
      originalUrl: 'https://example.test/about',
      referrerUrl: 'https://example.test/',
      type: 'document',
      discoverySources: ['crawler'],
      mimeType: 'text/html',
      httpStatus: 200,
      localPath: 'pages/about/index.html',
      byteLength: pageBytes.byteLength,
      state: 'saved',
    },
  ];
  return {
    manifest: buildArchiveResourceManifests({
      jobId: 'job-integrity',
      resourceRecords: records,
      pathMappings: [],
    }).resources,
    entries: [
      { path: 'pages/about/index.html', bytes: pageBytes },
      { path: 'index.html', bytes: indexBytes },
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('optional archive resource SHA-256', () => {
  it('matches standard SHA-256 vectors for byte and string helpers', async () => {
    expect(SHA_256_HEX_LENGTH).toBe(64);
    expect(await createArchiveSha256Hex(encoder.encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(await createArchiveSha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(await createStableArchiveHash('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes every saved resource in manifest order and replaces stale digests', async () => {
    const { manifest, entries } = integrityFixture();
    const result = await applyArchiveResourceSha256({
      enabled: true,
      resourceManifest: manifest,
      resourceEntries: entries,
    });

    expect(result.enabled).toBe(true);
    expect(result.hashedResources).toBe(2);
    expect(result.resourceManifest.resources.map(({ localPath }) => localPath)).toEqual([
      'index.html',
      'pages/about/index.html',
    ]);
    expect(result.resourceManifest.resources.map(({ sha256 }) => sha256)).toEqual([
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ]);
  });

  it('emits the updated resources.json entry with stable UTF-8 JSON', async () => {
    const fixture = integrityFixture();
    const first = await applyArchiveResourceSha256({
      enabled: true,
      resourceManifest: fixture.manifest,
      resourceEntries: fixture.entries,
    });
    const second = await applyArchiveResourceSha256({
      enabled: true,
      resourceManifest: fixture.manifest,
      resourceEntries: [...fixture.entries].reverse(),
    });
    const text = decoder.decode(first.resourcesEntry.bytes);

    expect(first.resourcesEntry.path).toBe(ARCHIVE_METADATA_PATHS.resources);
    expect(JSON.parse(text)).toEqual(first.resourceManifest);
    expect(text.endsWith('\n')).toBe(true);
    expect(first.resourcesEntry.bytes).toEqual(second.resourcesEntry.bytes);
  });

  it('clears all digests without reading Web Crypto or accepting byte entries when disabled', async () => {
    const { manifest } = integrityFixture();
    vi.stubGlobal('crypto', {
      get subtle(): never {
        throw new Error('crypto must not be read');
      },
    });

    const result = await applyArchiveResourceSha256({ enabled: false, resourceManifest: manifest });

    expect(result.enabled).toBe(false);
    expect(result.hashedResources).toBe(0);
    expect(result.resourceManifest.resources.map(({ sha256 }) => sha256)).toEqual([null, null]);
    await expect(
      applyArchiveResourceSha256({
        enabled: false,
        resourceManifest: manifest,
        resourceEntries: [],
      } as never),
    ).rejects.toThrow('exactly the supported fields');
  });

  it('does not mutate manifest objects, entry arrays, or caller-owned bytes', async () => {
    const { manifest, entries } = integrityFixture();
    const manifestSnapshot = structuredClone(manifest);
    const entryOrder = entries.map(({ path }) => path);
    const byteSnapshots = entries.map(({ bytes }) => new Uint8Array(bytes));

    await applyArchiveResourceSha256({
      enabled: true,
      resourceManifest: manifest,
      resourceEntries: entries,
    });

    expect(manifest).toEqual(manifestSnapshot);
    expect(entries.map(({ path }) => path)).toEqual(entryOrder);
    expect(entries.map(({ bytes }) => bytes)).toEqual(byteSnapshots);
  });

  it('rejects a missing resource byte entry', async () => {
    const { manifest, entries } = integrityFixture();
    await expect(
      applyArchiveResourceSha256({
        enabled: true,
        resourceManifest: manifest,
        resourceEntries: [entries[0]!],
      }),
    ).rejects.toThrow('bytes are missing for resource: index.html');
  });

  it('rejects extra entries that have no saved resource', async () => {
    const { manifest, entries } = integrityFixture();
    await expect(
      applyArchiveResourceSha256({
        enabled: true,
        resourceManifest: manifest,
        resourceEntries: [...entries, { path: 'assets/extra.bin', bytes: new Uint8Array() }],
      }),
    ).rejects.toThrow('entry has no saved resource');
  });

  it('rejects exact and portable-case duplicate entry paths', async () => {
    const { manifest, entries } = integrityFixture();
    for (const duplicatePath of ['index.html', 'INDEX.HTML']) {
      await expect(
        applyArchiveResourceSha256({
          enabled: true,
          resourceManifest: manifest,
          resourceEntries: [...entries, { path: duplicatePath, bytes: encoder.encode('abc') }],
        }),
      ).rejects.toThrow('entry path is not unique');
    }
  });

  it('rejects bytes whose length differs from resources.json', async () => {
    const { manifest, entries } = integrityFixture();
    await expect(
      applyArchiveResourceSha256({
        enabled: true,
        resourceManifest: manifest,
        resourceEntries: entries.map((entry) =>
          entry.path === 'index.html' ? { ...entry, bytes: encoder.encode('abcd') } : entry,
        ),
      }),
    ).rejects.toThrow('byte length does not match: index.html');
  });

  it('rejects duplicate manifest paths and malformed manifest metadata', async () => {
    const { manifest } = integrityFixture();
    await expect(
      applyArchiveResourceSha256({
        enabled: false,
        resourceManifest: {
          ...manifest,
          resources: [
            manifest.resources[0]!,
            { ...manifest.resources[1]!, localPath: 'INDEX.HTML' },
          ],
        },
      }),
    ).rejects.toThrow('resource path is not unique');
    await expect(
      applyArchiveResourceSha256({
        enabled: false,
        resourceManifest: { ...manifest, formatVersion: 2 as never },
      }),
    ).rejects.toThrow('not a supported manifest');
    await expect(
      applyArchiveResourceSha256({
        enabled: false,
        resourceManifest: {
          ...manifest,
          resources: [{ ...manifest.resources[0]!, sha256: 'ABC' }],
        },
      }),
    ).rejects.toThrow('lowercase digest');
  });

  it('fails explicitly when Web Crypto SHA-256 is unavailable', async () => {
    const { manifest, entries } = integrityFixture();
    vi.stubGlobal('crypto', undefined);

    await expect(
      applyArchiveResourceSha256({
        enabled: true,
        resourceManifest: manifest,
        resourceEntries: entries,
      }),
    ).rejects.toThrow('Web Crypto SHA-256 is unavailable');
  });

  it('wraps digest failures with the affected local path and cause', async () => {
    const { manifest, entries } = integrityFixture();
    const cause = new Error('digest failed');
    vi.stubGlobal('crypto', {
      subtle: {
        digest: vi.fn().mockRejectedValue(cause),
      },
    });

    try {
      await applyArchiveResourceSha256({
        enabled: true,
        resourceManifest: manifest,
        resourceEntries: entries,
      });
      throw new Error('Expected hashing to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(ArchiveResourceSha256Error);
      expect(error).toMatchObject({ localPath: 'index.html', cause });
    }
  });

  it('requires the exact discriminated input fields', async () => {
    const { manifest, entries } = integrityFixture();
    await expect(
      applyArchiveResourceSha256({
        enabled: true,
        resourceManifest: manifest,
      } as ArchiveResourceSha256Input),
    ).rejects.toThrow('exactly the supported fields');
    await expect(
      applyArchiveResourceSha256({
        enabled: true,
        resourceManifest: manifest,
        resourceEntries: entries,
        jobId: 'private',
      } as never),
    ).rejects.toThrow('exactly the supported fields');
    await expect(applyArchiveResourceSha256(null as never)).rejects.toThrow(
      'must be an object with an enabled flag',
    );
  });
});
