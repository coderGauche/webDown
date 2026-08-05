import {
  createResourcePathMappings,
  discoverJavascriptResourceReferences,
  rewriteJavascriptResource,
} from '@sitecapsule/archive';
import { describe, expect, it } from 'vitest';

describe('JavaScript archive URL rewriting', () => {
  it('rewrites saved module, worker, asset, and fetch references', async () => {
    const baseUrl = 'https://cdn.example.test/js/app.js';
    const mappings = await createResourcePathMappings([
      { url: 'https://cdn.example.test/js/chunk.js', resourceType: 'script' },
      { url: 'https://cdn.example.test/js/worker.js', resourceType: 'script' },
      { url: 'https://cdn.example.test/models/scene.wasm', resourceType: 'wasm' },
      { url: 'https://cdn.example.test/data/config.json?version=2', resourceType: 'data' },
    ]);
    const sourcePath =
      mappings.find((mapping) => mapping.normalizedUrl === baseUrl)?.relativePath ??
      'assets/origins/https/dns-cdn.example.test/default/js/app.js';
    const result = rewriteJavascriptResource({
      javascript: `
        import value from './chunk.js';
        export { value as next } from './chunk.js';
        const lazy = import('./chunk.js');
        const worker = new Worker('./worker.js');
        const model = new URL('../models/scene.wasm#mesh', import.meta.url);
        fetch('../data/config.json?version=2');
        fetch('https://unsaved.example.test/live.json');
      `,
      baseUrl,
      sourcePath,
      savedResourceMappings: mappings,
    });

    expect(result.parseError).toBe(false);
    expect(result.rewrittenCount).toBe(6);
    expect(result.javascript).not.toContain("'./chunk.js'");
    expect(result.javascript).toContain('from "./chunk.js"');
    expect(result.javascript).toContain('import("./chunk.js")');
    expect(result.javascript).toContain('new Worker("./worker.js")');
    expect(result.javascript).toContain('#mesh');
    expect(result.javascript).toContain('https://unsaved.example.test/live.json');
    expect(result.rewrites.map((rewrite) => rewrite.normalizedUrl)).toContain(
      'https://cdn.example.test/data/config.json?version=2',
    );
  });

  it('keeps parent-directory module references valid without adding another prefix', async () => {
    const mappings = await createResourcePathMappings([
      { url: 'https://cdn.example.test/shared/runtime.js', resourceType: 'script' },
    ]);
    const result = rewriteJavascriptResource({
      javascript: `import runtime from '../shared/runtime.js';`,
      baseUrl: 'https://cdn.example.test/features/app.js',
      sourcePath: 'assets/origins/https/dns-cdn.example.test/default/features/app.js',
      savedResourceMappings: mappings,
    });

    expect(result.parseError).toBe(false);
    expect(result.javascript).toContain('from "../js/runtime.js"');
  });

  it('rewrites generated dependency-map strings that point at saved chunks', async () => {
    const mappings = await createResourcePathMappings([
      { url: 'https://example.test/chunks/home.js', resourceType: 'script' },
      { url: 'https://example.test/assets/hero.webp', resourceType: 'image' },
    ]);
    const result = rewriteJavascriptResource({
      javascript:
        'const deps = ["./chunks/home.js", "./assets/hero.webp", "ordinary copy", "", ".", "/about"]; const page = import(`./chunks/home.js`); export { deps, page };',
      baseUrl: 'https://example.test/main.js',
      sourcePath: 'assets/origins/https/dns-example.test/default/js/main.js',
      savedResourceMappings: mappings,
    });

    expect(result.parseError).toBe(false);
    expect(result.rewrittenCount).toBe(3);
    expect(result.javascript).toContain('"./home.js"');
    expect(result.javascript).toContain('import("./home.js")');
    expect(result.javascript).toContain('"../images/hero.webp"');
    expect(result.javascript).toContain('"ordinary copy"');
    expect(result.javascript).toContain('"", "."');
    expect(result.javascript).toContain('"/about"');
  });

  it('discovers and rewrites resource URLs nested inside JSON.parse data', async () => {
    const frameUrl = 'https://cdn.example.test/frames/frame-001.avif';
    const missingUrl = 'https://cdn.example.test/frames/frame-002.avif';
    const mappings = await createResourcePathMappings([{ url: frameUrl, resourceType: 'image' }]);
    const embeddedJson = JSON.stringify({
      frames: [{ hostedUrl: frameUrl }, { hostedUrl: missingUrl }],
      label: 'hero frames',
    });
    const javascript = `const frames = JSON.parse(${JSON.stringify(embeddedJson)});`;
    const discovery = discoverJavascriptResourceReferences(
      javascript,
      'https://cdn.example.test/js/home.js',
    );
    const result = rewriteJavascriptResource({
      javascript,
      baseUrl: 'https://cdn.example.test/js/home.js',
      sourcePath: 'assets/origins/https/dns-cdn.example.test/default/js/home.js',
      savedResourceMappings: mappings,
    });

    expect(discovery.parseError).toBe(false);
    expect(discovery.references.map((reference) => reference.normalizedUrl)).toEqual([
      frameUrl,
      missingUrl,
    ]);
    expect(result.rewrittenCount).toBe(1);
    expect(result.javascript).not.toContain(frameUrl);
    expect(result.javascript).toContain(missingUrl);
    expect(result.javascript).toContain(
      './assets/origins/https/dns-cdn.example.test/default/images/frame-001.avif',
    );
    expect(result.javascript).toContain('hero frames');
  });

  it('leaves opaque bundles unchanged and reports the parse boundary', () => {
    const result = rewriteJavascriptResource({
      javascript: 'function { invalid',
      baseUrl: 'https://example.test/app.js',
      sourcePath: 'assets/app.js',
      savedResourceMappings: [],
    });

    expect(result).toEqual({
      javascript: 'function { invalid',
      rewrittenCount: 0,
      parseError: true,
      rewrites: [],
    });
  });
});
