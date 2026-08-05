import {
  ARCHIVE_METADATA_PATHS,
  ARCHIVE_RESOURCE_MANIFEST_FORMAT_VERSION,
  buildArchiveLayout,
  buildArchiveResourceManifests,
  createArchiveResourceManifestEntries,
  createResourcePathMappings,
  type ArchiveResourceManifestsInput,
  type ResourcePathMapping,
} from '@sitecapsule/archive';
import { createCaptureError, type ResourceRecord } from '@sitecapsule/domain';
import { describe, expect, it } from 'vitest';

const decoder = new TextDecoder();

async function manifestsInput(): Promise<ArchiveResourceManifestsInput> {
  const finalStylesheetUrl =
    'https://cdn.example.test/assets/app.css?api_key=stylesheet-secret&theme=dark';
  const [stylesheetMapping] = await createResourcePathMappings([
    { url: finalStylesheetUrl, resourceType: 'stylesheet' },
  ]);

  const records: ResourceRecord[] = [
    {
      id: 'document-1',
      jobId: 'job-1',
      originalUrl: 'https://example.test/?session=page-secret&theme=dark#intro',
      referrerUrl: 'https://example.test/',
      type: 'document',
      discoverySources: ['performance', 'dom'],
      mimeType: 'text/html',
      httpStatus: 200,
      localPath: 'index.html',
      byteLength: 1_024,
      state: 'saved',
    },
    {
      id: 'stylesheet-1',
      jobId: 'job-1',
      originalUrl: 'https://assets.example.test/app.css?access_token=redirect-secret',
      finalUrl: finalStylesheetUrl,
      referrerUrl: 'https://example.test/?token=referrer-secret',
      type: 'stylesheet',
      discoverySources: ['css', 'dom', 'css'],
      redirectTrace: {
        complete: true,
        hops: [
          {
            fromUrl: 'https://assets.example.test/app.css?access_token=redirect-secret',
            toUrl: finalStylesheetUrl,
            httpStatus: 302,
          },
        ],
      },
      mimeType: 'text/css',
      httpStatus: 200,
      localPath: stylesheetMapping!.relativePath,
      byteLength: 2_048,
      state: 'saved',
    },
    {
      id: 'image-failed',
      jobId: 'job-1',
      originalUrl: 'https://images.example.test/hero.png?sig=image-secret',
      referrerUrl: 'https://example.test/',
      type: 'image',
      discoverySources: ['performance'],
      mimeType: 'image/png',
      httpStatus: 503,
      state: 'failed',
      error: createCaptureError('network-request-failed', {
        operation: 'resource-download',
        jobId: 'job-1',
        resourceId: 'image-failed',
        url: 'https://images.example.test/hero.png?sig=internal-secret',
        resourceType: 'image',
        stage: 'fetching',
        httpStatus: 503,
        browserError: 'TypeError',
        affectsPrimaryVisual: true,
      }),
    },
    {
      id: 'data-skipped',
      jobId: 'job-1',
      originalUrl: 'data:text/plain,private-inline-payload',
      referrerUrl: 'https://example.test/',
      type: 'data',
      discoverySources: ['dom'],
      state: 'skipped',
    },
  ];

  return {
    jobId: 'job-1',
    resourceRecords: records,
    pathMappings: [stylesheetMapping!],
  };
}

