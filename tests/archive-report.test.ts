// @vitest-environment happy-dom

import {
  ARCHIVE_METADATA_PATHS,
  buildArchiveManifest,
  buildArchiveResourceManifests,
  createArchiveOfflineReadme,
  createArchiveReportArtifacts,
  createArchiveReportEntries,
  createArchiveReportHtml,
  type ArchiveReportInput,
} from '@sitecapsule/archive';
import { createCaptureError, type ResourceRecord } from '@sitecapsule/domain';
import { describe, expect, it } from 'vitest';

const decoder = new TextDecoder();

function reportInput(locale: ArchiveReportInput['locale'] = 'zh-CN'): ArchiveReportInput {
  const records: ResourceRecord[] = [
    {
      id: 'page',
      jobId: 'job-report',
      originalUrl: 'https://example.test/?token=private&theme=dark',
      referrerUrl: 'https://example.test/',
      type: 'document',
      discoverySources: ['dom'],
      mimeType: 'text/html',
      httpStatus: 200,
      localPath: 'index.html',
      byteLength: 1_536,
      state: 'saved',
    },
    {
      id: 'failed-image',
      jobId: 'job-report',
      originalUrl: 'https://cdn.example.test/hero.png?sig=private',
      referrerUrl: 'https://example.test/',
      type: 'image',
      discoverySources: ['performance'],
      mimeType: 'image/png',
      httpStatus: 503,
      state: 'failed',
      error: createCaptureError('network-request-failed', {
        operation: 'resource-download',
        jobId: 'job-report',
        resourceId: 'failed-image',
        resourceType: 'image',
        stage: 'fetching',
        httpStatus: 503,
        affectsPrimaryVisual: true,
      }),
    },
    {
      id: 'skipped-video',
      jobId: 'job-report',
      originalUrl: 'https://media.example.test/intro.mp4',
      referrerUrl: 'https://example.test/',
      type: 'video',
      discoverySources: ['dom'],
      state: 'skipped',
    },
  ];
  const manifests = buildArchiveResourceManifests({
    jobId: 'job-report',
    resourceRecords: records,
    pathMappings: [],
  });
  return {
    locale,
    archiveManifest: buildArchiveManifest({
      capturedAt: '2026-07-29T08:30:00.000Z',
      startUrl: 'https://example.test/?token=private&theme=dark',
      finalUrl: 'https://example.test/?theme=dark',
      mode: 'current-page',
      captureProfile: 'standard',
      pages: 1,
      resources: 1,
      failedResources: 1,
      requiresLocalHttpServer: true,
      onlineDependencies: [
        'https://api.example.test/live?api_key=private&lang=zh',
        'https://cdn.example.test/hero.png?sig=private',
      ],
    }),
    resourceManifest: manifests.resources,
    failureManifest: manifests.failures,
    knownLimitations: ['Canvas pixels are not serialized.', 'Closed shadow roots are unavailable.'],
  };
}

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('offline archive report artifacts', () => {
  it('renders a self-contained Chinese report with counts matching machine manifests', () => {
    const input = reportInput();
    const html = createArchiveReportHtml(input);
    const document = parseHtml(html);

    expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.title).toContain('example.test');
    expect(document.body.textContent).toContain('已保存资源');
    expect(document.body.textContent).toContain('失败资源 (1)');
    expect(document.body.textContent).toContain('跳过资源 (1)');
    expect(document.body.textContent).toContain('1.50 KiB');
    expect(document.body.textContent).toContain('python3 -m http.server 8000 --bind 127.0.0.1');
    expect(document.body.textContent).not.toContain('private');
  });

  it('renders an English report from the same stable machine manifests', () => {
    const html = createArchiveReportHtml(reportInput('en'));
    const document = parseHtml(html);

    expect(document.documentElement.lang).toBe('en');
    expect(document.body.textContent).toContain('Capture summary');
    expect(document.body.textContent).toContain('Failed resources (1)');
    expect(document.body.textContent).toContain('Online dependencies (2)');
    expect(document.body.textContent).not.toContain('资源请求失败');
  });

  it('contains no executable script, remote stylesheet, remote image, form, or base element', () => {
    const document = parseHtml(createArchiveReportHtml(reportInput()));

    expect(document.querySelectorAll('script, form, base, iframe, object, embed')).toHaveLength(0);
    expect(document.querySelectorAll('link[rel="stylesheet"], img, video, audio')).toHaveLength(0);
    expect(
      [...document.querySelectorAll('[src], link[href]')].filter((element) => {
        const reference = element.getAttribute('src') ?? element.getAttribute('href') ?? '';
        return /^https?:/i.test(reference);
      }),
    ).toHaveLength(0);
    expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]')).not.toBeNull();
  });

  it('escapes dynamic report text in both HTML and Markdown contexts', () => {
    const input = reportInput();
    input.knownLimitations = ['<img src=x onerror=alert(1)>', '[unsafe](javascript:alert(1))'];
    const failure = input.failureManifest.failures[0]!;
    input.failureManifest = {
      ...input.failureManifest,
      failures: [
        {
          ...failure,
          error: { ...failure.error!, message: '</td><script>alert(1)</script>' },
        },
      ],
    };

    const html = createArchiveReportHtml(input);
    const readme = createArchiveOfflineReadme(input);
    const document = parseHtml(html);

    expect(document.querySelectorAll('script, img')).toHaveLength(0);
    expect(document.body.textContent).toContain('</td><script>alert(1)</script>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(readme).toContain('- `<img src=x onerror=alert(1)>`');
    expect(readme).toContain('- `[unsafe](javascript:alert(1))`');
    expect(readme).not.toContain('- <img src=x');
    expect(readme).not.toContain('- [unsafe](javascript:alert(1))');
  });

  it('creates the reserved report and README entries as UTF-8 text', () => {
    const input = reportInput();
    const entries = createArchiveReportEntries(input);

    expect(entries.map(({ path }) => path)).toEqual([
      ARCHIVE_METADATA_PATHS.report,
      ARCHIVE_METADATA_PATHS.offlineReadme,
    ]);
    expect(decoder.decode(entries[0]!.bytes)).toBe(createArchiveReportHtml(input));
    expect(decoder.decode(entries[1]!.bytes)).toBe(createArchiveOfflineReadme(input));
    expect(entries.every(({ bytes }) => bytes instanceof Uint8Array)).toBe(true);
  });

  it('documents archive files, local HTTP viewing, failures, skips, and dependencies in README', () => {
    const readme = createArchiveOfflineReadme(reportInput('en'));

    expect(readme).toContain('# SiteCapsule archive report');
    expect(readme).toContain('`index.html`');
    expect(readme).toContain('`_sitecapsule/resources.json`');
    expect(readme).toContain('network-request-failed');
    expect(readme).toContain('https://media.example.test/intro.mp4');
    expect(readme).toContain('api_key=REDACTED');
    expect(readme.endsWith('\n')).toBe(true);
  });

  it('uses direct-open guidance when a local HTTP server is not required', () => {
    const input = reportInput('en');
    input.archiveManifest = { ...input.archiveManifest, requiresLocalHttpServer: false };

    expect(createArchiveReportHtml(input)).toContain(
      'You can open index.html directly, but a local HTTP server is more reliable.',
    );
  });

  it('returns both deterministic artifacts without mutating limitations or manifests', () => {
    const input = reportInput();
    input.knownLimitations = ['Z limitation', 'A limitation', 'Z limitation'];
    const limitationSnapshot = [...input.knownLimitations];
    const first = createArchiveReportArtifacts(input);
    const second = createArchiveReportArtifacts({
      ...input,
      knownLimitations: [...input.knownLimitations].reverse(),
    });

    expect(first).toEqual(second);
    expect(input.knownLimitations).toEqual(limitationSnapshot);
  });

  it('rejects saved and failed count mismatches against the machine manifests', () => {
    const input = reportInput();
    expect(() =>
      createArchiveReportArtifacts({
        ...input,
        archiveManifest: { ...input.archiveManifest, resources: 2 },
      }),
    ).toThrow('saved resource count does not match');
    expect(() =>
      createArchiveReportArtifacts({
        ...input,
        archiveManifest: { ...input.archiveManifest, failedResources: 0 },
      }),
    ).toThrow('failed resource count does not match');
  });

  it('rejects unsupported and non-canonical manifest versions', () => {
    const input = reportInput();
    expect(() =>
      createArchiveReportHtml({
        ...input,
        archiveManifest: { ...input.archiveManifest, formatVersion: 2 as never },
      }),
    ).toThrow('unsupported format version');
    expect(() =>
      createArchiveReportHtml({
        ...input,
        resourceManifest: { ...input.resourceManifest, formatVersion: 2 as never },
      }),
    ).toThrow('not a supported resource manifest');
  });

  it('rejects malformed resource rows before interpolating them', () => {
    const input = reportInput();
    expect(() =>
      createArchiveReportHtml({
        ...input,
        resourceManifest: {
          ...input.resourceManifest,
          resources: [{ ...input.resourceManifest.resources[0]!, byteLength: -1 }],
        },
      }),
    ).toThrow('non-negative safe integer');
    expect(() =>
      createArchiveReportHtml({
        ...input,
        failureManifest: {
          ...input.failureManifest,
          failures: [{ ...input.failureManifest.failures[0]!, resourceType: 'binary' as never }],
        },
      }),
    ).toThrow('not a supported resource type');
    expect(() =>
      createArchiveReportHtml({
        ...input,
        failureManifest: {
          ...input.failureManifest,
          failures: [
            {
              ...input.failureManifest.failures[0]!,
              error: {
                ...input.failureManifest.failures[0]!.error!,
                message: 'first line\nsecond line',
              },
            },
          ],
        },
      }),
    ).toThrow('must be one line');
  });

  it('requires a supported locale, exact top-level fields, and one-line limitations', () => {
    const input = reportInput();
    expect(() => createArchiveReportHtml({ ...input, locale: 'fr' as never })).toThrow(
      'locale is not supported',
    );
    expect(() => createArchiveReportHtml({ ...input, tabId: 42 } as never)).toThrow(
      'exactly the supported fields',
    );
    expect(() =>
      createArchiveReportHtml({ ...input, knownLimitations: ['line one\nline two'] }),
    ).toThrow('must be one line');
  });
});
