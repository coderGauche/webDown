import { CONTENT_SCRIPT_FILE, EXTENSION_NAME } from '@sitecapsule/shared';
import { describe, expect, it } from 'vitest';

describe('tooling', () => {
  it('resolves the shared source alias', () => {
    expect(EXTENSION_NAME).toBe('SiteCapsule');
  });

  it('uses an extension-root-relative path for runtime content script injection', () => {
    expect(CONTENT_SCRIPT_FILE).toBe('content-scripts/content.js');
    expect(CONTENT_SCRIPT_FILE).not.toMatch(/^\//);
  });
});
