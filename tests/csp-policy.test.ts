// @vitest-environment happy-dom

import {
  SERVICE_WORKER_GUARD_HASH_SOURCE,
  SERVICE_WORKER_GUARD_SOURCE,
  adjustContentSecurityPolicies,
} from '@sitecapsule/archive';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

function documentFromHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('offline Content Security Policy adjustment', () => {
  it('adds only the sources needed by the guard and rewritten local resource types', () => {
    const document = documentFromHtml(`<html><head>
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src-elem 'strict-dynamic' 'none'; img-src https://cdn.example.test; style-src 'self'; frame-ancestors 'none'">
    </head><body></body></html>`);
    const result = adjustContentSecurityPolicies(document, ['image', 'font', 'stylesheet']);
    const policy = document.querySelector('meta')?.getAttribute('content');

    expect(result.policiesAdjusted).toBe(1);
    expect(result.policies[0]?.directiveChanges).toEqual([
      {
        directiveName: 'default-src',
        addedSources: ["'self'"],
        removedSources: ["'none'"],
        reasons: ['allow-local-font'],
      },
      {
        directiveName: 'script-src-elem',
        addedSources: [SERVICE_WORKER_GUARD_HASH_SOURCE],
        removedSources: ["'none'"],
        reasons: ['allow-service-worker-guard'],
      },
      {
        directiveName: 'img-src',
        addedSources: ["'self'"],
        removedSources: [],
        reasons: ['allow-local-image'],
      },
    ]);
    expect(policy).toContain(
      `script-src-elem 'strict-dynamic' ${SERVICE_WORKER_GUARD_HASH_SOURCE}`,
    );
    expect(policy).toContain("img-src https://cdn.example.test 'self'");
    expect(policy).not.toContain("'unsafe-inline'");
    expect(result.limitations).toContain('meta-unsupported-directives-preserved');
  });

  it('adjusts every enforcing policy and preserves duplicate directives for auditing', () => {
    const document = documentFromHtml(`<html><head>
      <meta http-equiv="content-security-policy" content="script-src 'none'; script-src https://ignored.example.test">
      <meta http-equiv="CONTENT-SECURITY-POLICY" content="default-src 'none'">
    </head><body></body></html>`);
    const result = adjustContentSecurityPolicies(document, ['script']);

    expect(result.policiesAdjusted).toBe(2);
    expect(result.policies[0]?.adjustedPolicy).toContain(
      `script-src ${SERVICE_WORKER_GUARD_HASH_SOURCE} 'self'; script-src https://ignored.example.test`,
    );
    expect(result.policies[1]?.adjustedPolicy).toBe(
      `default-src ${SERVICE_WORKER_GUARD_HASH_SOURCE} 'self'`,
    );
    expect(result.limitations).toContain('duplicate-directives-preserved-first-wins');
  });

  it('records report-only, outside-head, and empty policies without mutating them', () => {
    const document = documentFromHtml(`<html><head>
      <meta http-equiv="Content-Security-Policy-Report-Only" content="default-src 'none'">
      <meta http-equiv="Content-Security-Policy" content="">
    </head><body></body></html>`);
    const outside = document.createElement('meta');
    outside.setAttribute('http-equiv', 'Content-Security-Policy');
    outside.setAttribute('content', "script-src 'none'");
    document.body.append(outside);

    const result = adjustContentSecurityPolicies(document, ['image']);

    expect(result.policies.map((policy) => policy.status)).toEqual([
      'report-only-unsupported',
      'empty-policy',
      'outside-head',
    ]);
    expect(outside.getAttribute('content')).toBe("script-src 'none'");
    expect(result.limitations).toContain('report-only-meta-is-not-supported-by-browsers');
    expect(result.limitations).toContain('outside-head-meta-is-not-enforced');
  });

  it('keeps unrestricted documents unrestricted and rejects non-document input', () => {
    const document = documentFromHtml('<html><head></head><body></body></html>');
    const result = adjustContentSecurityPolicies(document, ['image', 'script']);

    expect(result.policiesFound).toBe(0);
    expect(result.policiesAdjusted).toBe(0);
    expect(document.querySelector('meta[http-equiv]')).toBeNull();
    expect(() => adjustContentSecurityPolicies(null as never, [])).toThrow(
      'DOM document is required',
    );
    expect(() => adjustContentSecurityPolicies(document, ['unknown' as never])).toThrow(
      'recognized resource types',
    );
  });

  it('pins the declared CSP hash to the exact UTF-8 guard source', () => {
    const digest = createHash('sha256')
      .update(SERVICE_WORKER_GUARD_SOURCE, 'utf8')
      .digest('base64');

    expect(SERVICE_WORKER_GUARD_HASH_SOURCE).toBe(`'sha256-${digest}'`);
  });
});
