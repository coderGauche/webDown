// @vitest-environment happy-dom

import {
  createRelativeArchivePath,
  createResourcePathMappings,
  rewriteHtmlResource,
  type ResourcePathInput,
} from '@sitecapsule/archive';
import { beforeAll, describe, expect, it } from 'vitest';

const DOCUMENT_URL = 'https://page.example.test/products/index.html';
const BASE_URL = 'https://cdn.example.test/assets/';
const DOCUMENT_PATH = 'assets/origins/https/dns-page.example.test/default/documents/index.html';

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

function parseResult(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

async function savedMappings(inputs: readonly ResourcePathInput[]) {
  return createResourcePathMappings(inputs);
}

describe('DOMParser HTML resource rewriting', () => {
  it('computes portable POSIX paths from the HTML file directory', () => {
    expect(createRelativeArchivePath('pages/index.html', 'pages/app.css')).toBe('app.css');
    expect(createRelativeArchivePath('pages/en/index.html', 'assets/images/logo.png')).toBe(
      '../../assets/images/logo.png',
    );
    expect(createRelativeArchivePath('index.html', 'assets/app.js')).toBe('assets/app.js');
  });

  it('rewrites saved direct resources, preserves fragments, and neutralizes base href', async () => {
    const imageUrl = 'https://cdn.example.test/assets/images/image%23hero%20large.png?v=1';
    const stylesheetUrl = 'https://cdn.example.test/assets/css/site.css';
    const scriptUrl = 'https://static.example.test/app.js';
    const posterUrl = 'https://cdn.example.test/assets/media/poster.jpg';
    const svgUrl = 'https://cdn.example.test/assets/icons/sprite.svg';
    const mappings = await savedMappings([
      { url: imageUrl, resourceType: 'image' },
      { url: stylesheetUrl, resourceType: 'stylesheet' },
      { url: scriptUrl, resourceType: 'script' },
      { url: posterUrl, resourceType: 'image' },
      { url: svgUrl, resourceType: 'image' },
    ]);
    const result = rewriteHtmlResource({
      html: `<!doctype html>
        <html><head>
          <base href="${BASE_URL}">
          <link rel="stylesheet" href="css/site.css">
          <link rel="canonical" href="../canonical">
          <style>.hero { background: url(images/leave-for-m6-t5.png); }</style>
        </head><body>
          <a href="../products/next.html">Next</a>
          <img id="hero" src="images/image%23hero%20large.png?v=1#focus"
               srcset="images/image-small.png 1x, images/image-large.png 2x">
          <img id="duplicate" src="images/image%23hero%20large.png?v=1#second">
          <script src="https://static.example.test/app.js"></script>
          <video poster="media/poster.jpg"></video>
          <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
            <image id="external-svg" href="icons/sprite.svg#hero"></image>
            <image id="legacy-svg" xlink:href="icons/sprite.svg#legacy"></image>
            <use id="local-symbol" href="#local-icon"></use>
          </svg>
        </body></html>`,
      documentUrl: DOCUMENT_URL,
      baseUrl: BASE_URL,
      documentPath: DOCUMENT_PATH,
      savedResourceMappings: mappings,
    });
    const rewritten = parseResult(result.html);

    expect(result.html.startsWith('<!DOCTYPE html>\n')).toBe(true);
    expect(result.baseHrefRemovals).toEqual([
      {
        elementOrdinal: 3,
        originalValue: BASE_URL,
        resolvedUrl: BASE_URL,
      },
    ]);
    expect(rewritten.querySelector('base')?.hasAttribute('href')).toBe(false);
    expect(rewritten.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      '../canonical',
    );
    expect(rewritten.querySelector('a')?.getAttribute('href')).toBe('../products/next.html');
    expect(rewritten.querySelector('#hero')?.getAttribute('srcset')).toBe(
      'images/image-small.png 1x, images/image-large.png 2x',
    );
    expect(rewritten.querySelector('style')?.textContent).toContain(
      'url(images/leave-for-m6-t5.png)',
    );
    expect(rewritten.querySelector('#local-symbol')?.getAttribute('href')).toBe('#local-icon');

    const imageMapping = mappings.find((mapping) => mapping.normalizedUrl === imageUrl);
    if (!imageMapping) throw new Error('Image mapping missing.');
    const imageReference = result.references.find(
      (reference) => reference.status === 'rewritten' && reference.normalizedUrl === imageUrl,
    );
    expect(imageReference).toMatchObject({
      status: 'rewritten',
      originalValue: 'images/image%23hero%20large.png?v=1#focus',
      targetPath: imageMapping.relativePath,
    });
    if (!imageReference || imageReference.status !== 'rewritten') {
      throw new Error('Image reference was not rewritten.');
    }
    expect(imageReference.rewrittenValue).toContain('%23hero%20large--q-');
    expect(imageReference.rewrittenValue.endsWith('.png#focus')).toBe(true);
    expect(rewritten.querySelector('#hero')?.getAttribute('src')).toBe(
      imageReference.rewrittenValue,
    );
    expect(rewritten.querySelector('#duplicate')?.getAttribute('src')).toBe(
      imageReference.rewrittenValue.replace('#focus', '#second'),
    );
    expect(result.rewrittenCount).toBe(7);
    expect(result.references).toHaveLength(7);
    expect(result.references.every((reference) => reference.status === 'rewritten')).toBe(true);
  });

  it('leaves unmapped, unsupported, invalid, navigation, and srcset references unchanged', async () => {
    const mappedUrl = 'https://cdn.example.test/assets/saved.png';
    const mappings = await savedMappings([{ url: mappedUrl, resourceType: 'image' }]);
    const source = `<!doctype html><html><body>
      <img id="saved" src="saved.png">
      <img id="missing" src="missing.png">
      <img id="embedded" src="data:image/png;base64,AAAA">
      <script id="invalid" src="http://["></script>
      <img id="responsive" srcset="small.png 1x, large.png 2x">
      <a id="navigation" href="next.html">Next</a>
      <link id="canonical" rel="canonical" href="canonical.html">
      <input id="ordinary" src="ignored.png">
    </body></html>`;
    const result = rewriteHtmlResource({
      html: source,
      documentUrl: DOCUMENT_URL,
      baseUrl: BASE_URL,
      documentPath: DOCUMENT_PATH,
      savedResourceMappings: mappings,
    });
    const rewritten = parseResult(result.html);

    expect(result.references.map((reference) => reference.status)).toEqual([
      'rewritten',
      'unmapped',
      'unsupported',
      'invalid',
    ]);
    expect(result.rewrittenCount).toBe(1);
    expect(rewritten.querySelector('#missing')?.getAttribute('src')).toBe('missing.png');
    expect(rewritten.querySelector('#embedded')?.getAttribute('src')).toBe(
      'data:image/png;base64,AAAA',
    );
    expect(rewritten.querySelector('#invalid')?.getAttribute('src')).toBe('http://[');
    expect(rewritten.querySelector('#responsive')?.getAttribute('srcset')).toBe(
      'small.png 1x, large.png 2x',
    );
    expect(rewritten.querySelector('#navigation')?.getAttribute('href')).toBe('next.html');
    expect(rewritten.querySelector('#canonical')?.getAttribute('href')).toBe('canonical.html');
    expect(rewritten.querySelector('#ordinary')?.getAttribute('src')).toBe('ignored.png');
  });

  it('uses the supplied captured base URL even after removing multiple base href values', async () => {
    const imageUrl = 'https://cdn.example.test/assets/image.png';
    const mappings = await savedMappings([{ url: imageUrl, resourceType: 'image' }]);
    const result = rewriteHtmlResource({
      html: `<html><head>
        <base href="https://wrong.example.test/first/">
        <base href="http://[">
      </head><body><img src="image.png"></body></html>`,
      documentUrl: DOCUMENT_URL,
      baseUrl: BASE_URL,
      documentPath: DOCUMENT_PATH,
      savedResourceMappings: mappings,
    });

    expect(result.rewrittenCount).toBe(1);
    expect(result.baseHrefRemovals).toEqual([
      {
        elementOrdinal: 3,
        originalValue: 'https://wrong.example.test/first/',
        resolvedUrl: 'https://wrong.example.test/first/',
      },
      { elementOrdinal: 4, originalValue: 'http://[', resolvedUrl: null },
    ]);
    expect(parseResult(result.html).querySelectorAll('base[href]')).toHaveLength(0);
  });

  it('rewrites style elements, style attributes, and SVG presentation attributes with CSSTree', async () => {
    const themeUrl = 'https://cdn.example.test/assets/theme.css';
    const imageUrl = 'https://cdn.example.test/assets/image.png';
    const maskUrl = 'https://cdn.example.test/assets/mask.svg';
    const filterUrl = 'https://cdn.example.test/assets/filter.svg';
    const mappings = await savedMappings([
      { url: themeUrl, resourceType: 'stylesheet' },
      { url: imageUrl, resourceType: 'image' },
      { url: maskUrl, resourceType: 'image' },
      { url: filterUrl, resourceType: 'image' },
    ]);
    const result = rewriteHtmlResource({
      html: `<html><head><style>
        @import "theme.css";
        .hero { background: url(image.png#hero); }
      </style></head><body>
        <main id="styled" style="mask-image: url(mask.svg#mask)"></main>
        <svg xmlns="http://www.w3.org/2000/svg">
          <rect id="filtered" filter="url(filter.svg#soften)"></rect>
          <rect id="local-filter" filter="url(#local)"></rect>
        </svg>
      </body></html>`,
      documentUrl: DOCUMENT_URL,
      baseUrl: BASE_URL,
      documentPath: DOCUMENT_PATH,
      savedResourceMappings: mappings,
    });
    const rewritten = parseResult(result.html);

    expect(result.cssRewrittenCount).toBe(4);
    expect(result.cssRewrites).toHaveLength(4);
    expect(result.cssRewrites.map((rewrite) => rewrite.sourceType)).toEqual([
      'style-element',
      'style-attribute',
      'svg-presentation-attribute',
      'svg-presentation-attribute',
    ]);
    expect(result.cssRewrites.at(-1)?.result.references[0]?.status).toBe('fragment');
    expect(rewritten.querySelector('style')?.textContent).not.toContain('@import "theme.css"');
    expect(rewritten.querySelector('style')?.textContent).toContain('#hero');
    expect(rewritten.querySelector('#styled')?.getAttribute('style')).toContain('#mask');
    expect(rewritten.querySelector('#filtered')?.getAttribute('filter')).toContain('#soften');
    expect(rewritten.querySelector('#local-filter')?.getAttribute('filter')).toBe('url(#local)');
  });

  it('coordinates picture, media fallbacks, tracks, posters, and font references', async () => {
    const resources: ResourcePathInput[] = [
      { url: `${BASE_URL}images/small.webp`, resourceType: 'image' },
      { url: `${BASE_URL}images/large.webp?v=2`, resourceType: 'image' },
      { url: `${BASE_URL}images/fallback.jpg`, resourceType: 'image' },
      { url: `${BASE_URL}media/poster.jpg`, resourceType: 'image' },
      { url: `${BASE_URL}media/movie.mp4`, resourceType: 'video' },
      { url: `${BASE_URL}media/movie.webm`, resourceType: 'video' },
      { url: `${BASE_URL}media/audio.mp3`, resourceType: 'audio' },
      { url: `${BASE_URL}media/audio.ogg`, resourceType: 'audio' },
      { url: `${BASE_URL}captions/en.vtt`, resourceType: 'data' },
      { url: `${BASE_URL}fonts/preload.woff2`, resourceType: 'font' },
      { url: `${BASE_URL}fonts/archive.woff2`, resourceType: 'font' },
    ];
    const mappings = await savedMappings(resources);
    const result = rewriteHtmlResource({
      html: `<!doctype html><html><head>
        <link rel="preload" as="font" href="fonts/preload.woff2" crossorigin>
        <style>@font-face { font-family: Archive; src: url(fonts/archive.woff2#regular) format("woff2"); }</style>
      </head><body>
        <picture>
          <source type="image/webp" srcset="images/small.webp 1x, images/large.webp?v=2#wide 2x">
          <img id="preview" src="images/fallback.jpg" srcset="images/small.webp 640w">
        </picture>
        <video id="movie" src="media/movie.mp4" poster="media/poster.jpg">
          <source id="movie-fallback" src="media/movie.webm" type="video/webm">
          <track id="captions" src="captions/en.vtt" kind="captions">
        </video>
        <audio id="audio" src="media/audio.mp3">
          <source id="audio-fallback" src="media/audio.ogg" type="audio/ogg">
        </audio>
      </body></html>`,
      documentUrl: DOCUMENT_URL,
      baseUrl: BASE_URL,
      documentPath: DOCUMENT_PATH,
      savedResourceMappings: mappings,
    });
    const rewritten = parseResult(result.html);

    expect(result.rewrittenCount).toBe(8);
    expect(result.references).toHaveLength(8);
    expect(result.references.every((reference) => reference.status === 'rewritten')).toBe(true);
    expect(result.srcsetRewrittenCount).toBe(3);
    expect(result.srcsetRewrites).toHaveLength(2);
    expect(result.cssRewrittenCount).toBe(1);
    expect(result.cssRewrites[0]?.result.references[0]).toMatchObject({
      kind: 'font-face',
      status: 'rewritten',
    });

    const pictureSrcset = rewritten.querySelector('picture source')?.getAttribute('srcset');
    expect(pictureSrcset).toContain(' 1x, ');
    expect(pictureSrcset).toContain('--q-');
    expect(pictureSrcset).toContain('#wide 2x');
    expect(rewritten.querySelector('#preview')?.getAttribute('srcset')).toContain(' 640w');
    expect(rewritten.querySelector('#movie')?.getAttribute('src')).toContain('/media/');
    expect(rewritten.querySelector('#movie')?.getAttribute('poster')).toContain('/images/');
    expect(rewritten.querySelector('#movie-fallback')?.getAttribute('src')).toContain('/media/');
    expect(rewritten.querySelector('#captions')?.getAttribute('src')).toContain('/data/');
    expect(rewritten.querySelector('#audio')?.getAttribute('src')).toContain('/media/');
    expect(rewritten.querySelector('#audio-fallback')?.getAttribute('src')).toContain('/media/');
    expect(rewritten.querySelector('link[as="font"]')?.getAttribute('href')).toContain('/fonts/');
    expect(rewritten.querySelector('style')?.textContent).toContain('/fonts/');
    expect(rewritten.querySelector('style')?.textContent).toContain('#regular');
  });

  it('applies the Service Worker safety policy before serializing offline HTML', () => {
    const result = rewriteHtmlResource({
      html: `<html><head><script src="app.js"></script></head><body><script>
        navigator.serviceWorker.register('/sw.js');
      </script></body></html>`,
      documentUrl: DOCUMENT_URL,
      baseUrl: BASE_URL,
      documentPath: DOCUMENT_PATH,
      savedResourceMappings: [],
    });
    const rewritten = parseResult(result.html);

    expect(result.serviceWorkerSafety).toMatchObject({
      guardInserted: true,
      guardPosition: 'head-first',
      directRegistrationsRewritten: 1,
      externalScriptsGuarded: 1,
      parseErrors: 0,
    });
    expect(
      rewritten.head.firstElementChild?.getAttribute('data-sitecapsule-service-worker-policy'),
    ).toBe('block-registration-v1');
    expect(rewritten.body.querySelector('script')?.textContent).toContain(
      '__sitecapsuleBlockServiceWorkerRegistration_v1__()',
    );
    expect(rewritten.body.querySelector('script')?.textContent).not.toContain(
      "serviceWorker.register('/sw.js')",
    );
  });

  it('rejects unsafe paths, non-network document context, and ambiguous saved mappings', async () => {
    const [mapping] = await savedMappings([
      { url: 'https://cdn.example.test/assets/image.png', resourceType: 'image' },
    ]);
    if (!mapping) throw new Error('Fixture mapping missing.');
    const baseOptions = {
      html: '<html><body><img src="image.png"></body></html>',
      documentUrl: DOCUMENT_URL,
      baseUrl: BASE_URL,
      documentPath: DOCUMENT_PATH,
      savedResourceMappings: [mapping],
    };

    expect(() => rewriteHtmlResource({ ...baseOptions, documentPath: '../index.html' })).toThrow(
      'dot path segments',
    );
    expect(() =>
      rewriteHtmlResource({ ...baseOptions, documentUrl: 'file:///tmp/page.html' }),
    ).toThrow('HTTP or HTTPS');
    expect(() =>
      rewriteHtmlResource({
        ...baseOptions,
        savedResourceMappings: [
          mapping,
          { ...mapping, relativePath: `${mapping.directoryPath}/other.png` },
        ],
      }),
    ).toThrow('ambiguous archive paths');
  });
});
