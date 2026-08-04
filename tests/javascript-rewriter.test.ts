import { createResourcePathMappings, rewriteJavascriptResource } from '@sitecapsule/archive';
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
    expect(result.javascript).toContain('#mesh');
    expect(result.javascript).toContain('https://unsaved.example.test/live.json');
    expect(result.rewrites.map((rewrite) => rewrite.normalizedUrl)).toContain(
      'https://cdn.example.test/data/config.json?version=2',
    );
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
