export const PAGE_ACCESS_ORIGINS = ['http://*/*', 'https://*/*'] as const;

export type PageAccessRequest = {
  origins: string[];
};

export function createPageAccessRequest(): PageAccessRequest {
  return {
    origins: [...PAGE_ACCESS_ORIGINS],
  };
}
