import { PAGE_ACCESS_ORIGINS, createPageAccessRequest } from '@sitecapsule/permissions';
import { describe, expect, it } from 'vitest';

describe('page access permissions', () => {
  it('requests only the optional HTTP and HTTPS host patterns declared by the extension', () => {
    expect(PAGE_ACCESS_ORIGINS).toEqual(['http://*/*', 'https://*/*']);
    expect(createPageAccessRequest()).toEqual({
      origins: ['http://*/*', 'https://*/*'],
    });
  });

  it('returns a fresh origins array for each browser permission request', () => {
    const first = createPageAccessRequest();
    first.origins.pop();

    expect(createPageAccessRequest().origins).toEqual(['http://*/*', 'https://*/*']);
  });
});