describe('resource, failure, and original URL manifests', () => {
  it('separates saved, failed, and skipped resources into stable versioned manifests', async () => {
    const manifests = buildArchiveResourceManifests(await manifestsInput());

    expect(ARCHIVE_RESOURCE_MANIFEST_FORMAT_VERSION).toBe(1);
    expect(manifests.resources.formatVersion).toBe(1);
    expect(manifests.resources.resources).toHaveLength(2);
    expect(manifests.failures.failures).toHaveLength(1);
    expect(manifests.failures.skipped).toHaveLength(1);
    expect(manifests.originalUrls.mappings).toHaveLength(3);
    expect(manifests.resources.resources.map(({ localPath }) => localPath)).toEqual([
      expect.stringMatching(/^assets\//),
      'index.html',
    ]);
    expect(manifests.failures.failures[0]?.error).toMatchObject({
      code: 'network-request-failed',
      operation: 'resource-download',
      stage: 'fetching',
      httpStatus: 503,
      browserError: 'TypeError',
      affectsPrimaryVisual: true,
    });
    expect(manifests.failures.skipped[0]).toMatchObject({
      originalUrl: 'data:REDACTED',
      error: null,
    });
  });

  it('redacts delivery URLs and excludes internal record and error identifiers', async () => {
    const manifests = buildArchiveResourceManifests(await manifestsInput());
    const serialized = JSON.stringify(manifests);

    expect(serialized).toContain('session=REDACTED');
    expect(serialized).toContain('api_key=REDACTED');
    expect(serialized).toContain('access_token=REDACTED');
    expect(serialized).toContain('sig=REDACTED');
    expect(serialized).not.toContain('page-secret');
    expect(serialized).not.toContain('stylesheet-secret');
    expect(serialized).not.toContain('redirect-secret');
    expect(serialized).not.toContain('referrer-secret');
    expect(serialized).not.toContain('image-secret');
    expect(serialized).not.toContain('internal-secret');
    expect(serialized).not.toContain('private-inline-payload');
    expect(serialized).not.toContain('job-1');
    expect(serialized).not.toContain('image-failed');
  });

  it('emits the three reserved UTF-8 JSON entries with one trailing newline', async () => {
    const input = await manifestsInput();
    const entries = createArchiveResourceManifestEntries(input);

    expect(entries.map(({ path }) => path)).toEqual([
      ARCHIVE_METADATA_PATHS.resources,
      ARCHIVE_METADATA_PATHS.failures,
      ARCHIVE_METADATA_PATHS.originalUrls,
    ]);
    for (const entry of entries) {
      const text = decoder.decode(entry.bytes);
      expect(text.endsWith('\n')).toBe(true);
      expect(text.endsWith('\n\n')).toBe(false);
      expect(() => JSON.parse(text)).not.toThrow();
    }
    expect(
      buildArchiveLayout({ indexHtml: new Uint8Array(), metadata: entries }).counts.metadata,
    ).toBe(3);
  });

  it('produces identical output for different record and mapping orders without mutation', async () => {
    const input = await manifestsInput();
    const reversed: ArchiveResourceManifestsInput = {
      ...input,
      resourceRecords: [...input.resourceRecords].reverse(),
      pathMappings: [...input.pathMappings].reverse(),
    };
    const recordOrder = input.resourceRecords.map(({ id }) => id);

    expect(createArchiveResourceManifestEntries(reversed)).toEqual(
      createArchiveResourceManifestEntries(input),
    );
    expect(input.resourceRecords.map(({ id }) => id)).toEqual(recordOrder);
  });

  it.each(['discovered', 'queued', 'fetching'] as const)(
    'rejects incomplete %s records at the packaging boundary',
    async (state) => {
      const input = await manifestsInput();
      const record = { ...input.resourceRecords[0]!, state };
      expect(() => buildArchiveResourceManifests({ ...input, resourceRecords: [record] })).toThrow(
        'terminal resource state',
      );
    },
  );

  it('enforces resource ownership and unique record IDs', async () => {
    const input = await manifestsInput();
    expect(() =>
      buildArchiveResourceManifests({
        ...input,
        resourceRecords: [{ ...input.resourceRecords[0]!, jobId: 'job-2' }],
        pathMappings: [],
      }),
    ).toThrow('different job');
    expect(() =>
      buildArchiveResourceManifests({
        ...input,
        resourceRecords: [input.resourceRecords[0]!, input.resourceRecords[0]!],
        pathMappings: [],
      }),
    ).toThrow('duplicates resource ID');
  });

  it('requires saved metadata and matching deterministic asset paths', async () => {
    const input = await manifestsInput();
    const stylesheet = input.resourceRecords[1]!;
    expect(() =>
      buildArchiveResourceManifests({
        ...input,
        resourceRecords: [{ ...stylesheet, byteLength: undefined }],
      }),
    ).toThrow('require a byte length');
    expect(() =>
      buildArchiveResourceManifests({
        ...input,
        resourceRecords: [{ ...stylesheet, localPath: 'assets/stylesheets/wrong.css' }],
      }),
    ).toThrow('no matching resource path mapping');
    expect(() =>
      buildArchiveResourceManifests({
        ...input,
        resourceRecords: [stylesheet],
        pathMappings: [],
      }),
    ).toThrow('no matching resource path mapping');
  });

  it('rejects orphan mappings and portable saved-path collisions', async () => {
    const input = await manifestsInput();
    expect(() =>
      buildArchiveResourceManifests({
        ...input,
        resourceRecords: [input.resourceRecords[0]!],
      }),
    ).toThrow('has no saved resource record');
    expect(() =>
      buildArchiveResourceManifests({
        jobId: input.jobId,
        pathMappings: [],
        resourceRecords: [
          { ...input.resourceRecords[0]!, localPath: 'pages/Page.html' },
          { ...input.resourceRecords[0]!, id: 'document-2', localPath: 'pages/page.html' },
        ],
      }),
    ).toThrow('duplicates a saved archive path');
  });

  it('requires failed errors, forbids saved errors, and strips unsaved paths', async () => {
    const input = await manifestsInput();
    const failed = input.resourceRecords[2]!;
    expect(() =>
      buildArchiveResourceManifests({
        jobId: input.jobId,
        pathMappings: [],
        resourceRecords: [{ ...failed, error: undefined }],
      }),
    ).toThrow('require a structured error');
    expect(() =>
      buildArchiveResourceManifests({
        jobId: input.jobId,
        pathMappings: [],
        resourceRecords: [
          { ...input.resourceRecords[0]!, error: createCaptureError('unexpected-error') },
        ],
      }),
    ).toThrow('saved resources cannot have errors');
    expect(() =>
      buildArchiveResourceManifests({
        jobId: input.jobId,
        pathMappings: [],
        resourceRecords: [{ ...failed, localPath: 'assets/images/partial.png' }],
      }),
    ).toThrow('unsaved resources cannot have local paths');
  });

  it('validates response MIME, status, length, and optional hashes', async () => {
    const input = await manifestsInput();
    const document = input.resourceRecords[0]!;
    for (const [change, message] of [
      [{ mimeType: 'Text/HTML; charset=utf-8' }, 'normalized MIME type essence'],
      [{ httpStatus: 404 }, 'successful HTTP status'],
      [{ byteLength: -1 }, 'non-negative safe integer'],
      [{ sha256: 'ABC' }, 'lowercase SHA-256'],
    ] as const) {
      expect(() =>
        buildArchiveResourceManifests({
          jobId: input.jobId,
          pathMappings: [],
          resourceRecords: [{ ...document, ...change }],
        }),
      ).toThrow(message);
    }
  });

  it.each([
    "application/x-vendor'format",
    'application/x-vendor%format',
    'application/x-vendor*format',
    'application/x-vendor`format',
    'application/x-vendor|format',
    'application/x-vendor~format',
  ])(
    'accepts normalized MIME token characters already accepted while fetching: %s',
    async (mimeType) => {
      const input = await manifestsInput();
      const document = input.resourceRecords[0]!;

      expect(() =>
        buildArchiveResourceManifests({
          jobId: input.jobId,
          pathMappings: [],
          resourceRecords: [{ ...document, mimeType }],
        }),
      ).not.toThrow();
    },
  );

  it('validates structured error ownership and HTTP status consistency', async () => {
    const input = await manifestsInput();
    const failed = input.resourceRecords[2]!;
    expect(() =>
      buildArchiveResourceManifests({
        jobId: input.jobId,
        pathMappings: [],
        resourceRecords: [
          {
            ...failed,
            error: createCaptureError('network-request-failed', {
              jobId: 'another-job',
            }),
          },
        ],
      }),
    ).toThrow('job does not match');
    expect(() =>
      buildArchiveResourceManifests({
        jobId: input.jobId,
        pathMappings: [],
        resourceRecords: [
          {
            ...failed,
            error: createCaptureError('network-request-failed', { httpStatus: 502 }),
          },
        ],
      }),
    ).toThrow('HTTP status does not match');
  });

  it('rejects malformed redirects and mappings instead of emitting ambiguous provenance', async () => {
    const input = await manifestsInput();
    const stylesheet = input.resourceRecords[1]!;
    expect(() =>
      buildArchiveResourceManifests({
        ...input,
        resourceRecords: [
          {
            ...stylesheet,
            redirectTrace: {
              complete: true,
              hops: [
                {
                  fromUrl: stylesheet.originalUrl,
                  toUrl: stylesheet.finalUrl!,
                  httpStatus: 200,
                },
              ],
            },
          },
        ],
      }),
    ).toThrow('redirect status');
    expect(() =>
      buildArchiveResourceManifests({
        ...input,
        resourceRecords: [stylesheet],
        pathMappings: [
          { ...input.pathMappings[0]!, normalizedUrl: 'https://cdn.example.test/wrong.css' },
        ] as ResourcePathMapping[],
      }),
    ).toThrow('does not match');
  });

  it('requires an exact top-level input and rejects future record fields', async () => {
    const input = await manifestsInput();
    expect(() => buildArchiveResourceManifests({ ...input, tabId: 42 } as never)).toThrow(
      'exactly the supported fields',
    );
    expect(() =>
      buildArchiveResourceManifests({
        ...input,
        resourceRecords: [{ ...input.resourceRecords[0]!, privateHeader: 'secret' } as never],
        pathMappings: [],
      }),
    ).toThrow('unsupported fields');
  });
});
