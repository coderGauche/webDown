import { ARCHIVE_ASSET_ROOT } from './resource-directory';
import { sanitizeArchiveFileName } from './resource-file-name';
import { validateArchivePath } from './rewrite-support';
import {
  createZipArchiveSync,
  type CreateZipArchiveOptions,
  type ZipArchiveEntry,
} from './zip-codec';

export const ARCHIVE_INDEX_PATH = 'index.html';
export const ARCHIVE_PAGES_ROOT = 'pages';
export const ARCHIVE_METADATA_ROOT = '_sitecapsule';
export const ARCHIVE_SCREENSHOTS_ROOT = 'screenshots';

export const ARCHIVE_METADATA_PATHS = {
  archive: `${ARCHIVE_METADATA_ROOT}/archive.json`,
  resources: `${ARCHIVE_METADATA_ROOT}/resources.json`,
  failures: `${ARCHIVE_METADATA_ROOT}/failures.json`,
  originalUrls: `${ARCHIVE_METADATA_ROOT}/original-urls.json`,
  report: `${ARCHIVE_METADATA_ROOT}/report.html`,
  offlineReadme: `${ARCHIVE_METADATA_ROOT}/README_OFFLINE.md`,
} as const;

export type ArchiveMetadataPath =
  (typeof ARCHIVE_METADATA_PATHS)[keyof typeof ARCHIVE_METADATA_PATHS];

export interface ArchiveLayoutInput {
  indexHtml: Uint8Array;
  pages?: readonly ZipArchiveEntry[];
  assets?: readonly ZipArchiveEntry[];
  metadata?: readonly ZipArchiveEntry[];
  screenshots?: readonly ZipArchiveEntry[];
}

export interface ArchiveLayoutCounts {
  pages: number;
  assets: number;
  metadata: number;
  screenshots: number;
  total: number;
}

export interface ArchiveLayout {
  entries: ZipArchiveEntry[];
  counts: ArchiveLayoutCounts;
}

type ArchiveLayoutCollection = Exclude<keyof ArchiveLayoutInput, 'indexHtml'>;

const COLLECTION_ROOTS = {
  pages: ARCHIVE_PAGES_ROOT,
  assets: ARCHIVE_ASSET_ROOT,
  metadata: ARCHIVE_METADATA_ROOT,
  screenshots: ARCHIVE_SCREENSHOTS_ROOT,
} as const satisfies Record<ArchiveLayoutCollection, string>;

const METADATA_PATH_SET = new Set<string>(Object.values(ARCHIVE_METADATA_PATHS));

function compareEntries(left: ZipArchiveEntry, right: ZipArchiveEntry): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function validatePortableArchivePath(path: string, label: string): void {
  const segments = validateArchivePath(path, label);
  for (const segment of segments) {
    if (sanitizeArchiveFileName(segment) !== segment) {
      throw new TypeError(`${label} contains a non-portable path segment.`);
    }
  }
}

function normalizeCollection(
  collection: ArchiveLayoutCollection,
  entries: readonly ZipArchiveEntry[] | undefined,
): ZipArchiveEntry[] {
  if (entries === undefined) return [];
  if (!Array.isArray(entries)) {
    throw new TypeError(`Archive ${collection} entries must be an array.`);
  }

  const root = COLLECTION_ROOTS[collection];
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new TypeError(`Archive ${collection} entry at index ${index} must be an object.`);
    }
    const label = `Archive ${collection} entry path at index ${index}`;
    validatePortableArchivePath(entry.path, label);
    if (!entry.path.startsWith(`${root}/`)) {
      throw new RangeError(`Archive ${collection} entry must be stored under ${root}/.`);
    }
    if (collection === 'metadata' && !METADATA_PATH_SET.has(entry.path)) {
      throw new RangeError(`Archive metadata entry path is not reserved: ${entry.path}`);
    }
    if (!(entry.bytes instanceof Uint8Array)) {
      throw new TypeError(
        `Archive ${collection} entry bytes at index ${index} must be a Uint8Array.`,
      );
    }
    return { path: entry.path, bytes: new Uint8Array(entry.bytes) };
  });
}

function ensureUniquePortablePaths(entries: readonly ZipArchiveEntry[]): void {
  const paths = new Map<string, string>();
  for (const entry of entries) {
    const portableKey = entry.path.normalize('NFC').toLowerCase();
    const existingPath = paths.get(portableKey);
    if (existingPath !== undefined) {
      throw new Error(
        `Archive paths collide after portable normalization: ${existingPath}, ${entry.path}`,
      );
    }
    paths.set(portableKey, entry.path);
  }
}

export function buildArchiveLayout(input: ArchiveLayoutInput): ArchiveLayout {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Archive layout input must be an object.');
  }
  if (!(input.indexHtml instanceof Uint8Array)) {
    throw new TypeError('Archive index HTML must be a Uint8Array.');
  }

  const pages = normalizeCollection('pages', input.pages);
  const assets = normalizeCollection('assets', input.assets);
  const metadata = normalizeCollection('metadata', input.metadata);
  const screenshots = normalizeCollection('screenshots', input.screenshots);
  const entries = [
    { path: ARCHIVE_INDEX_PATH, bytes: new Uint8Array(input.indexHtml) },
    ...pages,
    ...assets,
    ...metadata,
    ...screenshots,
  ];

  ensureUniquePortablePaths(entries);
  entries.sort(compareEntries);

  return {
    entries,
    counts: {
      pages: pages.length,
      assets: assets.length,
      metadata: metadata.length,
      screenshots: screenshots.length,
      total: entries.length,
    },
  };
}

export function createArchiveLayoutZipSync(
  input: ArchiveLayoutInput,
  options?: CreateZipArchiveOptions,
): Uint8Array {
  return createZipArchiveSync(buildArchiveLayout(input).entries, options);
}
