import { inspectPageRegions, type PageRegionSource } from '@sitecapsule/page';
import { describe, expect, it } from 'vitest';

class RootFixture {
  constructor(readonly elements: ElementFixture[] = []) {}

  querySelectorAll(selector: string): ElementFixture[] {
    if (selector !== '*') throw new Error(`Unexpected selector: ${selector}`);
    return this.elements;
  }
}

class ElementFixture {
  contentDocument: { documentElement: object } | null = null;
  shadowRoot: RootFixture | null = null;

  readonly #attributes: Map<string, string>;

  constructor(
    readonly tagName: string,
    attributes: Record<string, string> = {},
  ) {
    this.#attributes = new Map(Object.entries(attributes));
  }

  getAttribute(name: string): string | null {
    return this.#attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.#attributes.has(name);
  }
}

function createSource(elements: ElementFixture[] = []): PageRegionSource {
  return {
    URL: 'https://example.com/page?private=query',
    querySelectorAll: () => elements as unknown as Element[],
  };
}

function iframe(
  attributes: Record<string, string>,
  contentDocument: ElementFixture['contentDocument'] = null,
): ElementFixture {
  const element = new ElementFixture('IFRAME', attributes);
  element.contentDocument = contentDocument;
  return element;
}

describe('page region diagnostics', () => {
  it('returns no regions for an ordinary page and records the closed-root limitation', () => {
    expect(inspectPageRegions(createSource())).toEqual({
      regions: [],
      limitations: ['closed-shadow-roots-unobservable'],
    });
  });

  it('classifies same-origin, cross-origin, sandboxed, unavailable, and denied iframes', () => {
    const sameOrigin = iframe({ src: '/embedded' }, { documentElement: {} });
    const crossOrigin = iframe(
      { src: 'https://frames.example.net/view?token=private' },
      { documentElement: {} },
    );
    const sandboxed = iframe({ src: '/private', sandbox: '' });
    const unavailable = iframe({ src: '/not-ready' });
    const denied = iframe({ src: '/blocked' });
    Object.defineProperty(denied, 'contentDocument', {
      get: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });

    expect(
      inspectPageRegions(createSource([sameOrigin, crossOrigin, sandboxed, unavailable, denied]))
        .regions,
    ).toEqual([
      {
        kind: 'iframe',
        ordinal: 1,
        depth: 0,
        access: 'accessible',
        reason: 'same-origin',
        sourceOrigin: 'https://example.com',
      },
      {
        kind: 'iframe',
        ordinal: 2,
        depth: 0,
        access: 'inaccessible',
        reason: 'cross-origin',
        sourceOrigin: 'https://frames.example.net',
      },
      {
        kind: 'iframe',
        ordinal: 3,
        depth: 0,
        access: 'inaccessible',
        reason: 'sandboxed',
        sourceOrigin: 'https://example.com',
      },
      {
        kind: 'iframe',
        ordinal: 4,
        depth: 0,
        access: 'inaccessible',
        reason: 'unavailable',
        sourceOrigin: 'https://example.com',
      },
      {
        kind: 'iframe',
        ordinal: 5,
        depth: 0,
        access: 'inaccessible',
        reason: 'access-denied',
        sourceOrigin: 'https://example.com',
      },
    ]);
  });

  it('finds open and nested shadow roots without treating closed roots as accessible', () => {
    const host = new ElementFixture('SITE-SHELL');
    const nestedHost = new ElementFixture('USER-CARD');
    const closedHost = new ElementFixture('PRIVATE-PANEL');
    const embedded = iframe({ src: '/shadow-frame' }, { documentElement: {} });
    nestedHost.shadowRoot = new RootFixture([new ElementFixture('SPAN')]);
    host.shadowRoot = new RootFixture([embedded, nestedHost, closedHost]);

    expect(inspectPageRegions(createSource([host, closedHost]))).toEqual({
      regions: [
        {
          kind: 'shadow-root',
          ordinal: 1,
          depth: 0,
          access: 'accessible',
          reason: 'open-shadow-root',
        },
        {
          kind: 'iframe',
          ordinal: 1,
          depth: 1,
          access: 'accessible',
          reason: 'same-origin',
          sourceOrigin: 'https://example.com',
        },
        {
          kind: 'shadow-root',
          ordinal: 2,
          depth: 1,
          access: 'accessible',
          reason: 'open-shadow-root',
        },
      ],
      limitations: ['closed-shadow-roots-unobservable'],
    });
  });
});
