import {
  buildArchiveResourceManifests,
  createResourcePathMappings,
  reconcileRuntimeArchiveResources,
} from '@sitecapsule/archive';
import type { ResourceRecord } from '@sitecapsule/domain';
import { describe, expect, it } from 'vitest';

function savedResource(overrides: Partial<ResourceRecord> = {}): ResourceRecord {
  return {
    id: 'resource-a',
    jobId: 'job-a',
    originalUrl: 'https://cdn.example.test/original.js',
    finalUrl: 'https://cdn.example.test/app.js',
    referrerUrl: 'https://example.test/',
    type: 'script',
    discoverySources: ['performance'],
    state: 'saved',
    localPath: 'assets/old/app.js',
    byteLength: 10,
    ...overrides,
  };
}

describe('runtime archive resource reconciliation', () => {
  it('keeps one deterministic resource when redirects converge on one final URL', () => {
    const result = reconcileRuntimeArchiveResources([
      savedResource({
        id: 'resource-b',
        originalUrl: 'https://redirect.example.test/app.js',
        discoverySources: ['crawler'],
      }),
      savedResource({ id: 'resource-a', discoverySources: ['dom'] }),
    ]);

    expect(result.rejectedResourceIds).toEqual(['resource-b']);
    expect(result.resources[1]).toMatchObject({
      id: 'resource-a',
      state: 'saved',
      discoverySources: ['dom', 'crawler'],
    });
    expect(result.resources[0]).toMatchObject({
      id: 'resource-b',
      state: 'failed',
      error: { code: 'unexpected-error', context: { field: 'duplicateFinalUrl' } },
    });
    expect(result.resources[0]).not.toHaveProperty('localPath');
  });

  it('isolates an invalid saved final URL without changing documents or prior failures', () => {
    const document = savedResource({
      id: 'document',
      type: 'document',
      originalUrl: 'https://example.test/',
      finalUrl: 'https://example.test/',
      localPath: 'index.html',
    });
    const failed = savedResource({ id: 'failed', state: 'failed', localPath: undefined });
    const invalid = savedResource({ id: 'invalid', finalUrl: 'blob:https://example.test/id' });
    const result = reconcileRuntimeArchiveResources([document, failed, invalid]);

    expect(result.rejectedResourceIds).toEqual(['invalid']);
    expect(result.resources[0]).toBe(document);
    expect(result.resources[1]).toBe(failed);
    expect(result.resources[2]).toMatchObject({
      id: 'invalid',
      state: 'failed',
      error: { context: { field: 'finalUrl' } },
    });
  });

  it('does not mutate its input array or records', () => {
    const input = [savedResource()];
    const snapshot = structuredClone(input);
    reconcileRuntimeArchiveResources(input);
    expect(input).toEqual(snapshot);
  });

  it('produces an unambiguous resource manifest after converging redirects', async () => {
    const reconciled = reconcileRuntimeArchiveResources([
      savedResource({ id: 'resource-b', originalUrl: 'https://redirect.example.test/app.js' }),
      savedResource({ id: 'resource-a' }),
    ]);
    const [mapping] = await createResourcePathMappings([
      { url: 'https://cdn.example.test/app.js', resourceType: 'script' },
    ]);
    const resources = reconciled.resources.map((resource) =>
      resource.state === 'saved' ? { ...resource, localPath: mapping!.relativePath } : resource,
    );

    const manifests = buildArchiveResourceManifests({
      jobId: 'job-a',
      resourceRecords: resources,
      pathMappings: [mapping!],
    });
    expect(manifests.resources.resources).toHaveLength(1);
    expect(manifests.failures.failures).toHaveLength(1);
    expect(manifests.resources.resources[0]?.localPath).toBe(mapping!.relativePath);
  });
});
