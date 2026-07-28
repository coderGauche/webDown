// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import {
  buildCssContentChangeReport,
  collectUncapturedDependencies,
  combineContentChangeReports,
  createResourcePathMappings,
  rewriteCssResource,
  rewriteHtmlResource,
  type ResourcePathInput,
  type ResourcePathMapping,
} from '@sitecapsule/archive';
import { normalizeResourceUrl } from '@sitecapsule/page';
import { beforeAll, describe, expect, it } from 'vitest';

const ORIGIN = 'https://cdn.archive.test';
const DOCUMENT_URL = 'https://page.archive.test/gallery/index.html';
const BASE_URL = `${ORIGIN}/assets/site/`;
const DOCUMENT_PATH =
  'assets/origins/https/dns-page.archive.test/default/documents/gallery/index.html';
const CSS_URL = `${ORIGIN}/assets/css/site.css?theme=dark`;

beforeAll(() => {
  const settings = (
    window as unknown as {
      happyDOM: {
        settings: {
          disableCSSFileLoading: boolean;
          disableIframePageLoading: boolean;
          disableJavaScriptFileLoading: boolean;
          handleDisabledFileLoadingAsSuccess: boolean;
        };
      };
    }
  ).happyDOM.settings;
  settings.disableCSSFileLoading = true;
  settings.disableIframePageLoading = true;
  settings.disableJavaScriptFileLoading = true;
  settings.handleDisabledFileLoadingAsSuccess = true;
});

