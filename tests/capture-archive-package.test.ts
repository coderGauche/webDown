// @vitest-environment happy-dom

import {
  ARCHIVE_METADATA_PATHS,
  createArchiveSha256Hex,
  createCaptureArchivePackage,
  createResourcePathMappings,
  extractZipArchiveSync,
} from '@sitecapsule/archive';
import {
  createCaptureError,
  type CaptureJob,
  type CaptureSettings,
  type ResourceRecord,
} from '@sitecapsule/domain';
import { DOMParser as LinkedomDOMParser } from 'linkedom';
import { describe, expect, it } from 'vitest';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const settings: CaptureSettings = {
  archiveFileName: 'fixture.zip',
  renderWaitMs: 0,
  maxConcurrentRequests: 4,
  includeMedia: false,
  includeScripts: true,
  includeThirdPartyResources: true,
  autoScroll: false,
  maxDepth: 0,
  maxPages: 1,
  allowedUrlPatterns: [],
  blockedUrlPatterns: [],
  maxFileSizeBytes: null,
  maxTotalSizeBytes: null,
};

function job(): CaptureJob {
  return {
    id: 'job-package',
    tabId: 1,
    startUrl: 'https://example.test/?token=start-secret',
    mode: 'current-page',
    profile: 'standard',
    status: 'packaging',
    settings,
    counters: {
      pagesDiscovered: 1,
      pagesCaptured: 1,
      resourcesDiscovered: 4,
      resourcesSaved: 2,
      resourcesFailed: 1,
      resourcesSkipped: 1,
      bytesWritten: 0,
    },
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:01.000Z',
  };
}

const parser = {
  parseFromString(input: string, mimeType: 'text/html') {
    return new LinkedomDOMParser().parseFromString(input, mimeType) as unknown as Document;
  },
};

