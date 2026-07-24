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

export function sanitizeClonedDom(root: Element): void {
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];

  for (const element of elements) {
    clearFormValue(element);
    removeSensitiveElementData(element);
  }
}
