import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface PublicSiteCase {
  id: string;
  owner: string;
  url: string;
  finalUrl: string;
  pageType: string;
  runtimeProfile: string;
  keyResources: string[];
  captureExpectation: {
    outcome: 'core-content-offline' | 'documented-degradation-allowed';
    assertions: string[];
  };
  knownLimitations: string[];
  availability: {
    status: 'reachable' | 'externally-unavailable';
    checkedAt: string;
    method: string;
  };
}

interface PublicSiteBaseline {
  schemaVersion: number;
  baselineId: string;
  purpose: string;
  minimumCases: number;
  availabilityPolicy: {
    checkedAt: string;
    statusMeaning: string;
    allowedStatuses: string[];
  };
  cases: PublicSiteCase[];
}

const baseline = JSON.parse(
  readFileSync(new URL('./baselines/public-sites.json', import.meta.url), 'utf8'),
) as PublicSiteBaseline;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PRIVATE_IPV4 = /^(?:10|127|169\.254|192\.168|172\.(?:1[6-9]|2\d|3[01]))\./;
const FORBIDDEN_PATH = /\/(?:login|log-in|signin|sign-in|account|checkout)(?:\/|$)/i;

function expectPublicHttpsUrl(value: string): URL {
  const url = new URL(value);
  expect(url.protocol).toBe('https:');
  expect(url.username).toBe('');
  expect(url.password).toBe('');
  expect(url.hostname).not.toBe('localhost');
  expect(url.hostname).not.toBe('[::1]');
  expect(url.hostname).toContain('.');
  expect(PRIVATE_IPV4.test(url.hostname)).toBe(false);
  expect(FORBIDDEN_PATH.test(url.pathname)).toBe(false);
  return url;
}

describe('M10 public-site baseline', () => {
  it('is versioned and keeps external availability separate from product expectations', () => {
    expect(baseline.schemaVersion).toBe(1);
    expect(baseline.baselineId).toBe('m10-public-sites-v1');
    expect(baseline.minimumCases).toBe(20);
    expect(baseline.purpose).toContain('M10-T1');
    expect(baseline.purpose).toContain('M10-T2');
    expect(baseline.availabilityPolicy.checkedAt).toMatch(ISO_DATE);
    expect(baseline.availabilityPolicy.statusMeaning).toContain('not a SiteCapsule regression');
    expect(baseline.availabilityPolicy.allowedStatuses).toEqual([
      'reachable',
      'externally-unavailable',
    ]);
  });

  it('contains at least 20 unique public cases across meaningful page types', () => {
    expect(baseline.cases.length).toBeGreaterThanOrEqual(baseline.minimumCases);
    expect(new Set(baseline.cases.map(({ id }) => id)).size).toBe(baseline.cases.length);
    expect(new Set(baseline.cases.map(({ url }) => url)).size).toBe(baseline.cases.length);
    expect(new Set(baseline.cases.map(({ pageType }) => pageType)).size).toBeGreaterThanOrEqual(6);
    expect(
      new Set(baseline.cases.map(({ url }) => new URL(url).hostname)).size,
    ).toBeGreaterThanOrEqual(15);
  });

  it('records the required evidence and limitations for every case', () => {
    for (const testCase of baseline.cases) {
      expect(testCase.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(testCase.owner.trim()).not.toBe('');
      expectPublicHttpsUrl(testCase.url);
      expectPublicHttpsUrl(testCase.finalUrl);
      expect(testCase.pageType.trim()).not.toBe('');
      expect(testCase.runtimeProfile.trim()).not.toBe('');
      expect(testCase.keyResources.length).toBeGreaterThan(0);
      expect(new Set(testCase.keyResources).size).toBe(testCase.keyResources.length);
      expect(testCase.captureExpectation.assertions.length).toBeGreaterThanOrEqual(2);
      expect(testCase.knownLimitations.length).toBeGreaterThan(0);
      expect(baseline.availabilityPolicy.allowedStatuses).toContain(testCase.availability.status);
      expect(testCase.availability.checkedAt).toMatch(ISO_DATE);
      expect(testCase.availability.checkedAt).toBe(baseline.availabilityPolicy.checkedAt);
      expect(testCase.availability.method).toBe('public-page render check');
    }
  });

  it('covers the capture risks needed by the fixed MVP set', () => {
    const resources = new Set(baseline.cases.flatMap(({ keyResources }) => keyResources));
    for (const resource of [
      'html',
      'css',
      'scripts',
      'images',
      'srcset',
      'fonts',
      'svg',
      'iframe',
      'canvas',
      'webgl',
    ]) {
      expect(resources).toContain(resource);
    }
    expect(
      baseline.cases.some(
        ({ captureExpectation }) => captureExpectation.outcome === 'documented-degradation-allowed',
      ),
    ).toBe(true);
    expect(baseline.cases.some(({ url, finalUrl }) => url !== finalUrl)).toBe(true);
  });
});