function readFixture(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function resourceInputs(): ResourcePathInput[] {
  return [
    { url: CSS_URL, resourceType: 'stylesheet' },
    { url: `${ORIGIN}/assets/css/reset.css?layer=base`, resourceType: 'stylesheet' },
    { url: `${ORIGIN}/assets/images/Hero%20Image.png?width=640`, resourceType: 'image' },
    {
      url: 'HTTPS://CDN.Archive.Test:443/assets/images/Hero%20Image.png?width=640#alias',
      resourceType: 'image',
    },
    { url: `${ORIGIN}/assets/images/Hero%20Image.png?width=1280`, resourceType: 'image' },
    { url: `${ORIGIN}/assets/images/poster.jpg`, resourceType: 'image' },
    { url: `${ORIGIN}/assets/fonts/Caf%C3%A9.woff2`, resourceType: 'font' },
    { url: `${ORIGIN}/assets/fonts/Cafe%CC%81.woff2`, resourceType: 'font' },
    { url: `${ORIGIN}/assets/js/app.js?v=1`, resourceType: 'script' },
    { url: `${ORIGIN}/assets/media/demo.mp4`, resourceType: 'video' },
    { url: `${ORIGIN}/assets/captions/en.vtt`, resourceType: 'data' },
    { url: `${ORIGIN}/assets/icons/Logo%3F.PNG`, resourceType: 'image' },
    { url: `${ORIGIN}/assets/brand/logo%2A.png`, resourceType: 'image' },
    { url: `${ORIGIN}/assets/a/shared.svg`, resourceType: 'image' },
    { url: `${ORIGIN}/assets/b/shared.svg`, resourceType: 'image' },
    { url: CSS_URL, resourceType: 'stylesheet' },
  ];
}

function identity(mapping: Pick<ResourcePathMapping, 'resourceType' | 'normalizedUrl'>): string {
  return `${mapping.resourceType}\u0000${mapping.normalizedUrl}`;
}

function localTargetPath(sourcePath: string, reference: string): string {
  const withoutFragment = reference.split('#', 1)[0] ?? '';
  const decodedSegments = withoutFragment
    .split('/')
    .map((segment) =>
      segment === '..' || segment === '.' ? segment : decodeURIComponent(segment),
    );
  return posix.normalize(posix.join(posix.dirname(sourcePath), ...decodedSegments));
}

function expectLocalReference(
  sourcePath: string,
  reference: string,
  expectedTargetPath: string,
  savedPaths: ReadonlySet<string>,
): void {
  const targetPath = localTargetPath(sourcePath, reference);
  expect(targetPath).toBe(expectedTargetPath);
  expect(savedPaths.has(targetPath)).toBe(true);
}

describe('M6 deterministic paths and offline references', () => {
  it('keeps complex path mappings stable, unique, and bidirectionally queryable', async () => {
    const inputs = resourceInputs();
    const permutations = [
      inputs,
      [...inputs].reverse(),
      [...inputs.slice(5), ...inputs.slice(0, 5)],
      [...inputs].sort((left, right) => (left.url < right.url ? -1 : left.url > right.url ? 1 : 0)),
    ];
    const [baseline, ...alternatives] = await Promise.all(
      permutations.map((permutation) => createResourcePathMappings(permutation)),
    );
    if (!baseline) throw new Error('Expected a baseline path mapping set.');

    for (const alternative of alternatives) expect(alternative).toEqual(baseline);
    expect(baseline).toHaveLength(14);
    expect(new Set(baseline.map((mapping) => mapping.relativePath.toLowerCase())).size).toBe(
      baseline.length,
    );

    const byIdentity = new Map(baseline.map((mapping) => [identity(mapping), mapping]));
    const byPath = new Map(baseline.map((mapping) => [mapping.relativePath, mapping]));
    for (const mapping of baseline) {
      expect(byPath.get(mapping.relativePath)).toBe(mapping);
      for (const originalUrl of mapping.originalUrls) {
        const normalizedUrl = normalizeResourceUrl(originalUrl);
        expect(normalizedUrl).not.toBeNull();
        expect(byIdentity.get(`${mapping.resourceType}\u0000${normalizedUrl}`)).toBe(mapping);
      }
    }

    const queriedImages = baseline.filter((mapping) =>
      mapping.normalizedUrl.includes('/Hero%20Image.png?width='),
    );
    expect(queriedImages).toHaveLength(2);
    expect(queriedImages.every((mapping) => mapping.queryHash !== null)).toBe(true);
    expect(new Set(queriedImages.map((mapping) => mapping.relativePath)).size).toBe(2);

    const unicodeFonts = baseline.filter((mapping) => mapping.resourceType === 'font');
    expect(unicodeFonts.map((mapping) => mapping.baseFileName)).toEqual([
      'Café.woff2',
      'Café.woff2',
    ]);
    expect(unicodeFonts.every((mapping) => mapping.collisionHash !== null)).toBe(true);

    const portableCollisions = baseline.filter(
      (mapping) => mapping.baseFileName.toLowerCase() === 'logo_.png',
    );
    expect(portableCollisions).toHaveLength(2);
    expect(portableCollisions.every((mapping) => mapping.collisionHash !== null)).toBe(true);
    const nestedLeafCollisions = baseline.filter(
      (mapping) => mapping.baseFileName === 'shared.svg',
    );
    expect(nestedLeafCollisions).toHaveLength(2);
    expect(nestedLeafCollisions.every((mapping) => mapping.collisionHash !== null)).toBe(true);
  });

  it('rewrites a complete HTML and CSS fixture without inventing local files', async () => {
    const mappings = await createResourcePathMappings(resourceInputs());
    const savedPaths = new Set([DOCUMENT_PATH, ...mappings.map((mapping) => mapping.relativePath)]);
    const cssMapping = mappings.find((mapping) => mapping.normalizedUrl === CSS_URL);
    if (!cssMapping) throw new Error('Expected the standalone stylesheet mapping.');

    const cssResult = rewriteCssResource({
      cssText: readFixture('./fixtures/archive-rewrite/site.css'),
      context: 'stylesheet',
      baseUrl: CSS_URL,
      sourcePath: cssMapping.relativePath,
      savedResourceMappings: mappings,
    });
    const htmlResult = rewriteHtmlResource({
      html: readFixture('./fixtures/archive-rewrite/index.html'),
      documentUrl: DOCUMENT_URL,
      baseUrl: BASE_URL,
      documentPath: DOCUMENT_PATH,
      savedResourceMappings: mappings,
    });

    for (const reference of htmlResult.references) {
      if (reference.status !== 'rewritten') continue;
      expectLocalReference(
        DOCUMENT_PATH,
        reference.rewrittenValue,
        reference.targetPath,
        savedPaths,
      );
    }
    for (const rewrite of htmlResult.srcsetRewrites) {
      for (const reference of rewrite.result.references) {
        if (reference.status !== 'rewritten') continue;
        expectLocalReference(
          DOCUMENT_PATH,
          reference.rewrittenValue,
          reference.targetPath,
          savedPaths,
        );
      }
    }
    for (const rewrite of htmlResult.cssRewrites) {
      for (const reference of rewrite.result.references) {
        if (reference.status !== 'rewritten') continue;
        expectLocalReference(
          DOCUMENT_PATH,
          reference.rewrittenValue,
          reference.targetPath,
          savedPaths,
        );
      }
    }
    for (const reference of cssResult.references) {
      if (reference.status !== 'rewritten') continue;
      expectLocalReference(
        cssMapping.relativePath,
        reference.rewrittenValue,
        reference.targetPath,
        savedPaths,
      );
    }

    expect(htmlResult.baseHrefRemovals).toHaveLength(1);
    expect(htmlResult.rewrittenCount).toBeGreaterThanOrEqual(7);
    expect(htmlResult.srcsetRewrittenCount).toBe(3);
    expect(htmlResult.cssRewrittenCount).toBe(1);
    expect(cssResult.rewrittenCount).toBe(3);
    expect(htmlResult.serviceWorkerSafety.directRegistrationsRewritten).toBe(1);
    expect(htmlResult.html).not.toContain("navigator.serviceWorker.register('/archive-worker.js')");
    expect(htmlResult.cspAdjustment.policiesAdjusted).toBe(1);
    expect(htmlResult.cspAdjustment.policies[0]?.adjustedPolicy).not.toContain("'unsafe-inline'");
    expect(htmlResult.cspAdjustment.policies[0]?.adjustedPolicy).toContain("object-src 'none'");

    const dependencyReport = collectUncapturedDependencies({
      htmlResults: [htmlResult],
      cssResults: [cssResult],
    });
    expect(dependencyReport.dependencies.map((dependency) => dependency.normalizedUrl)).toEqual([
      `${ORIGIN}/assets/images/missing-css.png`,
      `${ORIGIN}/assets/images/missing-html.png`,
      `${ORIGIN}/assets/images/missing-inline.png`,
      `${ORIGIN}/assets/images/missing-srcset.png`,
    ]);
    expect(
      dependencyReport.dependencies.every((dependency) => dependency.reason === 'missing-mapping'),
    ).toBe(true);
    expect(
      dependencyReport.dependencies.every(
        (dependency) =>
          !mappings.some((mapping) => mapping.normalizedUrl === dependency.normalizedUrl),
      ),
    ).toBe(true);

    const cssChanges = buildCssContentChangeReport(cssResult);
    const combinedChanges = combineContentChangeReports([htmlResult.contentChanges, cssChanges]);
    expect(combinedChanges.filesChanged).toBe(2);
    expect(combinedChanges.counts['html-attribute-rewrite']).toBeGreaterThanOrEqual(7);
    expect(combinedChanges.counts['srcset-rewrite']).toBe(2);
    expect(combinedChanges.counts['css-source-rewrite']).toBe(2);
    expect(combinedChanges.counts['service-worker-call-rewrite']).toBe(1);
    expect(combinedChanges.counts['service-worker-guard-insertion']).toBe(1);
    expect(combinedChanges.counts['csp-policy-adjustment']).toBe(1);

    const reversedChanges = combineContentChangeReports([cssChanges, htmlResult.contentChanges]);
    expect(reversedChanges).toEqual(combinedChanges);
  });
});
