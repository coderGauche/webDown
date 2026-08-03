const SENSITIVE_IDENTIFIER_WORDS = new Set([
  'auth',
  'authorization',
  'bearer',
  'credential',
  'credentials',
  'csrf',
  'nonce',
  'passcode',
  'passwd',
  'password',
  'secret',
  'signature',
  'token',
  'xsrf',
]);

const SENSITIVE_IDENTIFIER_PAIRS = [
  ['access', 'key'],
  ['api', 'key'],
  ['client', 'key'],
  ['one', 'time'],
  ['private', 'key'],
  ['secret', 'key'],
  ['session', 'id'],
] as const;

const FORM_VALUE_ATTRIBUTES = ['value', 'checked', 'selected'] as const;
const SENSITIVE_FIELD_ATTRIBUTES = ['id', 'name', 'autocomplete'] as const;
const META_DESCRIPTOR_ATTRIBUTES = ['name', 'property', 'http-equiv'] as const;

export const DOM_CLEANUP_REASONS = [
  'extension-injection',
  'tracking-runtime',
  'payment-runtime',
  'nonportable-iframe',
] as const;

export const DOM_CLEANUP_LIMITATIONS = [
  'closed-shadow-roots-unobservable',
  'canvas-bitmap-unserialized',
  'webgl-state-unserialized',
] as const;

export type DomCleanupReason = (typeof DOM_CLEANUP_REASONS)[number];
export type DomCleanupLimitation = (typeof DOM_CLEANUP_LIMITATIONS)[number];

export type DomCleanupReport = {
  removedElements: number;
  reasonCounts: Record<DomCleanupReason, number>;
  limitations: DomCleanupLimitation[];
};

const URL_ATTRIBUTES = ['src', 'href', 'data', 'action', 'formaction', 'poster'] as const;
const EXTENSION_PROTOCOLS = new Set(['chrome-extension:', 'moz-extension:']);
const TRACKING_URL_SIGNAL =
  /(?:^|[./?&=_-])(analytics?|tracking|tracker|telemetry|beacon|collect|pixel|doubleclick|tagmanager|gtm)(?:[./?&=_-]|$)/i;
const PAYMENT_URL_SIGNAL =
  /(?:^|[./?&=_-])(payment|payments|checkout|billing|stripe|paypal|adyen|braintree)(?:[./?&=_-]|$)/i;
const TRACKING_ELEMENT_TAGS = new Set(['script', 'iframe', 'img', 'embed', 'object']);
const PAYMENT_ELEMENT_TAGS = new Set(['script', 'iframe', 'embed', 'object']);

