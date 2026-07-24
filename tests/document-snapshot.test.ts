import {
  capturePageSnapshot,
  serializeDocument,
  serializeDocumentType,
  type DocumentSnapshotSource,
  type DocumentTypeSource,
} from '@sitecapsule/page';
import { describe, expect, it, vi } from 'vitest';

type DocumentFixture = {
  cloneNode: ReturnType<typeof vi.fn>;
  setMarkup: (markup: string) => void;
  setPerformanceEntries: (entries: PerformanceEntry[]) => void;
  source: DocumentSnapshotSource;
};

function createDocumentFixture(
  initialMarkup: string,
  doctype: DocumentTypeSource | null = { name: 'html', publicId: '', systemId: '' },
): DocumentFixture {
  let markup = initialMarkup;
  let performanceEntries: PerformanceEntry[] = [];
  const cloneNode = vi.fn(
    (deep?: boolean) =>
      ({
        attributes: [],
        getAttribute: () => null,
        outerHTML: markup,
        querySelectorAll: () => [],
        removeAttribute: () => undefined,
        tagName: 'HTML',
      }) as unknown as Node,
  );
  const documentElement = {
    cloneNode,
    get outerHTML(): never {
      throw new Error('The live root must not be serialized directly.');
    },
  };
  const source: DocumentSnapshotSource = {
    title: 'Fixture page',
    baseURI: 'https://cdn.example.com/assets/',
    URL: 'https://example.com/final',
    doctype,
    defaultView: {
      performance: {
        getEntriesByType: () => performanceEntries,
      },
    },
    documentElement,
    querySelectorAll: () => [],
  };

  return {
    cloneNode,
    setMarkup: (nextMarkup) => {
      markup = nextMarkup;
    },
    setPerformanceEntries: (entries) => {
      performanceEntries = entries;
    },
    source,
  };
}

describe('document snapshot', () => {
  it('preserves HTML, PUBLIC, and SYSTEM doctypes', () => {
    expect(serializeDocumentType({ name: 'html', publicId: '', systemId: '' })).toBe(
      '<!DOCTYPE html>',
    );
    expect(
      serializeDocumentType({
        name: 'html',
        publicId: '-//W3C//DTD XHTML 1.0 Strict//EN',
        systemId: 'http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd',
      }),
    ).toBe(
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">',
    );
    expect(serializeDocumentType({ name: 'svg', publicId: '', systemId: 'image/svg+xml' })).toBe(
      '<!DOCTYPE svg SYSTEM "image/svg+xml">',
    );
  });

  it('serializes the cloned root without inventing a missing doctype', () => {
    const fixture = createDocumentFixture('<html><body>Plain page</body></html>', null);

    expect(serializeDocument(fixture.source)).toBe('<html><body>Plain page</body></html>');
    expect(fixture.cloneNode).toHaveBeenCalledWith(true);
  });

  it('captures content present after rendering and leaves the live root untouched', () => {
    const fixture = createDocumentFixture('<html><body>Loading</body></html>');
    fixture.setMarkup('<html><body><main>Rendered content</main></body></html>');
    fixture.setPerformanceEntries([
      {
        name: 'https://cdn.example.com/rendered.js#runtime',
        entryType: 'resource',
        initiatorType: 'script',
        startTime: 15,
        duration: 30,
        transferSize: 1_200,
        encodedBodySize: 1_000,
        decodedBodySize: 2_000,
      } as PerformanceResourceTiming,
    ]);

    const snapshot = capturePageSnapshot(fixture.source, 'https://example.com/requested');

    expect(snapshot).toEqual({
      title: 'Fixture page',
      tabUrl: 'https://example.com/requested',
      baseUrl: 'https://cdn.example.com/assets/',
      finalUrl: 'https://example.com/final',
      serializedDom: '<!DOCTYPE html>\n<html><body><main>Rendered content</main></body></html>',
      domResources: [],
      regionDiagnostics: {
        regions: [],
        limitations: ['closed-shadow-roots-unobservable'],
      },
      performanceResources: [
        {
          url: 'https://cdn.example.com/rendered.js',
          initiatorType: 'script',
          startTimeMs: 15,
          durationMs: 30,
          transferSize: 1_200,
          encodedBodySize: 1_000,
          decodedBodySize: 2_000,
        },
      ],
    });
    expect(fixture.cloneNode).toHaveBeenCalledTimes(1);
    expect(fixture.cloneNode).toHaveBeenCalledWith(true);
  });
});
