// @vitest-environment happy-dom

import {
  SERVICE_WORKER_GUARD_HASH_SOURCE,
  buildCssContentChangeReport,
  combineContentChangeReports,
  createResourcePathMappings,
  rewriteCssResource,
  rewriteHtmlResource,
} from '@sitecapsule/archive';
import { describe, expect, it } from 'vitest';

const DOCUMENT_URL = 'https://page.example.test/index.html';
const BASE_URL = 'https://cdn.example.test/assets/';
const DOCUMENT_PATH = 'assets/origins/https/dns-page.example.test/default/documents/index.html';

describe('HTML content change audit report', () => {
  it('reports every intentional rewrite in deterministic pipeline order', async () => {
    const mappings = await createResourcePathMappings([
      { url: `${BASE_URL}hero.png`, resourceType: 'image' },
      { url: `${BASE_URL}retina.png`, resourceType: 'image' },
      { url: `${BASE_URL}background.png`, resourceType: 'image' },
    ]);
    const options = {
      html: `<html><head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; img-src 'none'">
        <base href="${BASE_URL}">
        <style>.hero { background: url(background.png); }</style>
      </head><body>
        <img src="hero.png" srcset="retina.png 2x">
        <script>navigator.serviceWorker.register('/sw.js')</script>
      </body></html>`,
      documentUrl: DOCUMENT_URL,
      baseUrl: BASE_URL,
      documentPath: DOCUMENT_PATH,
      savedResourceMappings: mappings,
    } as const;
    const first = rewriteHtmlResource(options);
    const second = rewriteHtmlResource(options);

    expect(second.contentChanges).toEqual(first.contentChanges);
    expect(first.contentChanges.totalChanges).toBe(7);
    expect(first.contentChanges.changes.map((change) => change.kind)).toEqual([
      'base-href-removal',
      'html-attribute-rewrite',
      'srcset-rewrite',
      'css-source-rewrite',
      'service-worker-call-rewrite',
      'service-worker-guard-insertion',
      'csp-policy-adjustment',
    ]);
    expect(first.contentChanges.counts).toEqual({
      'base-href-removal': 1,
      'html-attribute-rewrite': 1,
      'srcset-rewrite': 1,
      'css-source-rewrite': 1,
      'service-worker-call-rewrite': 1,
      'service-worker-guard-insertion': 1,
      'csp-policy-adjustment': 1,
      'uncaptured-resource-neutralization': 0,
      'offline-script-disable': 0,
      'speculative-link-removal': 0,
    });
    expect(first.contentChanges.changes[4]).toMatchObject({
      before: "navigator.serviceWorker.register('/sw.js')",
      after: 'globalThis.__sitecapsuleBlockServiceWorkerRegistration_v1__()',
      location: { surface: 'script-text' },
    });
    expect(first.cspAdjustment.policies[0]?.adjustedPolicy).toContain(
      `script-src ${SERVICE_WORKER_GUARD_HASH_SOURCE}`,
    );
    expect(first.cspAdjustment.policies[0]?.adjustedPolicy).toContain("img-src 'self'");
    expect(first.contentChanges.limitations).toEqual([
      'domparser-serialization-normalization-not-itemized',
      'css-ast-regeneration-reported-at-source-level',
    ]);
  });

  it('still reports the mandatory guard when the page has no other content changes', () => {
    const result = rewriteHtmlResource({
      html: '<html><head></head><body><p>Offline</p></body></html>',
      documentUrl: DOCUMENT_URL,
      baseUrl: BASE_URL,
      documentPath: DOCUMENT_PATH,
      savedResourceMappings: [],
    });

    expect(result.contentChanges.totalChanges).toBe(1);
    expect(result.contentChanges.changes[0]?.kind).toBe('service-worker-guard-insertion');
    expect(result.cspAdjustment.policiesFound).toBe(0);
  });

  it('includes standalone CSS files in an input-order-independent archive summary', async () => {
    const [mapping] = await createResourcePathMappings([
      { url: `${BASE_URL}background.png`, resourceType: 'image' },
    ]);
    if (!mapping) throw new Error('Expected a saved image mapping.');
    const cssResult = rewriteCssResource({
      cssText: '.hero { background: url(background.png); }',
      context: 'stylesheet',
      baseUrl: BASE_URL,
      sourcePath: 'assets/origins/https/dns-cdn.example.test/default/css/site.css',
      savedResourceMappings: [mapping],
    });
    const cssReport = buildCssContentChangeReport(cssResult);
    const htmlResult = rewriteHtmlResource({
      html: '<html><head></head><body></body></html>',
      documentUrl: DOCUMENT_URL,
      baseUrl: BASE_URL,
      documentPath: DOCUMENT_PATH,
      savedResourceMappings: [],
    });
    const forward = combineContentChangeReports([htmlResult.contentChanges, cssReport]);
    const reverse = combineContentChangeReports([cssReport, htmlResult.contentChanges]);

    expect(reverse).toEqual(forward);
    expect(forward.filesChanged).toBe(2);
    expect(forward.totalChanges).toBe(2);
    expect(forward.changes.map((change) => change.location.documentPath)).toEqual([
      cssResult.sourcePath,
      DOCUMENT_PATH,
    ]);
    expect(cssReport.changes[0]).toMatchObject({
      kind: 'css-source-rewrite',
      before: cssResult.originalCssText,
      after: cssResult.cssText,
    });
    expect(() => combineContentChangeReports([cssReport, cssReport])).toThrow(
      'unique document paths',
    );
  });
});
