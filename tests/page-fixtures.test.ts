// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { act, createElement, useEffect, useRef, useState } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { capturePageSnapshot, waitForRender } from '@sitecapsule/page';
import { afterEach, describe, expect, it, vi } from 'vitest';

const STATIC_URL = `${window.location.origin}/fixtures/static/index.html`;
const SPA_URL = `${window.location.origin}/fixtures/spa/index.html`;
const VUE_STYLE_URL = `${window.location.origin}/fixtures/vue/records/42`;
const NEXT_STYLE_URL = `${window.location.origin}/fixtures/next/products/42`;

function readFixture(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function loadFixture(markup: string, url: string): void {
  window.history.replaceState({}, '', url);
  document.open();
  document.write(markup);
  document.close();
}

function resourceEntry(
  name: string,
  initiatorType: string,
  startTime: number,
): PerformanceResourceTiming {
  return {
    name,
    entryType: 'resource',
    initiatorType,
    startTime,
    duration: 12,
    transferSize: 1_024,
    encodedBodySize: 768,
    decodedBodySize: 1_536,
  } as PerformanceResourceTiming;
}

function mockResourceTiming(entries: PerformanceResourceTiming[]): void {
  vi.spyOn(window.performance, 'getEntriesByType').mockImplementation((type) =>
    type === 'resource' ? entries : [],
  );
}

type FixtureSnapshot = ReturnType<typeof capturePageSnapshot>;

function expectStableFixtureSnapshot(
  snapshot: FixtureSnapshot,
  expected: { title: string; tabUrl: string; baseUrl: string; content: string },
): void {
  expect(snapshot.title).toBe(expected.title);
  expect(snapshot.tabUrl).toBe(expected.tabUrl);
  expect(snapshot.finalUrl).toBe(expected.tabUrl);
  expect(snapshot.baseUrl).toBe(expected.baseUrl);
  expect(snapshot.serializedDom).toContain(expected.content);
  expect(snapshot.resourceGraph.nodes.map((node) => node.url)).toEqual(
    snapshot.mergedResources.map((resource) => resource.url),
  );
  expect(snapshot.resourceGraph.edges).toHaveLength(
    snapshot.mergedResources.reduce((total, resource) => total + resource.evidence.length, 0),
  );
  expect(capturePageSnapshot(document, expected.tabUrl)).toEqual(snapshot);
}

function mountVueStyleFixture(): () => void {
  const app = document.getElementById('app');
  if (!app) throw new Error('Vue-style fixture root is missing.');
  app.removeAttribute('v-cloak');
  app.setAttribute('data-v-app', '');

  const timeoutId = window.setTimeout(() => {
    const main = document.createElement('main');
    main.setAttribute('data-v-7af31d2c', '');
    main.dataset.route = '/records/42';

    const heading = document.createElement('h1');
    heading.textContent = 'Mounted Vue-style record';
    const image = document.createElement('img');
    image.src = 'images/record-42.png';
    image.alt = 'Record 42';
    image.loading = 'lazy';
    const input = document.createElement('input');
    input.name = 'session_token';
    input.value = 'vue-style-runtime-token';

    main.append(heading, image, input);
    app.replaceChildren(main);
    document.title = 'Vue-style record ready';
  }, 35);

  return () => window.clearTimeout(timeoutId);
}

function ShadowWidget() {
  const hostRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    const label = document.createElement('span');
    label.textContent = 'Rendered inside shadow DOM';
    root.replaceChildren(label);
  }, []);

  return createElement('section', { ref: hostRef, 'data-widget': 'shadow-status' });
}

function DeferredSpa() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setReady(true), 50);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (ready) document.title = 'SPA fixture ready';
  }, [ready]);

  if (!ready) return createElement('p', { id: 'loading' }, 'Loading application');

  return createElement(
    'main',
    { id: 'dashboard' },
    createElement('h1', null, 'Rendered SPA dashboard'),
    createElement('input', {
      name: 'access_token',
      value: 'spa-runtime-token',
      readOnly: true,
    }),
    createElement('img', { src: 'images/dashboard.png', alt: 'Dashboard' }),
    createElement(ShadowWidget),
  );
}

