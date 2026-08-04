import {
  createResourcePathMappings,
  rewriteCssResource,
  type ResourcePathInput,
} from '@sitecapsule/archive';
import { describe, expect, it } from 'vitest';

const CSS_URL = 'https://cdn.example.test/css/main.css';
const CSS_PATH = 'assets/origins/https/dns-cdn.example.test/default/css/main.css';
const HTML_PATH = 'assets/origins/https/dns-page.example.test/default/documents/index.html';

async function savedMappings(inputs: readonly ResourcePathInput[]) {
  return createResourcePathMappings(inputs);
}

describe('CSSTree archive URL rewriting', () => {
  it('rewrites @import, @font-face, nested declarations, and custom properties', async () => {
    const themeUrl = 'https://cdn.example.test/css/theme.css';
    const fontUrl = 'https://cdn.example.test/fonts/archive.woff2?v=2';
    const imageUrl = 'https://cdn.example.test/images/hero%23wide%20image.png?size=2';
    const mappings = await savedMappings([
      { url: themeUrl, resourceType: 'stylesheet' },
      { url: fontUrl, resourceType: 'font' },
      { url: imageUrl, resourceType: 'image' },
    ]);
    const result = rewriteCssResource({
      cssText: `
        @import "theme.css" screen;
        @font-face {
          font-family: Archive;
          src: url('../fonts/archive.woff2?v=2#regular') format('woff2');
        }
        :root { --hero: url('../images/hero%23wide%20image.png?size=2#crop'); }
        @layer archive {
          @media (min-width: 1px) {
            .hero { background-image: url('../images/hero%23wide%20image.png?size=2#hero'); }
          }
        }
      `,
      context: 'stylesheet',
      baseUrl: CSS_URL,
      sourcePath: CSS_PATH,
      savedResourceMappings: mappings,
    });

    expect(result.parseError).toBe(false);
    expect(result.rewrittenCount).toBe(4);
    expect(result.references.map(({ kind, status }) => ({ kind, status }))).toEqual([
      { kind: 'import', status: 'rewritten' },
      { kind: 'font-face', status: 'rewritten' },
      { kind: 'url', status: 'rewritten' },
      { kind: 'url', status: 'rewritten' },
    ]);
    expect(result.cssText).not.toContain('theme.css" screen');
    expect(result.cssText).not.toContain('archive.woff2?v=2');
    expect(result.cssText).not.toContain('hero%23wide%20image.png?size=2');
    expect(result.cssText).toContain('--q-');
    expect(result.cssText).toContain('%23wide%20image--q-');
    expect(result.cssText).toContain('#regular');
    expect(result.cssText).toContain('#crop');
    expect(result.cssText).toContain('#hero');
  });

  it('rewrites @import url() once and ignores capability-query URLs in at-rule preludes', async () => {
    const importUrl = 'https://cdn.example.test/css/print.css';
    const realImageUrl = 'https://cdn.example.test/images/real.png';
    const fakeImageUrl = 'https://cdn.example.test/images/capability-only.png';
    const mappings = await savedMappings([
      { url: importUrl, resourceType: 'stylesheet' },
      { url: realImageUrl, resourceType: 'image' },
      { url: fakeImageUrl, resourceType: 'image' },
    ]);
    const result = rewriteCssResource({
      cssText: `
        @import url('./print.css') print;
        @supports (background-image: url('../images/capability-only.png')) {
          .real { background-image: url('../images/real.png'); }
        }
      `,
      context: 'stylesheet',
      baseUrl: CSS_URL,
      sourcePath: CSS_PATH,
      savedResourceMappings: mappings,
    });

    expect(result.rewrittenCount).toBe(2);
    expect(result.references.map((reference) => reference.originalValue)).toEqual([
      './print.css',
      '../images/real.png',
    ]);
    expect(result.cssText).toContain('../images/capability-only.png');
  });

  it('supports declaration-list and SVG value contexts relative to a host HTML path', async () => {
    const inlineImageUrl = 'https://cdn.example.test/assets/inline image.png';
    const cursorUrl = 'https://cdn.example.test/assets/cursors/pointer.cur';
    const filterUrl = 'https://cdn.example.test/assets/effects.svg';
    const mappings = await savedMappings([
      { url: inlineImageUrl, resourceType: 'image' },
      { url: cursorUrl, resourceType: 'image' },
      { url: filterUrl, resourceType: 'image' },
    ]);
    const style = rewriteCssResource({
      cssText: `background: url('./inline image.png'); cursor: url(cursors/pointer.cur), auto`,
      context: 'declaration-list',
      baseUrl: 'https://cdn.example.test/assets/',
      sourcePath: HTML_PATH,
      savedResourceMappings: mappings,
    });
    const svg = rewriteCssResource({
      cssText: 'url(./effects.svg#soften)',
      context: 'value',
      baseUrl: 'https://cdn.example.test/assets/',
      sourcePath: HTML_PATH,
      savedResourceMappings: mappings,
    });

    expect(style.rewrittenCount).toBe(2);
    expect(style.references.map((reference) => reference.propertyName)).toEqual([
      'background',
      'cursor',
    ]);
    expect(svg.rewrittenCount).toBe(1);
    expect(svg.cssText).toContain('#soften');
  });

  it('leaves data, document fragments, unsupported, missing, and invalid URLs unchanged', async () => {
    const source = `
      .data { background: url("data:image/svg+xml,%3Csvg%3E%3C/svg%3E"); }
      .local { filter: url(#blur); }
      .blob { background: url(blob:https://cdn.example.test/id); }
      .missing { background: url(./missing.png); }
      .invalid { background: url(http://[); }
    `;
    const result = rewriteCssResource({
      cssText: source,
      context: 'stylesheet',
      baseUrl: CSS_URL,
      sourcePath: CSS_PATH,
      savedResourceMappings: [],
    });

    expect(result.rewrittenCount).toBe(0);
    expect(result.cssText).toBe(source);
    expect(result.references.map((reference) => reference.status)).toEqual([
      'unsupported',
      'fragment',
      'unsupported',
      'unmapped',
      'invalid',
    ]);
  });

  it('preserves malformed CSS verbatim when CSSTree cannot parse it', () => {
    const source = '@import url("unterminated); .broken { background: url(';
    const result = rewriteCssResource({
      cssText: source,
      context: 'stylesheet',
      baseUrl: CSS_URL,
      sourcePath: CSS_PATH,
      savedResourceMappings: [],
    });

    expect(result.cssText).toBe(source);
    expect(result.rewrittenCount).toBe(0);
    expect(result.references).toEqual([]);
  });

  it('preserves source formatting exactly when no saved reference is rewritten', () => {
    const source = `.hero {
      background: url('./missing.png');
    }`;
    const result = rewriteCssResource({
      cssText: source,
      context: 'stylesheet',
      baseUrl: CSS_URL,
      sourcePath: CSS_PATH,
      savedResourceMappings: [],
    });

    expect(result.cssText).toBe(source);
    expect(result.references).toHaveLength(1);
    expect(result.references[0]?.status).toBe('unmapped');
  });

  it('neutralizes uncaptured network, blob, and invalid references for offline packaging', () => {
    const result = rewriteCssResource({
      cssText: `@import "missing.css"; .hero { background: url(missing.png) } .blob { mask: url(blob:https://cdn.example.test/id) } .data { cursor: url(data:image/png;base64,AAAA), auto }`,
      context: 'stylesheet',
      baseUrl: CSS_URL,
      sourcePath: CSS_PATH,
      savedResourceMappings: [],
      uncapturedResourcePolicy: 'neutralize',
    });

    expect(result.rewrittenCount).toBe(0);
    expect(result.neutralizedCount).toBe(3);
    expect(result.changedCount).toBe(3);
    expect(result.cssText).not.toMatch(/missing\.css|missing\.png|blob:/);
    expect(result.cssText).toContain('data:,');
    expect(result.cssText).toContain('data:image/png;base64,AAAA');
    expect(result.references.map((reference) => reference.status)).toEqual([
      'unmapped',
      'unmapped',
      'unsupported',
      'unsupported',
    ]);
  });

  it('rejects invalid contexts, unsafe paths, and ambiguous saved mappings', async () => {
    const [mapping] = await savedMappings([
      { url: 'https://cdn.example.test/image.png', resourceType: 'image' },
    ]);
    if (!mapping) throw new Error('Fixture mapping missing.');
    const options = {
      cssText: '.hero { background: url(image.png) }',
      context: 'stylesheet' as const,
      baseUrl: CSS_URL,
      sourcePath: CSS_PATH,
      savedResourceMappings: [mapping],
    };

    expect(() =>
      rewriteCssResource({ ...options, context: 'selector' as typeof options.context }),
    ).toThrow('context is not supported');
    expect(() => rewriteCssResource({ ...options, sourcePath: '../main.css' })).toThrow(
      'dot path segments',
    );
    expect(() =>
      rewriteCssResource({
        ...options,
        savedResourceMappings: [
          mapping,
          { ...mapping, relativePath: `${mapping.directoryPath}/other.png` },
        ],
      }),
    ).toThrow('ambiguous archive paths');
  });
});
