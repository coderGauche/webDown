import { EXTENSION_NAME } from '@sitecapsule/shared';
import { describe, expect, it } from 'vitest';

describe('tooling', () => {
  it('resolves the shared source alias', () => {
    expect(EXTENSION_NAME).toBe('SiteCapsule');
  });
});