function NextStyleRoute() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setHydrated(true), 40);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (hydrated) document.title = 'Next-style product ready';
  }, [hydrated]);

  return createElement(
    'main',
    { 'data-route': '/products/42' },
    createElement('h1', null, 'Server-rendered product detail'),
    createElement('p', null, 'Initial route payload'),
    hydrated
      ? createElement(
          'section',
          { id: 'deferred-product' },
          createElement('h2', null, 'Hydrated recommendations'),
          createElement('img', {
            src: 'images/product-42.webp',
            alt: 'Product 42',
            loading: 'lazy',
          }),
          createElement('input', {
            name: 'checkout_token',
            value: 'next-style-runtime-token',
            readOnly: true,
          }),
        )
      : null,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.open();
  document.write('<!doctype html><html><head></head><body></body></html>');
  document.close();
});

describe('M9 page profile fixtures', () => {
  it('captures a deterministic, sanitized static HTML page', () => {
    loadFixture(readFixture('./fixtures/static-page/index.html'), STATIC_URL);
    mockResourceTiming([
      resourceEntry('https://cdn.fixture.test/static/styles/site.css#theme', 'link', 5),
      resourceEntry('https://cdn.fixture.test/static/images/cover.png', 'img', 10),
    ]);

    const snapshot = capturePageSnapshot(document, STATIC_URL);

    expect(snapshot.title).toBe('Static fixture');
    expect(snapshot.tabUrl).toBe(STATIC_URL);
    expect(snapshot.finalUrl).toBe(STATIC_URL);
    expect(snapshot.baseUrl).toBe('https://cdn.fixture.test/static/');
    expect(snapshot.serializedDom).toContain('Static archive fixture');
    expect(snapshot.serializedDom).toContain('name="password"');
    expect(snapshot.serializedDom).not.toContain('static-password');
    expect(snapshot.serializedDom).not.toContain('static-person@example.test');
    expect(snapshot.domResources.map((resource) => resource.resolvedUrl)).toEqual([
      'https://cdn.fixture.test/static/images/cover.png',
    ]);
    expect(snapshot.cssSources).toHaveLength(1);
    expect(snapshot.cssSources[0]).toMatchObject({ source: 'style-element', tagName: 'style' });
    expect(snapshot.cssResources).toEqual([]);
    expect(snapshot.svgResources).toEqual([]);
    expect(snapshot.regionDiagnostics.regions).toContainEqual({
      kind: 'iframe',
      ordinal: 1,
      depth: 0,
      access: 'inaccessible',
      reason: 'sandboxed',
      sourceOrigin: window.location.origin,
    });
    expect(snapshot.performanceResources.map((resource) => resource.url)).toEqual([
      'https://cdn.fixture.test/static/styles/site.css',
      'https://cdn.fixture.test/static/images/cover.png',
    ]);
    expect(snapshot.mergedResources.map((resource) => resource.url)).toEqual([
      'https://cdn.fixture.test/static/images/cover.png',
      'https://cdn.fixture.test/static/styles/site.css',
    ]);
    expect(snapshot.mergedResources.map((resource) => resource.evidence.length)).toEqual([2, 1]);
    expect(snapshot.resourceGraph.nodes.map((node) => node.url)).toEqual(
      snapshot.mergedResources.map((resource) => resource.url),
    );
    expect(snapshot.resourceGraph.edges).toHaveLength(3);
    expectStableFixtureSnapshot(snapshot, {
      title: 'Static fixture',
      tabUrl: STATIC_URL,
      baseUrl: 'https://cdn.fixture.test/static/',
      content: 'Static archive fixture',
    });
  });

  it('waits for a React SPA and captures its final sanitized DOM', async () => {
    vi.useFakeTimers();
    loadFixture(readFixture('./fixtures/spa-page/index.html'), SPA_URL);
    mockResourceTiming([
      resourceEntry('https://cdn.fixture.test/spa/runtime.js', 'script', 8),
      resourceEntry('https://cdn.fixture.test/spa/images/dashboard.png', 'img', 20),
    ]);
    const container = document.getElementById('root');
    if (!container) throw new Error('SPA fixture root is missing.');

    let root: Root | undefined;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(DeferredSpa));
    });
    expect(document.getElementById('loading')?.textContent).toBe('Loading application');

    const renderWait = waitForRender(50);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
      await renderWait;
    });
    const snapshot = capturePageSnapshot(document, SPA_URL);

    expect(snapshot.title).toBe('SPA fixture ready');
    expect(snapshot.tabUrl).toBe(SPA_URL);
    expect(snapshot.finalUrl).toBe(SPA_URL);
    expect(snapshot.baseUrl).toBe('https://cdn.fixture.test/spa/');
    expect(snapshot.serializedDom).toContain('Rendered SPA dashboard');
    expect(snapshot.serializedDom).not.toContain('Loading application');
    expect(snapshot.serializedDom).not.toContain('spa-runtime-token');
    expect(snapshot.domResources.map((resource) => resource.resolvedUrl)).toEqual([
      'https://cdn.fixture.test/spa/images/dashboard.png',
    ]);
    expect(snapshot.cssSources).toEqual([]);
    expect(snapshot.cssResources).toEqual([]);
    expect(snapshot.svgResources).toEqual([]);
    expect(snapshot.regionDiagnostics.regions).toContainEqual({
      kind: 'shadow-root',
      ordinal: 1,
      depth: 0,
      access: 'accessible',
      reason: 'open-shadow-root',
    });
    expect(snapshot.performanceResources.map((resource) => resource.initiatorType)).toEqual([
      'script',
      'img',
    ]);
    expect(snapshot.mergedResources.map((resource) => resource.url)).toEqual([
      'https://cdn.fixture.test/spa/images/dashboard.png',
      'https://cdn.fixture.test/spa/runtime.js',
    ]);
    expect(snapshot.mergedResources.map((resource) => resource.evidence.length)).toEqual([2, 1]);
    expect(snapshot.resourceGraph.nodes.map((node) => node.url)).toEqual(
      snapshot.mergedResources.map((resource) => resource.url),
    );
    expect(snapshot.resourceGraph.edges).toHaveLength(3);
    expectStableFixtureSnapshot(snapshot, {
      title: 'SPA fixture ready',
      tabUrl: SPA_URL,
      baseUrl: 'https://cdn.fixture.test/spa/',
      content: 'Rendered SPA dashboard',
    });

    await act(async () => root?.unmount());
  });

  it('captures a settled Vue-style route profile without claiming a Vue runtime', async () => {
    vi.useFakeTimers();
    loadFixture(readFixture('./fixtures/vue-style-page/index.html'), VUE_STYLE_URL);
    const serverSnapshot = capturePageSnapshot(document, VUE_STYLE_URL);
    expectStableFixtureSnapshot(serverSnapshot, {
      title: 'Vue-style route shell',
      tabUrl: VUE_STYLE_URL,
      baseUrl: 'https://cdn.fixture.test/vue/',
      content: 'Server route fallback',
    });
    mockResourceTiming([
      resourceEntry('https://cdn.fixture.test/vue/runtime.js', 'script', 4),
      resourceEntry('https://cdn.fixture.test/vue/images/record-42.png', 'img', 18),
    ]);
    const dispose = mountVueStyleFixture();

    expect(document.querySelector('[data-route="/records/42"]')?.textContent).toContain(
      'Server route fallback',
    );
    const renderWait = waitForRender(35);
    await vi.advanceTimersByTimeAsync(35);
    await renderWait;
    const snapshot = capturePageSnapshot(document, VUE_STYLE_URL);

    expect(snapshot.serializedDom).toContain('data-v-app=""');
    expect(snapshot.serializedDom).toContain('data-v-7af31d2c=""');
    expect(snapshot.serializedDom).not.toContain('Server route fallback');
    expect(snapshot.serializedDom).not.toContain('vue-style-runtime-token');
    expect(snapshot.domResources.map((resource) => resource.resolvedUrl)).toEqual([
      'https://cdn.fixture.test/vue/images/record-42.png',
    ]);
    expect(snapshot.performanceResources.map((resource) => resource.initiatorType)).toEqual([
      'script',
      'img',
    ]);
    expectStableFixtureSnapshot(snapshot, {
      title: 'Vue-style record ready',
      tabUrl: VUE_STYLE_URL,
      baseUrl: 'https://cdn.fixture.test/vue/',
      content: 'Mounted Vue-style record',
    });

    dispose();
  });

  it('hydrates a Next-style server route and captures deferred route content', async () => {
    vi.useFakeTimers();
    loadFixture(readFixture('./fixtures/next-style-page/index.html'), NEXT_STYLE_URL);
    const serverSnapshot = capturePageSnapshot(document, NEXT_STYLE_URL);
    expectStableFixtureSnapshot(serverSnapshot, {
      title: 'Next-style server route',
      tabUrl: NEXT_STYLE_URL,
      baseUrl: 'https://cdn.fixture.test/next/',
      content: 'Server-rendered product detail',
    });
    mockResourceTiming([
      resourceEntry('https://cdn.fixture.test/next/_next/static/chunks/app.js', 'script', 3),
      resourceEntry('https://cdn.fixture.test/next/images/product-42.webp', 'img', 22),
    ]);
    const container = document.getElementById('__next');
    if (!container) throw new Error('Next-style fixture root is missing.');

    let root: Root | undefined;
    await act(async () => {
      root = hydrateRoot(container, createElement(NextStyleRoute));
    });
    expect(document.getElementById('__NEXT_DATA__')?.textContent).toContain('fixture-build');
    expect(document.getElementById('deferred-product')).toBeNull();

    const renderWait = waitForRender(40);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
      await renderWait;
    });
    const snapshot = capturePageSnapshot(document, NEXT_STYLE_URL);

    expect(snapshot.serializedDom).toContain('id="__NEXT_DATA__"');
    expect(snapshot.serializedDom).toContain('Hydrated recommendations');
    expect(snapshot.serializedDom).not.toContain('next-style-runtime-token');
    expect(snapshot.domResources.map((resource) => resource.resolvedUrl)).toEqual([
      'https://cdn.fixture.test/next/images/product-42.webp',
    ]);
    expect(snapshot.performanceResources.map((resource) => resource.url)).toEqual([
      'https://cdn.fixture.test/next/_next/static/chunks/app.js',
      'https://cdn.fixture.test/next/images/product-42.webp',
    ]);
    expectStableFixtureSnapshot(snapshot, {
      title: 'Next-style product ready',
      tabUrl: NEXT_STYLE_URL,
      baseUrl: 'https://cdn.fixture.test/next/',
      content: 'Hydrated recommendations',
    });

    await act(async () => root?.unmount());
  });

  it('keeps all four fixture documents free of public executable dependencies', () => {
    const fixturePaths = [
      './fixtures/static-page/index.html',
      './fixtures/spa-page/index.html',
      './fixtures/vue-style-page/index.html',
      './fixtures/next-style-page/index.html',
    ];

    for (const fixturePath of fixturePaths) {
      const markup = readFixture(fixturePath);
      expect(markup).not.toMatch(/<script[^>]+src=/i);
      expect(markup).not.toMatch(/<link[^>]+rel=["']stylesheet["']/i);
      for (const match of markup.matchAll(/https?:\/\/[^"'\s<]+/g)) {
        expect(new URL(match[0]).hostname.endsWith('.test')).toBe(true);
      }
    }
  });
});
