import { createRuntimeResourcePathPlan } from '@sitecapsule/archive';
import type { ResourceRecord } from '@sitecapsule/domain';
import { describe, expect, it } from 'vitest';

function savedResource(overrides: Partial<ResourceRecord>): ResourceRecord {
  return {
    id: 'job-a:resource',
    jobId: 'job-a',
    originalUrl: 'https://example.test/resource',
    referrerUrl: 'https://example.test/',
    type: 'other',
    discoverySources: ['crawler'],
    state: 'saved',
    byteLength: 1,
    ...overrides,
  };
}

describe('runtime resource path plan', () => {
  it('keeps only the primary document at index.html and maps secondary documents as assets', async () => {
    const primary = savedResource({
      id: 'job-a:document',
      type: 'document',
      originalUrl: 'https://example.test/',
      localPath: 'index.html',
    });
    const secondary = savedResource({
      id: 'job-a:script-resource:1',
      type: 'document',
      originalUrl: 'https://example.test/template.html',
    });

    const result = await createRuntimeResourcePathPlan([primary, secondary], 'job-a:document');

    expect(result.resources[0]).toBe(primary);
    expect(result.resources[1]?.localPath).toMatch(/^assets\/.+\/documents\/template\.html$/);
    expect(result.mappings).toHaveLength(1);
  });

  it('uses resource type and URL together when one URL has multiple inferred types', async () => {
    const script = savedResource({ id: 'script', type: 'script' });
    const data = savedResource({ id: 'data', type: 'data' });

    const result = await createRuntimeResourcePathPlan([script, data], 'job-a:document');

    expect(result.resources.map((resource) => resource.localPath)).toEqual([
      expect.stringContaining('/js/'),
      expect.stringContaining('/data/'),
    ]);
    expect(result.mappings).toHaveLength(2);
  });
});