function identifierWords(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function isSensitiveFieldIdentifier(identifier: string): boolean {
  const words = identifierWords(identifier);
  if (words.some((word) => SENSITIVE_IDENTIFIER_WORDS.has(word))) return true;

  return SENSITIVE_IDENTIFIER_PAIRS.some(([first, second]) => {
    const firstIndex = words.indexOf(first);
    return firstIndex >= 0 && words.slice(firstIndex + 1).includes(second);
  });
}

function removeAttributes(element: Element, attributes: readonly string[]): void {
  for (const attribute of attributes) element.removeAttribute(attribute);
}

function clearInput(element: HTMLInputElement): void {
  element.value = '';
  element.checked = false;
  element.indeterminate = false;
  removeAttributes(element, ['value', 'checked']);
}

function clearTextarea(element: HTMLTextAreaElement): void {
  element.value = '';
  element.textContent = '';
  element.removeAttribute('value');
}

function clearSelect(element: HTMLSelectElement): void {
  element.selectedIndex = -1;
  element.removeAttribute('value');
}

function clearOption(element: HTMLOptionElement): void {
  element.selected = false;
  element.removeAttribute('selected');
}

function clearOutput(element: HTMLOutputElement): void {
  element.value = '';
  element.textContent = '';
  element.removeAttribute('value');
}

function clearButton(element: HTMLButtonElement): void {
  element.value = '';
  element.removeAttribute('value');
}

function clearFormValue(element: Element): void {
  switch (element.tagName.toLowerCase()) {
    case 'input':
      clearInput(element as HTMLInputElement);
      break;
    case 'textarea':
      clearTextarea(element as HTMLTextAreaElement);
      break;
    case 'select':
      clearSelect(element as HTMLSelectElement);
      break;
    case 'option':
      clearOption(element as HTMLOptionElement);
      break;
    case 'output':
      clearOutput(element as HTMLOutputElement);
      break;
    case 'button':
      clearButton(element as HTMLButtonElement);
      break;
  }
}

function removeSensitiveElementData(element: Element): void {
  for (const attribute of Array.from(element.attributes)) {
    if (isSensitiveFieldIdentifier(attribute.name)) element.removeAttribute(attribute.name);
  }

  const identifiesSensitiveField = SENSITIVE_FIELD_ATTRIBUTES.some((attribute) => {
    const value = element.getAttribute(attribute);
    return value !== null && isSensitiveFieldIdentifier(value);
  });
  if (identifiesSensitiveField) removeAttributes(element, FORM_VALUE_ATTRIBUTES);

  if (element.tagName.toLowerCase() === 'meta') {
    const describesSensitiveValue = META_DESCRIPTOR_ATTRIBUTES.some((attribute) => {
      const value = element.getAttribute(attribute);
      return value !== null && isSensitiveFieldIdentifier(value);
    });
    if (describesSensitiveValue) element.removeAttribute('content');
  }
}

function createDomCleanupReport(): DomCleanupReport {
  return {
    removedElements: 0,
    reasonCounts: {
      'extension-injection': 0,
      'tracking-runtime': 0,
      'payment-runtime': 0,
      'nonportable-iframe': 0,
    },
    limitations: [...DOM_CLEANUP_LIMITATIONS],
  };
}

function readElementUrls(element: Element, documentUrl: string): URL[] {
  const urls: URL[] = [];

  for (const attribute of URL_ATTRIBUTES) {
    const value = element.getAttribute(attribute)?.trim();
    if (!value) continue;

    try {
      urls.push(new URL(value, documentUrl));
    } catch {
      // Invalid URLs are left for the archive rewrite and integrity stages to report.
    }
  }

  return urls;
}

function classifyRuntimeElement(element: Element, documentUrl: string): DomCleanupReason | null {
  const tagName = element.tagName.toLowerCase();
  const urls = readElementUrls(element, documentUrl);

  if (urls.some((url) => EXTENSION_PROTOCOLS.has(url.protocol))) return 'extension-injection';
  if (
    ['script', 'style'].includes(tagName) &&
    Array.from(EXTENSION_PROTOCOLS).some((protocol) => element.textContent?.includes(protocol))
  ) {
    return 'extension-injection';
  }

  if (
    TRACKING_ELEMENT_TAGS.has(tagName) &&
    urls.some((url) => TRACKING_URL_SIGNAL.test(url.href))
  ) {
    return 'tracking-runtime';
  }
  if (PAYMENT_ELEMENT_TAGS.has(tagName) && urls.some((url) => PAYMENT_URL_SIGNAL.test(url.href))) {
    return 'payment-runtime';
  }
  if (tagName === 'iframe' && !element.hasAttribute('srcdoc')) return 'nonportable-iframe';

  return null;
}

export function sanitizeClonedDom(root: Element, documentUrl = 'about:blank'): DomCleanupReport {
  const report = createDomCleanupReport();
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];

  for (const element of elements) {
    const removalReason = classifyRuntimeElement(element, documentUrl);
    if (removalReason) {
      element.remove();
      report.removedElements += 1;
      report.reasonCounts[removalReason] += 1;
      continue;
    }

    clearFormValue(element);
    removeSensitiveElementData(element);
  }

  return report;
}
