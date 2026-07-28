// @vitest-environment happy-dom

import {
  SERVICE_WORKER_BLOCK_FUNCTION,
  SERVICE_WORKER_POLICY_ATTRIBUTE,
  SERVICE_WORKER_POLICY_VALUE,
  applyServiceWorkerSafetyPolicy,
} from '@sitecapsule/archive';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';

function documentFromHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function inlineScripts(document: Document): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll(`script:not([${SERVICE_WORKER_POLICY_ATTRIBUTE}])`));
}

describe('offline Service Worker registration safety policy', () => {
  it('rewrites only AST-confirmed direct registration calls in classic scripts', () => {
    const document = documentFromHtml(`<html><head></head><body><script>
      const example = "navigator.serviceWorker.register('/not-code.js')";
      // navigator.serviceWorker.register('/comment.js');
      navigator.serviceWorker.register('/sw.js', { scope: '/' });
      window.navigator['serviceWorker']['register']('/window-sw.js');
      globalThis.navigator.serviceWorker?.register('/optional-sw.js');
    </script></body></html>`);
    const result = applyServiceWorkerSafetyPolicy(document);
    const source = inlineScripts(document)[0]?.textContent ?? '';

    expect(result.directRegistrationsRewritten).toBe(3);
    expect(result.scripts[0]).toMatchObject({
      kind: 'inline-classic',
      status: 'rewritten',
      directRegistrationsRewritten: 3,
      dynamicOrAliasedReferences: 0,
      parseError: false,
    });
    expect(result.scripts[0]?.changes.map((change) => change.calleePath)).toEqual([
      'navigator.serviceWorker.register',
      'window.navigator.serviceWorker.register',
      'globalThis.navigator.serviceWorker.register',
    ]);
    expect(source.match(new RegExp(`${SERVICE_WORKER_BLOCK_FUNCTION}\\(\\)`, 'g'))).toHaveLength(3);
    expect(source).toContain("navigator.serviceWorker.register('/not-code.js')");
    expect(source).toContain("navigator.serviceWorker.register('/comment.js')");
    expect(() => parse(source, { ecmaVersion: 'latest', sourceType: 'script' })).not.toThrow();
  });

  it('parses inline modules and preserves valid surrounding module syntax', () => {
    const document = documentFromHtml(`<html><head><script type="module">
      export const ready = true;
      if ('serviceWorker' in navigator) {
        await self.navigator.serviceWorker.register('/module-sw.js');
      }
    </script></head><body></body></html>`);
    const result = applyServiceWorkerSafetyPolicy(document);
    const source = inlineScripts(document)[0]?.textContent ?? '';

    expect(result.directRegistrationsRewritten).toBe(1);
    expect(result.scripts[0]).toMatchObject({ kind: 'inline-module', status: 'rewritten' });
    expect(source).toContain('export const ready = true');
    expect(source).toContain(`globalThis.${SERVICE_WORKER_BLOCK_FUNCTION}()`);
    expect(() => parse(source, { ecmaVersion: 'latest', sourceType: 'module' })).not.toThrow();
  });

  it('uses the runtime guard for external, aliased, dynamic, and unparseable scripts', () => {
    const document = documentFromHtml(`<html><head>
      <script src="app.js"></script>
      <script>
        const sw = navigator.serviceWorker;
        sw.register('/aliased.js');
        const register = navigator.serviceWorker.register;
        register('/detached.js');
        navigator.serviceWorker[method]('/dynamic.js');
      </script>
      <script>function broken( { navigator.serviceWorker.register('/parse-error.js') }</script>
      <script type="application/ld+json">{"text":"navigator.serviceWorker.register"}</script>
    </head><body></body></html>`);
    const result = applyServiceWorkerSafetyPolicy(document);

    expect(result.externalScriptsGuarded).toBe(1);
    expect(result.dynamicOrAliasedReferences).toBe(3);
    expect(result.parseErrors).toBe(1);
    expect(result.scripts.map(({ kind, status }) => ({ kind, status }))).toEqual([
      { kind: 'external', status: 'runtime-guard-only' },
      { kind: 'inline-classic', status: 'runtime-guard-only' },
      { kind: 'inline-classic', status: 'parse-error' },
      { kind: 'non-javascript', status: 'ignored' },
    ]);
    expect(result.limitations).toEqual([
      'external-script-runtime-guard-only',
      'dynamic-or-aliased-call-runtime-guard-only',
      'unparseable-inline-script-runtime-guard-only',
      'computed-aliases-not-statically-resolved',
    ]);
  });

  it('inserts one deterministic guard as the first head child and replaces spoofed markers', () => {
    const document = documentFromHtml(`<html><head>
      <meta charset="utf-8">
      <script ${SERVICE_WORKER_POLICY_ATTRIBUTE}="spoofed">globalThis.compromised = true</script>
    </head><body></body></html>`);
    const first = applyServiceWorkerSafetyPolicy(document);
    const second = applyServiceWorkerSafetyPolicy(document);
    const guards = document.querySelectorAll(`script[${SERVICE_WORKER_POLICY_ATTRIBUTE}]`);
    const guard = guards[0];

    expect(first.guardInserted).toBe(true);
    expect(second.guardInserted).toBe(true);
    expect(guards).toHaveLength(1);
    expect(document.head?.firstElementChild).toBe(guard);
    expect(guard?.getAttribute(SERVICE_WORKER_POLICY_ATTRIBUTE)).toBe(SERVICE_WORKER_POLICY_VALUE);
    expect(guard?.textContent).toContain(`Object.defineProperty(globalThis,n`);
    expect(guard?.textContent).toContain('Object.getPrototypeOf(c)');
    expect(guard?.textContent).not.toContain('compromised');
  });

  it('rejects a non-document input', () => {
    expect(() => applyServiceWorkerSafetyPolicy(null as never)).toThrow('DOM document is required');
  });
});
