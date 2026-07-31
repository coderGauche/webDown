import type { ResourceRedirectHop } from '@sitecapsule/domain';
import type { ResourceBodySource, ResourceResponseSource } from '@sitecapsule/download';

export const MEDIA_CDN_URLS = {
  page: 'https://fixture-main.test/showcase/index.html',
  theme: 'https://fixture-cdn.test/styles/theme.css',
  font: 'https://fixture-cdn.test/fonts/display.woff2',
  hero: 'https://fixture-cdn.test/images/hero.avif',
  poster: 'https://fixture-edge.test/posters/intro.jpg',
  posterFinal: 'https://fixture-media.test/posters/intro.webp',
  videoMp4: 'https://fixture-media.test/video/intro.mp4',
  videoWebm: 'https://fixture-media.test/video/intro.webm',
  captions: 'https://fixture-media.test/captions/en.vtt',
  audio: 'https://fixture-media.test/audio/theme.mp3',
  privateImage: 'https://fixture-private.test/images/teaser.jpg',
  missingImage: 'https://fixture-cdn.test/images/missing.png',
} as const;

type FixtureRoute = {
  status: number;
  body: string;
  contentType: string;
  finalUrl?: string;
  redirectHops?: ResourceRedirectHop[];
};

export type MediaCdnFixtureResponse = ResourceResponseSource & {
  body: ResourceBodySource | null;
  redirectHops?: readonly ResourceRedirectHop[];
};

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

function routeFor(url: string): FixtureRoute {
  switch (url) {
    case MEDIA_CDN_URLS.page:
      return { status: 200, body: '<!doctype html>', contentType: 'text/html; charset=utf-8' };
    case MEDIA_CDN_URLS.theme:
      return { status: 200, body: '.fixture{}', contentType: 'text/css' };
    case MEDIA_CDN_URLS.font:
      return { status: 200, body: 'WOFF2', contentType: 'font/woff2' };
    case MEDIA_CDN_URLS.hero:
      return { status: 200, body: 'AVIF', contentType: 'image/avif' };
    case MEDIA_CDN_URLS.poster:
      return {
        status: 200,
        body: 'WEBP',
        contentType: 'image/webp',
        finalUrl: MEDIA_CDN_URLS.posterFinal,
        redirectHops: [
          {
            fromUrl: MEDIA_CDN_URLS.poster,
            toUrl: MEDIA_CDN_URLS.posterFinal,
            httpStatus: 302,
          },
        ],
      };
    case MEDIA_CDN_URLS.videoMp4:
      return { status: 200, body: 'MP4', contentType: 'video/mp4' };
    case MEDIA_CDN_URLS.videoWebm:
      return { status: 200, body: 'WEBM', contentType: 'video/webm' };
    case MEDIA_CDN_URLS.captions:
      return { status: 200, body: 'WEBVTT', contentType: 'text/vtt' };
    case MEDIA_CDN_URLS.audio:
      return { status: 200, body: 'MP3', contentType: 'audio/mpeg' };
    case MEDIA_CDN_URLS.missingImage:
      return { status: 404, body: 'NOT FOUND', contentType: 'image/png' };
    default:
      throw new Error(`No media/CDN fixture route for ${url}`);
  }
}

export class MediaCdnHttpFixture {
  readonly requestedUrls: string[] = [];

  async fetch(url: string, init: RequestInit): Promise<MediaCdnFixtureResponse> {
    if (init.signal?.aborted) throw init.signal.reason;
    this.requestedUrls.push(url);
    const route = routeFor(url);
    const bytes = new TextEncoder().encode(route.body);
    const headerValues = new Map([
      ['content-type', route.contentType],
      ['content-length', String(bytes.byteLength)],
    ]);

    return {
      url: route.finalUrl ?? url,
      redirected: route.redirectHops !== undefined,
      status: route.status,
      headers: { get: (name) => headerValues.get(name.toLowerCase()) ?? null },
      body: bodySource(bytes),
      ...(route.redirectHops ? { redirectHops: route.redirectHops } : {}),
    };
  }
}