describe('runtime capture archive package', () => {
  it('writes complete manifests, hashes, failure diagnostics, and a self-contained report', async () => {
    const stylesheetUrl = 'https://cdn.example.test/site.css?theme=dark';
    const [stylesheetMapping] = await createResourcePathMappings([
      { url: stylesheetUrl, resourceType: 'stylesheet' },
    ]);
    const stylesheetBytes = encoder.encode('body { color: #123; }');
    const indexBytes = encoder.encode(
      `<!doctype html><html><head><link rel="stylesheet" href="${stylesheetMapping!.relativePath}"></head><body><h1>Offline</h1></body></html>`,
    );
    const resources: ResourceRecord[] = [
      {
        id: 'document',
        jobId: 'job-package',
        originalUrl: 'https://example.test/?session=document-secret',
        finalUrl: 'https://example.test/?session=document-secret',
        referrerUrl: 'https://example.test/',
        type: 'document',
        discoverySources: ['dom'],
        mimeType: 'text/html',
        httpStatus: 200,
        localPath: 'index.html',
        byteLength: indexBytes.byteLength,
        state: 'saved',
      },
      {
        id: 'stylesheet',
        jobId: 'job-package',
        originalUrl: stylesheetUrl,
        referrerUrl: 'https://example.test/',
        type: 'stylesheet',
        discoverySources: ['dom'],
        mimeType: 'text/css',
        httpStatus: 200,
        localPath: stylesheetMapping!.relativePath,
        byteLength: stylesheetBytes.byteLength,
        state: 'saved',
      },
      {
        id: 'failed-image',
        jobId: 'job-package',
        originalUrl: 'https://img.example.test/hero.png?api_key=image-secret',
        referrerUrl: 'https://example.test/',
        type: 'image',
        discoverySources: ['performance'],
        httpStatus: 503,
        state: 'failed',
        error: createCaptureError('network-request-failed', {
          operation: 'resource-download',
          httpStatus: 503,
          resourceId: 'failed-image',
        }),
      },
      {
        id: 'skipped-script',
        jobId: 'job-package',
        originalUrl: 'https://scripts.example.test/tracker.js',
        referrerUrl: 'https://example.test/',
        type: 'script',
        discoverySources: ['performance'],
        state: 'skipped',
      },
    ];

    const result = await createCaptureArchivePackage({
      job: job(),
      finalUrl: 'https://example.test/?token=final-secret',
      resourceRecords: resources,
      pathMappings: [stylesheetMapping!],
      indexHtml: indexBytes,
      assets: [{ path: stylesheetMapping!.relativePath, bytes: stylesheetBytes }],
      locale: 'en',
      knownLimitations: ['Fixture limitation.'],
      parser,
    });
    const extracted = extractZipArchiveSync(result.archiveBytes);
    const entries = new Map(extracted.map((entry) => [entry.path, entry.bytes]));

    expect([...entries.keys()].sort()).toEqual(
      [
        'index.html',
        stylesheetMapping!.relativePath,
        ...Object.values(ARCHIVE_METADATA_PATHS),
      ].sort(),
    );
    const archiveManifest = JSON.parse(
      decoder.decode(entries.get(ARCHIVE_METADATA_PATHS.archive)!),
    );
    const resourceManifest = JSON.parse(
      decoder.decode(entries.get(ARCHIVE_METADATA_PATHS.resources)!),
    );
    const failureManifest = JSON.parse(
      decoder.decode(entries.get(ARCHIVE_METADATA_PATHS.failures)!),
    );
    const report = decoder.decode(entries.get(ARCHIVE_METADATA_PATHS.report)!);

    expect(archiveManifest).toMatchObject({
      resources: 2,
      failedResources: 1,
      requiresLocalHttpServer: true,
    });
    expect(JSON.stringify(archiveManifest)).not.toContain('start-secret');
    expect(JSON.stringify(archiveManifest)).not.toContain('final-secret');
    expect(failureManifest.failures).toHaveLength(1);
    expect(failureManifest.skipped).toHaveLength(1);
    expect(JSON.stringify(failureManifest)).not.toContain('image-secret');
    expect(report).toContain('Failed resources');
    expect(report).toContain('Fixture limitation.');
    expect(report).not.toMatch(/<script\b/i);

    for (const resource of resourceManifest.resources) {
      const bytes = entries.get(resource.localPath);
      if (!bytes) throw new Error(`Missing packaged resource: ${resource.localPath}`);
      expect(resource.byteLength).toBe(bytes.byteLength);
      await expect(createArchiveSha256Hex(bytes)).resolves.toBe(resource.sha256);
    }
  });

  it('packages secondary documents as assets instead of requiring another page path', async () => {
    const secondaryUrl = 'https://example.test/templates/section.html';
    const [secondaryMapping] = await createResourcePathMappings([
      { url: secondaryUrl, resourceType: 'document' },
    ]);
    const indexBytes = encoder.encode('<!doctype html><html><body>Offline</body></html>');
    const secondaryBytes = encoder.encode('<section>Saved template</section>');
    const resources: ResourceRecord[] = [
      {
        id: 'job-package:document',
        jobId: 'job-package',
        originalUrl: 'https://example.test/',
        finalUrl: 'https://example.test/',
        referrerUrl: 'https://example.test/',
        type: 'document',
        discoverySources: ['dom'],
        mimeType: 'text/html',
        httpStatus: 200,
        localPath: 'index.html',
        byteLength: indexBytes.byteLength,
        state: 'saved',
      },
      {
        id: 'job-package:script-resource:1',
        jobId: 'job-package',
        originalUrl: secondaryUrl,
        finalUrl: secondaryUrl,
        referrerUrl: 'https://example.test/app.js',
        type: 'document',
        discoverySources: ['crawler'],
        mimeType: 'text/html',
        httpStatus: 200,
        localPath: secondaryMapping!.relativePath,
        byteLength: secondaryBytes.byteLength,
        state: 'saved',
      },
    ];

    const result = await createCaptureArchivePackage({
      job: job(),
      finalUrl: 'https://example.test/',
      resourceRecords: resources,
      pathMappings: [secondaryMapping!],
      indexHtml: indexBytes,
      assets: [{ path: secondaryMapping!.relativePath, bytes: secondaryBytes }],
      locale: 'en',
      knownLimitations: ['Fixture limitation.'],
      parser,
    });
    const entries = new Map(
      extractZipArchiveSync(result.archiveBytes).map((entry) => [entry.path, entry.bytes]),
    );

    expect(secondaryMapping!.relativePath).toContain('/documents/');
    expect(decoder.decode(entries.get(secondaryMapping!.relativePath))).toBe(
      '<section>Saved template</section>',
    );
    expect(result.resourceManifest.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localPath: secondaryMapping!.relativePath,
          resourceType: 'document',
        }),
      ]),
    );
  });
});
