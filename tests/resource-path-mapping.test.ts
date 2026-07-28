import {
  ARCHIVE_HASH_HEX_LENGTH,
  PORTABLE_FILE_NAME_MAX_BYTES,
  appendArchiveFileNameSuffix,
  createQueryHash,
  createResourcePathMappings,
  createStableArchiveHash,
  type ResourcePathInput,
} from '@sitecapsule/archive';
import type { ResourceType } from '@sitecapsule/domain';
import { describe, expect, it } from 'vitest';

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

function pathsByUrl(inputs: readonly ResourcePathInput[]) {
  return createResourcePathMappings(inputs).then(
    (mappings) => new Map(mappings.map((mapping) => [mapping.normalizedUrl, mapping])),
  );
}

describe('query hashes and deterministic resource path conflicts', () => {
  it('uses SHA-256 and returns a short non-empty query hash without query text', async () => {
    expect(await createStableArchiveHash('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );

    const hash = await createQueryHash('?token=secret-value&theme=dark');
    expect(hash).toMatch(new RegExp(`^[0-9a-f]{${ARCHIVE_HASH_HEX_LENGTH}}$`));
    expect(hash).not.toContain('token');
    expect(hash).not.toContain('secret');
    expect(await createQueryHash('')).toBeNull();
    expect(await createQueryHash('?')).toBeNull();
  });

  it('inserts generated suffixes before extensions and preserves the byte limit', () => {
    expect(appendArchiveFileNameSuffix('app.min.js', 'q-1234abcd')).toBe('app.min--q-1234abcd.js');

    const longName = appendArchiveFileNameSuffix(`${'界'.repeat(100)}.woff2`, 'c-1234abcd');
    expect(byteLength(longName)).toBeLessThanOrEqual(PORTABLE_FILE_NAME_MAX_BYTES);
    expect(longName.endsWith('--c-1234abcd.woff2')).toBe(true);
    expect(longName).not.toContain('�');
  });

  it('adds different query hashes for query order and value differences', async () => {
    const inputs: ResourcePathInput[] = [
      { url: 'https://example.test/app.js?a=1&b=2', resourceType: 'script' },
      { url: 'https://example.test/app.js?b=2&a=1', resourceType: 'script' },
      { url: 'https://example.test/app.js?a=2&b=2', resourceType: 'script' },
    ];
    const mappings = await createResourcePathMappings(inputs);

    expect(new Set(mappings.map((mapping) => mapping.queryHash)).size).toBe(3);
    expect(new Set(mappings.map((mapping) => mapping.relativePath)).size).toBe(3);
    for (const mapping of mappings) {
      expect(mapping.fileName).toMatch(/^app--q-[0-9a-f]{12}\.js$/);
      expect(mapping.collisionHash).toBeNull();
      expect(mapping.fileName).not.toContain('a=');
      expect(mapping.fileName).not.toContain('b=');
    }
  });

  it('deduplicates equivalent normalized URLs and retains sorted original URL aliases', async () => {
    const inputs: ResourcePathInput[] = [
      { url: 'HTTPS://Example.TEST:443/app.js#two', resourceType: 'script' },
      { url: 'https://example.test/app.js', resourceType: 'script' },
      { url: 'HTTPS://Example.TEST:443/app.js#one', resourceType: 'script' },
    ];
    const mappings = await createResourcePathMappings(inputs);

    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toMatchObject({
      normalizedUrl: 'https://example.test/app.js',
      baseFileName: 'app.js',
      queryHash: null,
      collisionHash: null,
      fileName: 'app.js',
      relativePath: 'assets/origins/https/dns-example.test/default/js/app.js',
      originalUrls: [...inputs.map((input) => input.url)].sort(),
    });
  });

  it('resolves flattened path leaf collisions by renaming every conflicting resource', async () => {
    const mappings = await createResourcePathMappings([
      { url: 'https://example.test/icons/logo.png', resourceType: 'image' },
      { url: 'https://example.test/brand/logo.png', resourceType: 'image' },
    ]);

    expect(mappings.every((mapping) => mapping.baseFileName === 'logo.png')).toBe(true);
    expect(mappings.every((mapping) => mapping.collisionHash?.length === 12)).toBe(true);
    expect(mappings.every((mapping) => /^logo--c-[0-9a-f]{12}\.png$/.test(mapping.fileName))).toBe(
      true,
    );
    expect(new Set(mappings.map((mapping) => mapping.relativePath)).size).toBe(2);
  });

  it('treats portable file names as case-insensitive when detecting conflicts', async () => {
    const mappings = await createResourcePathMappings([
      { url: 'https://example.test/Logo%3F.PNG', resourceType: 'image' },
      { url: 'https://example.test/logo%2A.png', resourceType: 'image' },
    ]);

    expect(mappings.map((mapping) => mapping.baseFileName).sort()).toEqual([
      'Logo_.PNG',
      'logo_.png',
    ]);
    expect(mappings.every((mapping) => mapping.collisionHash !== null)).toBe(true);
    expect(new Set(mappings.map((mapping) => mapping.relativePath.toLowerCase())).size).toBe(2);
  });

  it('resolves names that collide only after UTF-8 truncation and keeps extensions', async () => {
    const sharedPrefix = 'a'.repeat(260);
    const mappings = await createResourcePathMappings([
      { url: `https://example.test/${sharedPrefix}-one.css`, resourceType: 'stylesheet' },
      { url: `https://example.test/${sharedPrefix}-two.css`, resourceType: 'stylesheet' },
    ]);

    expect(new Set(mappings.map((mapping) => mapping.baseFileName)).size).toBe(1);
    expect(new Set(mappings.map((mapping) => mapping.relativePath)).size).toBe(2);
    for (const mapping of mappings) {
      expect(byteLength(mapping.fileName)).toBeLessThanOrEqual(PORTABLE_FILE_NAME_MAX_BYTES);
      expect(mapping.fileName).toMatch(/--c-[0-9a-f]{12}\.css$/);
    }
  });

  it('resolves same-directory conflicts between resource types sharing a type directory', async () => {
    const mappings = await createResourcePathMappings([
      { url: 'https://media.example.test/clip', resourceType: 'audio' },
      { url: 'https://media.example.test/clip', resourceType: 'video' },
    ]);

    expect(mappings.map((mapping) => mapping.directoryPath)).toEqual([
      'assets/origins/https/dns-media.example.test/default/media',
      'assets/origins/https/dns-media.example.test/default/media',
    ]);
    expect(mappings.every((mapping) => mapping.collisionHash !== null)).toBe(true);
    expect(new Set(mappings.map((mapping) => mapping.relativePath)).size).toBe(2);
  });

  it('does not rename equal leaves stored in different origin or type directories', async () => {
    const mappings = await createResourcePathMappings([
      { url: 'https://one.example.test/shared.bin', resourceType: 'other' },
      { url: 'https://two.example.test/shared.bin', resourceType: 'other' },
      { url: 'https://one.example.test/shared.bin', resourceType: 'data' },
    ]);

    expect(mappings.every((mapping) => mapping.fileName === 'shared.bin')).toBe(true);
    expect(mappings.every((mapping) => mapping.collisionHash === null)).toBe(true);
    expect(new Set(mappings.map((mapping) => mapping.relativePath)).size).toBe(3);
  });

  it('is independent from input order and does not mutate the input array', async () => {
    const inputs: ResourcePathInput[] = [
      { url: 'https://example.test/a/icon.svg', resourceType: 'image' },
      { url: 'https://example.test/b/icon.svg', resourceType: 'image' },
      { url: 'https://example.test/app.js?v=1', resourceType: 'script' },
      { url: 'https://example.test/app.js?v=2', resourceType: 'script' },
    ];
    const snapshot = structuredClone(inputs);
    const forward = await createResourcePathMappings(inputs);
    const reverse = await createResourcePathMappings([...inputs].reverse());

    expect(reverse).toEqual(forward);
    expect(inputs).toEqual(snapshot);
  });

  it('creates a unique, case-insensitive relative path for every normalized URL and type', async () => {
    const inputs: ResourcePathInput[] = [
      { url: 'https://example.test/a/file?.png', resourceType: 'image' },
      { url: 'https://example.test/b/file%2A.png', resourceType: 'image' },
      { url: 'https://example.test/c/FILE_.PNG', resourceType: 'image' },
      { url: 'https://example.test/file_.png?size=1', resourceType: 'image' },
    ];
    const mappings = await createResourcePathMappings(inputs);
    const lookup = await pathsByUrl(inputs);

    expect(mappings).toHaveLength(inputs.length);
    expect(new Set(mappings.map((mapping) => mapping.relativePath.toLowerCase())).size).toBe(
      inputs.length,
    );
    for (const mapping of mappings) {
      expect(lookup.get(mapping.normalizedUrl)?.relativePath).toBe(mapping.relativePath);
    }
  });

  it('returns an empty mapping and rejects malformed inputs', async () => {
    await expect(createResourcePathMappings([])).resolves.toEqual([]);
    await expect(
      createResourcePathMappings(null as unknown as ResourcePathInput[]),
    ).rejects.toThrow('must be an array');
    await expect(
      createResourcePathMappings([null as unknown as ResourcePathInput]),
    ).rejects.toThrow('must be an object');
    await expect(
      createResourcePathMappings([{ url: 'data:text/plain,hello', resourceType: 'data' }]),
    ).rejects.toThrow('HTTP and HTTPS');
    await expect(
      createResourcePathMappings([
        { url: 'https://example.test/file', resourceType: 'binary' as ResourceType },
      ]),
    ).rejects.toThrow('Resource type is not supported');
  });

  it('rejects unsafe generated suffixes', () => {
    expect(() => appendArchiveFileNameSuffix('app.js', '../escape')).toThrow(
      'lowercase letters, digits, or hyphens',
    );
    expect(() => appendArchiveFileNameSuffix('app.js', 'UPPER')).toThrow(
      'lowercase letters, digits, or hyphens',
    );
    expect(() => appendArchiveFileNameSuffix('app.js', 'a'.repeat(235))).toThrow('too long');
  });
});
