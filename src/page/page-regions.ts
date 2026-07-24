export const PAGE_REGION_LIMITATIONS = ['closed-shadow-roots-unobservable'] as const;

export type PageRegionLimitation = (typeof PAGE_REGION_LIMITATIONS)[number];

export type IframeRegionReason =
  'same-origin' | 'cross-origin' | 'sandboxed' | 'unavailable' | 'access-denied';

export type IframeRegionDiagnostic = {
  kind: 'iframe';
  ordinal: number;
  depth: number;
  access: 'accessible' | 'inaccessible';
  reason: IframeRegionReason;
  sourceOrigin: string | null;
};

export type ShadowRootRegionDiagnostic = {
  kind: 'shadow-root';
  ordinal: number;
  depth: number;
  access: 'accessible';
  reason: 'open-shadow-root';
};

export type PageRegionDiagnostic = IframeRegionDiagnostic | ShadowRootRegionDiagnostic;

export type PageRegionDiagnostics = {
  regions: PageRegionDiagnostic[];
  limitations: PageRegionLimitation[];
};

export type PageRegionSource = Pick<Document, 'URL'> & {
  querySelectorAll(selectors: string): NodeListOf<Element> | readonly Element[];
};

type PendingElement = {
  element: Element;
  depth: number;
};

function readOrigin(url: string, baseUrl: string): string | null {
  try {
    const origin = new URL(url, baseUrl).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

function readIframeOrigin(iframe: HTMLIFrameElement, documentUrl: string): string | null {
  if (iframe.hasAttribute('srcdoc')) return readOrigin(documentUrl, documentUrl);

  const source = iframe.getAttribute('src');
  return source === null || source.trim() === ''
    ? readOrigin(documentUrl, documentUrl)
    : readOrigin(source, documentUrl);
}

function isOpaqueSandbox(iframe: HTMLIFrameElement): boolean {
  const sandbox = iframe.getAttribute('sandbox');
  if (sandbox === null) return false;

  return !sandbox.toLowerCase().split(/\s+/).filter(Boolean).includes('allow-same-origin');
}

function inspectIframe(
  iframe: HTMLIFrameElement,
  ordinal: number,
  depth: number,
  documentUrl: string,
): IframeRegionDiagnostic {
  const sourceOrigin = readIframeOrigin(iframe, documentUrl);

  if (isOpaqueSandbox(iframe)) {
    return {
      kind: 'iframe',
      ordinal,
      depth,
      access: 'inaccessible',
      reason: 'sandboxed',
      sourceOrigin,
    };
  }

  const documentOrigin = readOrigin(documentUrl, documentUrl);
  if (sourceOrigin !== null && documentOrigin !== null && sourceOrigin !== documentOrigin) {
    return {
      kind: 'iframe',
      ordinal,
      depth,
      access: 'inaccessible',
      reason: 'cross-origin',
      sourceOrigin,
    };
  }

  try {
    if (iframe.contentDocument?.documentElement) {
      return {
        kind: 'iframe',
        ordinal,
        depth,
        access: 'accessible',
        reason: 'same-origin',
        sourceOrigin,
      };
    }
  } catch {
    return {
      kind: 'iframe',
      ordinal,
      depth,
      access: 'inaccessible',
      reason: 'access-denied',
      sourceOrigin,
    };
  }

  return {
    kind: 'iframe',
    ordinal,
    depth,
    access: 'inaccessible',
    reason: 'unavailable',
    sourceOrigin,
  };
}

function readOpenShadowRoot(element: Element): ShadowRoot | null {
  try {
    return element.shadowRoot;
  } catch {
    return null;
  }
}

export function inspectPageRegions(source: PageRegionSource): PageRegionDiagnostics {
  const regions: PageRegionDiagnostic[] = [];
  const pending: PendingElement[] = Array.from(source.querySelectorAll('*'), (element) => ({
    element,
    depth: 0,
  }));
  let iframeOrdinal = 0;
  let shadowRootOrdinal = 0;

  for (let index = 0; index < pending.length; index += 1) {
    const current = pending[index];
    if (!current) continue;

    const { element, depth } = current;
    if (element.tagName.toLowerCase() === 'iframe') {
      iframeOrdinal += 1;
      regions.push(inspectIframe(element as HTMLIFrameElement, iframeOrdinal, depth, source.URL));
    }

    const shadowRoot = readOpenShadowRoot(element);
    if (!shadowRoot) continue;

    shadowRootOrdinal += 1;
    regions.push({
      kind: 'shadow-root',
      ordinal: shadowRootOrdinal,
      depth,
      access: 'accessible',
      reason: 'open-shadow-root',
    });
    pending.push(
      ...Array.from(shadowRoot.querySelectorAll('*'), (shadowElement) => ({
        element: shadowElement,
        depth: depth + 1,
      })),
    );
  }

  return {
    regions,
    limitations: [...PAGE_REGION_LIMITATIONS],
  };
}
