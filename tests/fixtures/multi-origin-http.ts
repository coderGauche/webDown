import type { ResourceRedirectHop } from '@sitecapsule/domain';
import type { ResourceBodySource, ResourceResponseSource } from '@sitecapsule/download';

export const MULTI_ORIGIN_URLS = {
  primary: 'https://fixture-main.test/index.html',
  stylesheet: 'https://fixture-cdn.test/app.css',
  redirect: 'https://fixture-main.test/redirect.js',
  redirectFinal: 'https://fixture-cdn.test/final.js',
  retry429: 'https://fixture-cdn.test/retry-429.json',
  retry503: 'https://fixture-cdn.test/retry-503.svg',
  oversized: 'https://fixture-cdn.test/oversized.bin',
  missing: 'https://fixture-cdn.test/missing.png',
  unauthorized: 'https://fixture-private.test/secret.png',
  local: 'http://127.0.0.1/internal',
  unsupported: 'data:text/plain,inline',
} as const;

type FixtureRoute = {
  status: number;
  body: string;
  contentType: string;
  retryAfter?: string;
  declaredLength?: number;
  finalUrl?: string;
  redirectHops?: ResourceRedirectHop[];
};

export type MultiOriginFixtureResponse = ResourceResponseSource & {
  body: ResourceBodySource | null;
  redirectHops?: readonly ResourceRedirectHop[];
};

function headers(values: Record<string, string>): MultiOriginFixtureResponse['headers'] {
  const normalized = new Map(
    Object.entries(values).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return { get: (name) => normalized.get(name.toLowerCase()) ?? null };
}

function bodySource(bytes: Uint8Array): ResourceBodySource {
  let consumed = false;
  return {
    getReader: () => ({
      read: async () => {
        if (consumed) return { done: true };
        consumed = true;
        return { done: false, value: bytes };
      },
    }),
  };
}

export class MultiOriginHttpFixture {
  readonly attempts = new Map<string, number>();
  readonly requestedUrls: string[] = [];
  readonly requestInits: RequestInit[] = [];
  private readonly requestWaiters = new Map<string, Set<() => void>>();
  private readonly requestGates = new Map<string, Promise<void>>();
  activeRequests = 0;
  peakConcurrentRequests = 0;

  hold(url: string): () => void {
    if (this.requestGates.has(url)) throw new Error(`Fixture route is already held: ${url}`);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.requestGates.set(url, gate);
    return () => {
      this.requestGates.delete(url);
      release();
    };
  }

  waitUntilRequested(url: string): Promise<void> {
    if (this.requestedUrls.includes(url)) return Promise.resolve();
    return new Promise((resolve) => {
      const waiters = this.requestWaiters.get(url) ?? new Set();
      waiters.add(resolve);
      this.requestWaiters.set(url, waiters);
    });
  }

  async fetch(url: string, init: RequestInit): Promise<MultiOriginFixtureResponse> {
    this.requestedUrls.push(url);
    this.requestInits.push(init);
    for (const waiter of this.requestWaiters.get(url) ?? []) waiter();
    this.requestWaiters.delete(url);
    const attempt = (this.attempts.get(url) ?? 0) + 1;
    this.attempts.set(url, attempt);
    this.activeRequests += 1;
    this.peakConcurrentRequests = Math.max(this.peakConcurrentRequests, this.activeRequests);

    try {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => reject(init.signal?.reason);
        init.signal?.addEventListener('abort', onAbort, { once: true });
        queueMicrotask(() => {
          init.signal?.removeEventListener('abort', onAbort);
          resolve();
        });
      });
      if (init.signal?.aborted) throw init.signal.reason;
      const gate = this.requestGates.get(url);
      if (gate) await this.waitWithAbort(gate, init.signal);

      return this.createResponse(url, attempt);
    } finally {
      this.activeRequests -= 1;
    }
  }

  private async waitWithAbort(operation: Promise<void>, signal: AbortSignal | null | undefined) {
    if (!signal) return operation;
    if (signal.aborted) throw signal.reason;
    let removeAbortListener = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () => signal.removeEventListener('abort', onAbort);
    });
    try {
      await Promise.race([operation, aborted]);
    } finally {
      removeAbortListener();
    }
  }

  private createResponse(url: string, attempt: number): MultiOriginFixtureResponse {
    const route = this.route(url, attempt);
    const bodyBytes = new TextEncoder().encode(route.body);
    return {
      url: route.finalUrl ?? url,
      redirected: route.redirectHops !== undefined,
      status: route.status,
      headers: headers({
        'content-type': route.contentType,
        'content-length': String(route.declaredLength ?? bodyBytes.byteLength),
        ...(route.retryAfter === undefined ? {} : { 'retry-after': route.retryAfter }),
      }),
      body: bodySource(bodyBytes),
      ...(route.redirectHops ? { redirectHops: route.redirectHops } : {}),
    };
  }

  private route(url: string, attempt: number): FixtureRoute {
    switch (url) {
      case MULTI_ORIGIN_URLS.primary:
        return { status: 200, body: 'HTML', contentType: 'text/html; charset=utf-8' };
      case MULTI_ORIGIN_URLS.stylesheet:
        return { status: 200, body: 'CSS', contentType: 'text/css' };
      case MULTI_ORIGIN_URLS.redirect:
        return {
          status: 200,
          body: 'JS',
          contentType: 'application/javascript',
          finalUrl: MULTI_ORIGIN_URLS.redirectFinal,
          redirectHops: [
            {
              fromUrl: MULTI_ORIGIN_URLS.redirect,
              toUrl: MULTI_ORIGIN_URLS.redirectFinal,
              httpStatus: 302,
            },
          ],
        };
      case MULTI_ORIGIN_URLS.retry429:
        return attempt === 1
          ? {
              status: 429,
              body: 'WAIT',
              contentType: 'application/json',
              retryAfter: '1',
            }
          : { status: 200, body: 'JSON', contentType: 'application/json' };
      case MULTI_ORIGIN_URLS.retry503:
        return attempt === 1
          ? { status: 503, body: 'WAIT', contentType: 'image/svg+xml' }
          : { status: 200, body: '<svg/>', contentType: 'image/svg+xml' };
      case MULTI_ORIGIN_URLS.oversized:
        return {
          status: 200,
          body: '0123456789',
          contentType: 'application/octet-stream',
          declaredLength: 10,
        };
      case MULTI_ORIGIN_URLS.missing:
        return { status: 404, body: 'NOPE', contentType: 'image/png' };
      default:
        throw new Error(`No fixture route for ${url}`);
    }
  }
}
