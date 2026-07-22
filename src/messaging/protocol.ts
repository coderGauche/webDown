export const MESSAGE_TYPES = {
  pageInfoRequest: 'page-info/request',
  pageInfoCollect: 'page-info/collect',
} as const;

export type PageInfo = {
  title: string;
  url: string;
};

export type PageInfoRequest = {
  type: typeof MESSAGE_TYPES.pageInfoRequest;
  tabId: number;
};

export type PageInfoCollectRequest = {
  type: typeof MESSAGE_TYPES.pageInfoCollect;
};

export type PageInfoResponse =
  | {
      type: 'page-info/response';
      ok: true;
      page: PageInfo;
    }
  | {
      type: 'page-info/response';
      ok: false;
      error: string;
    };

export function createPageInfoRequest(tabId: number): PageInfoRequest {
  return {
    type: MESSAGE_TYPES.pageInfoRequest,
    tabId,
  };
}

export function createPageInfoCollectRequest(): PageInfoCollectRequest {
  return {
    type: MESSAGE_TYPES.pageInfoCollect,
  };
}

export function createPageInfoResponse(page: PageInfo): PageInfoResponse {
  return {
    type: 'page-info/response',
    ok: true,
    page,
  };
}

export function createPageInfoError(error: string): PageInfoResponse {
  return {
    type: 'page-info/response',
    ok: false,
    error,
  };
}

export function isPageInfoRequest(message: unknown): message is PageInfoRequest {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as Partial<PageInfoRequest>;
  return candidate.type === MESSAGE_TYPES.pageInfoRequest && Number.isInteger(candidate.tabId);
}

export function isPageInfoCollectRequest(message: unknown): message is PageInfoCollectRequest {
  return (
    !!message &&
    typeof message === 'object' &&
    (message as Partial<PageInfoCollectRequest>).type === MESSAGE_TYPES.pageInfoCollect
  );
}

export function isPageInfoResponse(message: unknown): message is PageInfoResponse {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as {
    type?: unknown;
    ok?: unknown;
    page?: unknown;
    error?: unknown;
  };
  if (candidate.type !== 'page-info/response' || typeof candidate.ok !== 'boolean') return false;

  if (candidate.ok) {
    const page = candidate.page as Partial<PageInfo> | undefined;
    return (
      !!page &&
      typeof page === 'object' &&
      typeof page.title === 'string' &&
      typeof page.url === 'string'
    );
  }

  return typeof candidate.error === 'string';
}
