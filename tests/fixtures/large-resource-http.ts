import type { ResourceBodySource, ResourceResponseSource } from '@sitecapsule/download';

export const LARGE_RESOURCE_CHUNK_BYTES = 64 * 1024;

export type LargeResourceRoute = {
  url: string;
  byteLength: number;
  declaredByteLength: number | null;
  seed: number;
};

export type LargeResourceFixtureResponse = ResourceResponseSource & {
  body: ResourceBodySource;
};

export type LargeResourceFixtureSnapshot = {
  requestedUrls: string[];
  openedReaderUrls: string[];
  cancelledReaderUrls: string[];
  chunksProduced: number;
  bytesProduced: number;
  activeChunkBytes: number;
  peakActiveChunkBytes: number;
};

function assertRoute(route: LargeResourceRoute): void {
  if (!URL.canParse(route.url)) throw new TypeError('Large resource route URL must be valid.');
  if (!Number.isSafeInteger(route.byteLength) || route.byteLength < 0) {
    throw new RangeError('Large resource byte length must be a non-negative safe integer.');
  }
  if (
    route.declaredByteLength !== null &&
    (!Number.isSafeInteger(route.declaredByteLength) || route.declaredByteLength < 0)
  ) {
    throw new RangeError('Declared byte length must be null or a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(route.seed) || route.seed < 0 || route.seed > 250) {
    throw new RangeError('Large resource seed must be a safe integer from 0 through 250.');
  }
}

function headers(declaredByteLength: number | null): LargeResourceFixtureResponse['headers'] {
  return {
    get: (name) =>
      name.toLowerCase() === 'content-length' && declaredByteLength !== null
        ? String(declaredByteLength)
        : name.toLowerCase() === 'content-type'
          ? 'application/octet-stream'
          : null,
  };
}

export class LargeResourceHttpFixture {
  readonly requestedUrls: string[] = [];
  readonly openedReaderUrls: string[] = [];
  readonly cancelledReaderUrls: string[] = [];
  chunksProduced = 0;
  bytesProduced = 0;
  activeChunkBytes = 0;
  peakActiveChunkBytes = 0;

  readonly #routes: Map<string, LargeResourceRoute>;
  readonly #outstandingChunks = new Map<Uint8Array, number>();

  constructor(routes: readonly LargeResourceRoute[]) {
    this.#routes = new Map();
    for (const route of routes) {
      assertRoute(route);
      if (this.#routes.has(route.url)) throw new Error(`Duplicate large fixture URL: ${route.url}`);
      this.#routes.set(route.url, { ...route });
    }
  }

  fetch(url: string): LargeResourceFixtureResponse {
    const route = this.#routes.get(url);
    if (!route) throw new Error(`No large fixture route for ${url}`);
    this.requestedUrls.push(url);
    return {
      url,
      redirected: false,
      status: 200,
      headers: headers(route.declaredByteLength),
      body: this.#body(route),
    };
  }

  releaseChunk(chunk: Uint8Array): void {
    const byteLength = this.#outstandingChunks.get(chunk);
    if (byteLength === undefined) throw new Error('Large fixture chunk was released twice.');
    this.#outstandingChunks.delete(chunk);
    this.activeChunkBytes -= byteLength;
  }

  snapshot(): LargeResourceFixtureSnapshot {
    return {
      requestedUrls: [...this.requestedUrls],
      openedReaderUrls: [...this.openedReaderUrls],
      cancelledReaderUrls: [...this.cancelledReaderUrls],
      chunksProduced: this.chunksProduced,
      bytesProduced: this.bytesProduced,
      activeChunkBytes: this.activeChunkBytes,
      peakActiveChunkBytes: this.peakActiveChunkBytes,
    };
  }

  #body(route: LargeResourceRoute): ResourceBodySource {
    return {
      getReader: () => {
        this.openedReaderUrls.push(route.url);
        let offset = 0;
        let cancelled = false;
        const readerChunks = new Set<Uint8Array>();
        return {
          read: async () => {
            if (cancelled || offset >= route.byteLength) return { done: true };
            const byteLength = Math.min(LARGE_RESOURCE_CHUNK_BYTES, route.byteLength - offset);
            const chunk = new Uint8Array(byteLength);
            for (let index = 0; index < byteLength; index += 1) {
              chunk[index] = (route.seed + offset + index) % 251;
            }
            offset += byteLength;
            readerChunks.add(chunk);
            this.#outstandingChunks.set(chunk, byteLength);
            this.chunksProduced += 1;
            this.bytesProduced += byteLength;
            this.activeChunkBytes += byteLength;
            this.peakActiveChunkBytes = Math.max(this.peakActiveChunkBytes, this.activeChunkBytes);
            return { done: false, value: chunk };
          },
          cancel: () => {
            if (cancelled) return;
            cancelled = true;
            this.cancelledReaderUrls.push(route.url);
            for (const chunk of readerChunks) {
              if (this.#outstandingChunks.has(chunk)) this.releaseChunk(chunk);
            }
          },
        };
      },
    };
  }
}
