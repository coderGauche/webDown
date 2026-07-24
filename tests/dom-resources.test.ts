// @vitest-environment happy-dom

import {
  discoverDomResources,
  isDomResourceCandidate,
  parseSrcsetCandidates,
  type DomResourceSource,
} from '@sitecapsule/discovery';
import { describe, expect, it } from 'vitest';

function sourceFromMarkup(markup: string): DomResourceSource {
  const template = document.createElement('template');
  template.innerHTML = markup;

  return {
    URL: 'https://site.example.test/catalog/page.html',
    baseURI: 'https://cdn.example.test/assets/',
    querySelectorAll: (selectors) => template.content.querySelectorAll(selectors),
  };
}

describe('DOM resource discovery', () => {
  it('extracts supported attributes in document and attribute order', () => {
    const candidates = discoverDomResources(
      sourceFromMarkup(`
        <img
          src="images/hero.png?v=2#visual"
          srcset="images/hero-small.png 1x, /images/hero-large.png?format=webp 2x"
        />
        <video src="media/intro.mp4" poster="images/poster.jpg">
          <source src="media/intro.webm" />
          <track src="captions/en.vtt" />
        </video>
        <script src="https://scripts.example.test/app.js"></script>
        <link rel="stylesheet" href="styles/site.css" />
        <link rel="icon preload" href="icons/app.svg" />
        <input type="image" src="images/submit.png" />
      `),
    );

    expect(
      candidates.map(({ tagName, attributeName, rawUrl, resolvedUrl, descriptor }) => ({
        tagName,
        attributeName,
        rawUrl,
        resolvedUrl,
        descriptor,
      })),
    ).toEqual([
      {
        tagName: 'img',
        attributeName: 'src',
        rawUrl: 'images/hero.png?v=2#visual',
        resolvedUrl: 'https://cdn.example.test/assets/images/hero.png?v=2#visual',
        descriptor: undefined,
      },
      {
        tagName: 'img',
        attributeName: 'srcset',
        rawUrl: 'images/hero-small.png',
        resolvedUrl: 'https://cdn.example.test/assets/images/hero-small.png',
        descriptor: '1x',
      },
      {
        tagName: 'img',
        attributeName: 'srcset',
        rawUrl: '/images/hero-large.png?format=webp',
        resolvedUrl: 'https://cdn.example.test/images/hero-large.png?format=webp',
        descriptor: '2x',
      },
      {
        tagName: 'video',
        attributeName: 'src',
        rawUrl: 'media/intro.mp4',
        resolvedUrl: 'https://cdn.example.test/assets/media/intro.mp4',
        descriptor: undefined,
      },
      {
        tagName: 'video',
        attributeName: 'poster',
        rawUrl: 'images/poster.jpg',
        resolvedUrl: 'https://cdn.example.test/assets/images/poster.jpg',
        descriptor: undefined,
      },
      {
        tagName: 'source',
        attributeName: 'src',
        rawUrl: 'media/intro.webm',
        resolvedUrl: 'https://cdn.example.test/assets/media/intro.webm',
        descriptor: undefined,
      },
      {
        tagName: 'track',
        attributeName: 'src',
        rawUrl: 'captions/en.vtt',
        resolvedUrl: 'https://cdn.example.test/assets/captions/en.vtt',
        descriptor: undefined,
      },
      {
        tagName: 'script',
        attributeName: 'src',
        rawUrl: 'https://scripts.example.test/app.js',
        resolvedUrl: 'https://scripts.example.test/app.js',
        descriptor: undefined,
      },
      {
        tagName: 'link',
        attributeName: 'href',
        rawUrl: 'styles/site.css',
        resolvedUrl: 'https://cdn.example.test/assets/styles/site.css',
        descriptor: undefined,
      },
      {
        tagName: 'link',
        attributeName: 'href',
        rawUrl: 'icons/app.svg',
        resolvedUrl: 'https://cdn.example.test/assets/icons/app.svg',
        descriptor: undefined,
      },
      {
        tagName: 'input',
        attributeName: 'src',
        rawUrl: 'images/submit.png',
        resolvedUrl: 'https://cdn.example.test/assets/images/submit.png',
        descriptor: undefined,
      },
    ]);
    expect(candidates.every(isDomResourceCandidate)).toBe(true);
    expect(candidates.every((candidate) => candidate.source === 'dom')).toBe(true);
    expect(candidates.every((candidate) => candidate.documentUrl.includes('/catalog/'))).toBe(true);
  });

  it('ignores same-named attributes that do not represent downloadable resources', () => {
    const candidates = discoverDomResources(
      sourceFromMarkup(`
        <a href="pages/about.html">About</a>
        <base href="https://other.example.test/" />
        <link rel="canonical" href="canonical.html" />
        <link rel="preconnect" href="https://api.example.test" />
        <div src="decorative.png" href="not-a-link"></div>
        <input type="text" src="not-an-image.png" />
        <img src="" />
        <script src="http://[invalid"></script>
      `),
    );

    expect(candidates).toEqual([]);
  });

  it('keeps duplicate, fragment, and non-network candidates for later graph policy stages', () => {
    const candidates = discoverDomResources(
      sourceFromMarkup(`
        <img src="same.png#first" />
        <img src="same.png#second" />
        <img src="data:image/png;base64,AAAA" />
      `),
    );

    expect(candidates.map((candidate) => candidate.resolvedUrl)).toEqual([
      'https://cdn.example.test/assets/same.png#first',
      'https://cdn.example.test/assets/same.png#second',
      'data:image/png;base64,AAAA',
    ]);
  });

  it('parses multiple srcset candidates without splitting the comma in a data URL', () => {
    expect(
      parseSrcsetCandidates(
        'data:image/png;base64,AAAA 1x, images/hero@2x.png 2x, images/wide.png 1200w',
      ),
    ).toEqual([
      { rawUrl: 'data:image/png;base64,AAAA', descriptor: '1x' },
      { rawUrl: 'images/hero@2x.png', descriptor: '2x' },
      { rawUrl: 'images/wide.png', descriptor: '1200w' },
    ]);
  });

  it('rejects over-posted and structurally invalid serialized candidates', () => {
    const [candidate] = discoverDomResources(sourceFromMarkup('<img src="image.png" />'));
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error('Missing DOM resource fixture.');

    expect(isDomResourceCandidate(candidate)).toBe(true);
    expect(isDomResourceCandidate({ ...candidate, tagName: 'div' })).toBe(false);
    expect(isDomResourceCandidate({ ...candidate, resolvedUrl: 'relative.png' })).toBe(false);
    expect(isDomResourceCandidate({ ...candidate, descriptor: '2x' })).toBe(false);
    expect(isDomResourceCandidate({ ...candidate, unexpected: true })).toBe(false);
  });
});
