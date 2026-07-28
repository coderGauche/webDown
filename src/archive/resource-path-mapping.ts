import type { ResourceType } from '@sitecapsule/domain';

import { appendArchiveFileNameSuffix, createResourceFileName } from './resource-file-name';
import { createResourceDirectoryMapping } from './resource-directory';

export const ARCHIVE_HASH_HEX_LENGTH = 12;
const COLLISION_HASH_LENGTH_STEP = 4;
const SHA_256_HEX_LENGTH = 64;

export type ResourcePathInput = {
  url: string;
  resourceType: ResourceType;
};

export type ResourcePathMapping = {
  normalizedUrl: string;
  originalUrls: readonly string[];
  resourceType: ResourceType;
  directoryPath: string;
  baseFileName: string;
  queryHash: string | null;
  collisionHash: string | null;
  fileName: string;
  relativePath: string;
};

type PendingPathMapping = Omit<
  ResourcePathMapping,
  'queryHash' | 'collisionHash' | 'fileName' | 'relativePath'
> & {
  identity: string;
  fullHash: string;
  queryHash: string | null;
  queriedFileName: string;
  collisionHashLength: number;
};

const UTF8_ENCODER = new TextEncoder();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function bytesToHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createStableArchiveHash(value: string): Promise<string> {
  if (typeof value !== 'string') throw new TypeError('Archive hash input must be a string.');
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable.');

  return bytesToHex(await globalThis.crypto.subtle.digest('SHA-256', UTF8_ENCODER.encode(value)));
}

export async function createQueryHash(search: string): Promise<string | null> {
  if (typeof search !== 'string') throw new TypeError('Query string must be a string.');
  if (search === '' || search === '?') return null;

  const query = search.startsWith('?') ? search.slice(1) : search;
  return (await createStableArchiveHash(query)).slice(0, ARCHIVE_HASH_HEX_LENGTH);
}

function pathKey(directoryPath: string, fileName: string): string {
  return `${directoryPath}/${fileName}`.normalize('NFC').toLowerCase();
}

function currentFileName(mapping: PendingPathMapping): string {
  if (mapping.collisionHashLength === 0) return mapping.queriedFileName;
  return appendArchiveFileNameSuffix(
    mapping.queriedFileName,
    `c-${mapping.fullHash.slice(0, mapping.collisionHashLength)}`,
  );
}

function collisionGroups(mappings: readonly PendingPathMapping[]): PendingPathMapping[][] {
  const groups = new Map<string, PendingPathMapping[]>();
  for (const mapping of mappings) {
    const key = pathKey(mapping.directoryPath, currentFileName(mapping));
    const group = groups.get(key);
    if (group) group.push(mapping);
    else groups.set(key, [mapping]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function resolvePathConflicts(mappings: readonly PendingPathMapping[]): void {
  while (true) {
    const conflicts = collisionGroups(mappings);
    if (conflicts.length === 0) return;

    for (const group of conflicts) {
      for (const mapping of group) {
        mapping.collisionHashLength =
          mapping.collisionHashLength === 0
            ? ARCHIVE_HASH_HEX_LENGTH
            : mapping.collisionHashLength + COLLISION_HASH_LENGTH_STEP;
        if (mapping.collisionHashLength > SHA_256_HEX_LENGTH) {
          throw new Error('Unable to resolve archive path hash collision.');
        }
      }
    }
  }
}

export async function createResourcePathMappings(
  inputs: readonly ResourcePathInput[],
): Promise<ResourcePathMapping[]> {
  if (!Array.isArray(inputs)) throw new TypeError('Resource path inputs must be an array.');

  const uniqueInputs = new Map<
    string,
    {
      normalizedUrl: string;
      originalUrls: Set<string>;
      resourceType: ResourceType;
      directoryPath: string;
      baseFileName: string;
    }
  >();

  for (const input of [...inputs]) {
    if (!input || typeof input !== 'object') {
      throw new TypeError('Resource path input must be an object.');
    }

    const directory = createResourceDirectoryMapping(input.url, input.resourceType);
    const identity = `${input.resourceType}\u0000${directory.normalizedUrl}`;
    const existing = uniqueInputs.get(identity);
    if (existing) {
      existing.originalUrls.add(input.url);
      continue;
    }

    uniqueInputs.set(identity, {
      normalizedUrl: directory.normalizedUrl,
      originalUrls: new Set([input.url]),
      resourceType: input.resourceType,
      directoryPath: directory.directoryPath,
      baseFileName: createResourceFileName(directory.normalizedUrl, input.resourceType),
    });
  }

  const sortedInputs = [...uniqueInputs.entries()].sort(([left], [right]) =>
    compareText(left, right),
  );
  const mappings = await Promise.all(
    sortedInputs.map(async ([identity, input]): Promise<PendingPathMapping> => {
      const search = new URL(input.normalizedUrl).search;
      const queryHash = await createQueryHash(search);
      return {
        ...input,
        originalUrls: [...input.originalUrls].sort(compareText),
        identity,
        fullHash: await createStableArchiveHash(identity),
        queryHash,
        queriedFileName:
          queryHash === null
            ? input.baseFileName
            : appendArchiveFileNameSuffix(input.baseFileName, `q-${queryHash}`),
        collisionHashLength: 0,
      };
    }),
  );

  resolvePathConflicts(mappings);

  return mappings.map((mapping) => {
    const fileName = currentFileName(mapping);
    const collisionHash =
      mapping.collisionHashLength === 0
        ? null
        : mapping.fullHash.slice(0, mapping.collisionHashLength);
    return {
      normalizedUrl: mapping.normalizedUrl,
      originalUrls: mapping.originalUrls,
      resourceType: mapping.resourceType,
      directoryPath: mapping.directoryPath,
      baseFileName: mapping.baseFileName,
      queryHash: mapping.queryHash,
      collisionHash,
      fileName,
      relativePath: `${mapping.directoryPath}/${fileName}`,
    };
  });
}
