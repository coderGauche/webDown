// @vitest-environment happy-dom

import {
  collectUncapturedDependencies,
  rewriteCssResource,
  rewriteHtmlResource,
  type CssRewriteResult,
} from '@sitecapsule/archive';
import { createCaptureError, type ResourceRecord } from '@sitecapsule/domain';
import { describe, expect, it } from 'vitest';

const DOCUMENT_URL = 'https://page.example.test/index.html';
const BASE_URL = 'https://cdn.example.test/assets/';
const DOCUMENT_PATH = 'assets/origins/https/dns-page.example.test/default/documents/index.html';

function resourceRecord(
  id: string,
  originalUrl: string,
  state: ResourceRecord['state'],
  options: Pick<ResourceRecord, 'finalUrl' | 'error'> = {},
): ResourceRecord {
  return {
    id,
    jobId: 'job-1',
    originalUrl,
    referrerUrl: DOCUMENT_URL,
    type: 'image',
    discoverySources: ['dom'],
    state,
    ...options,
  };
}

function createFixture() {
  const htmlResult = rewriteHtmlResource({
    html: `<html><head><style>
      .missing { background: url(missing.png#css); }
      .embedded { mask-image: url(data:image/png;base64,AAAA); filter: url(#local-filter); }
    </style></head><body>
      <img src="missing.png">
      <img src="data:image/png;base64,BBBB">
      <script src="ftp://files.example.test/app.js"></script>
      <img src="http://[">
      <img srcset="missing.png 1x, skipped.png 2x, #local 3x, blob:https://cdn.example.test/id 4x, invalid.png 0w">
    </body></html>`,
    documentUrl: DOCUMENT_URL,
    baseUrl: BASE_URL,
    documentPath: DOCUMENT_PATH,
    savedResourceMappings: [],
  });
  const standaloneCss = rewriteCssResource({
    cssText: '@import "standalone.css"; .invalid { background: url(http://[); }',
    context: 'stylesheet',
    baseUrl: BASE_URL,
    sourcePath: 'assets/origins/https/dns-cdn.example.test/default/css/main.css',
    savedResourceMappings: [],
  });
  const parseError: CssRewriteResult = {
    cssText: 'broken',
    context: 'stylesheet',
    sourcePath: 'assets/origins/https/dns-cdn.example.test/default/css/broken.css',
    rewrittenCount: 0,
    parseError: true,
    references: [],
  };
  const records = [
    resourceRecord('failed-1', 'https://origin.example.test/redirect', 'failed', {
      finalUrl: `${BASE_URL}missing.png#response`,
      error: createCaptureError('network-request-failed', {
        operation: 'resource-download',
        resourceId: 'failed-1',
        url: `${BASE_URL}missing.png`,
      }),
    }),
    resourceRecord('skipped-1', `${BASE_URL}skipped.png`, 'skipped'),
  ];
  return { htmlResult, standaloneCss, parseError, records };
}

describe('uncaptured online dependency reporting', () => {
  it('deduplicates online URLs and retains complete cross-channel provenance', () => {
    const { htmlResult, standaloneCss, parseError, records } = createFixture();
    const report = collectUncapturedDependencies({
      htmlResults: [htmlResult],
      cssResults: [standaloneCss, parseError],
      resourceRecords: records,
    });

    expect(report.uniqueOnlineDependencies).toBe(3);
    expect(report.onlineOccurrences).toBe(5);
    expect(
      report.dependencies.map(
        ({ normalizedUrl, reason, occurrenceCount, channels, resourceStates, errorCodes }) => ({
          normalizedUrl,
          reason,
          occurrenceCount,
          channels,
          resourceStates,
          errorCodes,
        }),
      ),
    ).toEqual([
      {
        normalizedUrl: `${BASE_URL}missing.png`,
        reason: 'download-failed',
        occurrenceCount: 3,
        channels: ['html-attribute', 'css-ast', 'srcset'],
        resourceStates: ['failed'],
        errorCodes: ['network-request-failed'],
      },
      {
        normalizedUrl: `${BASE_URL}skipped.png`,
        reason: 'resource-skipped',
        occurrenceCount: 1,
        channels: ['srcset'],
        resourceStates: ['skipped'],
        errorCodes: [],
      },
      {
        normalizedUrl: `${BASE_URL}standalone.css`,
        reason: 'missing-mapping',
        occurrenceCount: 1,
        channels: ['css-ast'],
        resourceStates: [],
        errorCodes: [],
      },
    ]);
    expect(report.dependencies[0]?.sources).toMatchObject([
      {
        channel: 'html-attribute',
        sourcePath: DOCUMENT_PATH,
        tagName: 'img',
        attributeName: 'src',
      },
      {
        channel: 'css-ast',
        sourcePath: DOCUMENT_PATH,
        hostTagName: 'style',
        kind: 'url',
      },
      {
        channel: 'srcset',
        sourcePath: DOCUMENT_PATH,
        hostTagName: 'img',
        descriptor: '1x',
      },
    ]);
  });

  it('keeps non-network and invalid retained references out of the dependency list', () => {
    const { htmlResult, standaloneCss, parseError } = createFixture();
    const report = collectUncapturedDependencies({
      htmlResults: [htmlResult],
      cssResults: [standaloneCss, parseError],
    });

    expect(report.retainedReferences).toEqual({
      data: 2,
      blob: 1,
      fragment: 2,
      unsupportedProtocol: 1,
      invalid: 3,
      cssParseError: 1,
    });
    expect(
      report.dependencies.every((dependency) => dependency.normalizedUrl.startsWith('http')),
    ).toBe(true);
  });

  it('produces the same report regardless of top-level input order', () => {
    const { htmlResult, standaloneCss, parseError, records } = createFixture();
    const forward = collectUncapturedDependencies({
      htmlResults: [htmlResult],
      cssResults: [standaloneCss, parseError],
      resourceRecords: records,
    });
    const reverse = collectUncapturedDependencies({
      htmlResults: [htmlResult],
      cssResults: [parseError, standaloneCss],
      resourceRecords: [...records].reverse(),
    });

    expect(reverse).toEqual(forward);
  });

  it('returns an empty report for empty inputs', () => {
    expect(collectUncapturedDependencies({})).toEqual({
      dependencies: [],
      uniqueOnlineDependencies: 0,
      onlineOccurrences: 0,
      retainedReferences: {
        data: 0,
        blob: 0,
        fragment: 0,
        unsupportedProtocol: 0,
        invalid: 0,
        cssParseError: 0,
      },
    });
  });

  it('rejects invalid option arrays and malformed resource outcomes', () => {
    expect(() => collectUncapturedDependencies(null as never)).toThrow('options are required');
    expect(() => collectUncapturedDependencies({ htmlResults: null as never })).toThrow(
      'inputs must be arrays',
    );
    expect(() =>
      collectUncapturedDependencies({ resourceRecords: [null as unknown as ResourceRecord] }),
    ).toThrow('must be an object');
    expect(() =>
      collectUncapturedDependencies({
        resourceRecords: [
          resourceRecord('bad-error', `${BASE_URL}image.png`, 'failed', {
            error: { code: 'network-request-failed' } as ResourceRecord['error'],
          }),
        ],
      }),
    ).toThrow('error is invalid');
  });
});
