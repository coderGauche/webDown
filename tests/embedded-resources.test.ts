// @vitest-environment happy-dom

import {
  discoverEmbeddedResources,
  isEmbeddedCssSource,
  isSvgResourceCandidate,
  type EmbeddedResourceSource,
} from '@sitecapsule/discovery';
import { describe, expect, it } from 'vitest';

function sourceFromMarkup(markup: string): EmbeddedResourceSource {
  const template = document.createElement('template');
  template.innerHTML = markup;

  return {
    URL: 'https://site.example.test/gallery/page.html',
    baseURI: 'https://cdn.example.test/assets/',
    querySelectorAll: (selectors) => template.content.querySelectorAll(selectors),
  };
}

describe('embedded DOM resource discovery', () => {
  it('collects inline style and style element text without parsing CSS URLs', () => {
    const discovery = discoverEmbeddedResources(
      sourceFromMarkup(`
        <main style="background-image: url('./hero.png'); color: red"></main>
        <style>
          @import "./theme.css";
          .card { mask-image: url(./mask.svg#shape); }
        </style>
        <div style="   "></div>
        <style>   </style>
      `),
    );

    expect(discovery.svgResources).toEqual([]);
    expect(discovery.cssSources).toHaveLength(2);
    expect(discovery.cssSources[0]).toMatchObject({
      source: 'style-attribute',
      ordinal: 1,
      tagName: 'main',
      attributeName: 'style',
      cssText: "background-image: url('./hero.png'); color: red",
      documentUrl: 'https://site.example.test/gallery/page.html',
      baseUrl: 'https://cdn.example.test/assets/',
    });
    expect(discovery.cssSources[1]).toMatchObject({
      source: 'style-element',
      ordinal: 2,
      tagName: 'style',
    });
    expect(discovery.cssSources[1]?.cssText).toContain('@import "./theme.css"');
    expect(discovery.cssSources[1]?.cssText).toContain('url(./mask.svg#shape)');
    expect(discovery.cssSources.every(isEmbeddedCssSource)).toBe(true);
  });

  it('extracts external SVG href and xlink:href resources with namespace checks', () => {
    const discovery = discoverEmbeddedResources(
      sourceFromMarkup(`
        <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
          <image href="images/scene.png?v=2#crop" filter="url(effects.svg#soften)"></image>
          <use href="icons/sprite.svg#download"></use>
          <use href="#local-symbol"></use>
          <filter><feImage xlink:href="effects/noise.png"></feImage></filter>
          <a href="pages/details.svg">SVG navigation</a>
        </svg>
        <image href="html-custom-element.png"></image>
      `),
    );

    expect(discovery.cssSources).toEqual([
      {
        source: 'svg-presentation-attribute',
        ordinal: 1,
        tagName: 'image',
        attributeName: 'filter',
        cssText: 'url(effects.svg#soften)',
        documentUrl: 'https://site.example.test/gallery/page.html',
        baseUrl: 'https://cdn.example.test/assets/',
      },
    ]);
    expect(discovery.svgResources).toEqual([
      {
        source: 'svg',
        ordinal: 1,
        tagName: 'image',
        attributeName: 'href',
        attributeValue: 'images/scene.png?v=2#crop',
        rawUrl: 'images/scene.png?v=2#crop',
        resolvedUrl: 'https://cdn.example.test/assets/images/scene.png?v=2#crop',
        documentUrl: 'https://site.example.test/gallery/page.html',
        baseUrl: 'https://cdn.example.test/assets/',
      },
      {
        source: 'svg',
        ordinal: 2,
        tagName: 'use',
        attributeName: 'href',
        attributeValue: 'icons/sprite.svg#download',
        rawUrl: 'icons/sprite.svg#download',
        resolvedUrl: 'https://cdn.example.test/assets/icons/sprite.svg#download',
        documentUrl: 'https://site.example.test/gallery/page.html',
        baseUrl: 'https://cdn.example.test/assets/',
      },
      {
        source: 'svg',
        ordinal: 3,
        tagName: 'feimage',
        attributeName: 'xlink:href',
        attributeValue: 'effects/noise.png',
        rawUrl: 'effects/noise.png',
        resolvedUrl: 'https://cdn.example.test/assets/effects/noise.png',
        documentUrl: 'https://site.example.test/gallery/page.html',
        baseUrl: 'https://cdn.example.test/assets/',
      },
    ]);
    expect(discovery.svgResources.every(isSvgResourceCandidate)).toBe(true);
  });

  it('skips empty, local-only, invalid, navigational, and non-SVG references', () => {
    const discovery = discoverEmbeddedResources(
      sourceFromMarkup(`
        <div href="image.png"></div>
        <style></style>
        <svg xmlns="http://www.w3.org/2000/svg">
          <image href=""></image>
          <image href="http://[invalid"></image>
          <use href="#symbol"></use>
          <a href="another-page.svg">Link</a>
        </svg>
      `),
    );

    expect(discovery).toEqual({ cssSources: [], svgResources: [] });
  });

  it('rejects malformed or over-posted serialized embedded records', () => {
    const discovery = discoverEmbeddedResources(
      sourceFromMarkup(`
        <div style="background: red"></div>
        <svg xmlns="http://www.w3.org/2000/svg"><image href="image.png"></image></svg>
      `),
    );
    const cssSource = discovery.cssSources[0];
    const svgResource = discovery.svgResources[0];
    expect(cssSource).toBeDefined();
    expect(svgResource).toBeDefined();
    if (!cssSource || !svgResource) throw new Error('Missing embedded resource fixtures.');

    expect(isEmbeddedCssSource({ ...cssSource, cssText: '   ' })).toBe(false);
    expect(isEmbeddedCssSource({ ...cssSource, ordinal: 0 })).toBe(false);
    expect(isEmbeddedCssSource({ ...cssSource, unexpected: true })).toBe(false);
    expect(isSvgResourceCandidate({ ...svgResource, tagName: 'a' })).toBe(false);
    expect(isSvgResourceCandidate({ ...svgResource, rawUrl: '#local' })).toBe(false);
    expect(isSvgResourceCandidate({ ...svgResource, resolvedUrl: 'relative.png' })).toBe(false);
    expect(isSvgResourceCandidate({ ...svgResource, unexpected: true })).toBe(false);
  });
});
