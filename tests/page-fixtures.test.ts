// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { act, createElement, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { capturePageSnapshot, waitForRender } from '@sitecapsule/page';
import { afterEach, describe, expect, it, vi } from 'vitest';

const STATIC_URL = `${window.location.origin}/fixtures/static/index.html`;
const SPA_URL = `${window.location.origin}/fixtures/spa/index.html`;

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.open();
  document.write('<!doctype html><html><head></head><body></body></html>');
  document.close();
});

describe('M3 page fixtures', () => {
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
    expect(capturePageSnapshot(document, STATIC_URL)).toEqual(snapshot);
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
    expect(capturePageSnapshot(document, SPA_URL)).toEqual(snapshot);

    await act(async () => root?.unmount());
  });
});
