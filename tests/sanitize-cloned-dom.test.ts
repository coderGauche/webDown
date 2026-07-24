import {
  isSensitiveFieldIdentifier,
  sanitizeClonedDom,
  serializeDocument,
} from '@sitecapsule/page';
import { describe, expect, it, vi } from 'vitest';

class ElementFixture {
  checked = false;
  indeterminate = false;
  selected = false;
  selectedIndex = 0;
  textContent: string | null = null;
  value = '';

  readonly #attributes = new Map<string, string>();
  readonly #descendants: ElementFixture[];

  constructor(
    readonly tagName: string,
    attributes: Record<string, string> = {},
    descendants: ElementFixture[] = [],
  ) {
    this.#attributes = new Map(Object.entries(attributes));
    this.#descendants = descendants;
    this.value = attributes.value ?? '';
    this.checked = 'checked' in attributes;
    this.selected = 'selected' in attributes;
  }

  get attributes(): Array<{ name: string }> {
    return Array.from(this.#attributes.keys(), (name) => ({ name }));
  }

  get outerHTML(): string {
    return `<${this.tagName.toLowerCase()}>fixture</${this.tagName.toLowerCase()}>`;
  }

  getAttribute(name: string): string | null {
    return this.#attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.#attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.#attributes.delete(name);
  }

  querySelectorAll(selector: string): ElementFixture[] {
    if (selector !== '*') throw new Error(`Unexpected selector: ${selector}`);
    return this.#descendants.flatMap((element) => [element, ...element.querySelectorAll('*')]);
  }
}

function asElement(fixture: ElementFixture): Element {
  return fixture as unknown as Element;
}

describe('cloned DOM sanitization', () => {
  it('clears password, hidden token, and ordinary input state while preserving structure', () => {
    const password = new ElementFixture('INPUT', {
      type: 'password',
      name: 'password',
      value: 'correct-horse-battery-staple',
    });
    const token = new ElementFixture('INPUT', {
      type: 'hidden',
      name: 'csrf_token',
      value: 'csrf-secret',
    });
    const ordinary = new ElementFixture('INPUT', {
      type: 'email',
      name: 'contact',
      placeholder: 'name@example.com',
      value: 'person@example.com',
      checked: '',
    });
    const root = new ElementFixture('HTML', {}, [password, token, ordinary]);

    sanitizeClonedDom(asElement(root));

    for (const input of [password, token, ordinary]) {
      expect(input.value).toBe('');
      expect(input.checked).toBe(false);
      expect(input.indeterminate).toBe(false);
      expect(input.hasAttribute('value')).toBe(false);
      expect(input.hasAttribute('checked')).toBe(false);
    }
    expect(password.getAttribute('name')).toBe('password');
    expect(token.getAttribute('name')).toBe('csrf_token');
    expect(ordinary.getAttribute('placeholder')).toBe('name@example.com');
  });

  it('clears text, selection, output, and button values without deleting option definitions', () => {
    const textarea = new ElementFixture('TEXTAREA', { name: 'notes', value: 'draft' });
    textarea.textContent = 'private draft';
    const option = new ElementFixture('OPTION', { value: 'standard', selected: '' });
    option.textContent = 'Standard plan';
    const select = new ElementFixture('SELECT', { name: 'plan', value: 'standard' }, [option]);
    const output = new ElementFixture('OUTPUT', { value: 'account total' });
    output.textContent = 'account total';
    const button = new ElementFixture('BUTTON', { value: 'private command' });
    button.textContent = 'Continue';
    const root = new ElementFixture('HTML', {}, [textarea, select, output, button]);

    sanitizeClonedDom(asElement(root));

    expect(textarea.value).toBe('');
    expect(textarea.textContent).toBe('');
    expect(select.selectedIndex).toBe(-1);
    expect(select.hasAttribute('value')).toBe(false);
    expect(option.selected).toBe(false);
    expect(option.hasAttribute('selected')).toBe(false);
    expect(option.getAttribute('value')).toBe('standard');
    expect(option.textContent).toBe('Standard plan');
    expect(output.value).toBe('');
    expect(output.textContent).toBe('');
    expect(button.hasAttribute('value')).toBe(false);
    expect(button.textContent).toBe('Continue');
  });

  it('removes common token attributes and sensitive meta/custom field values', () => {
    const dataToken = new ElementFixture('DIV', {
      class: 'account-panel',
      'data-access-token': 'access-secret',
      'data-tokenizer': 'visual-component',
    });
    const csrfMeta = new ElementFixture('META', {
      name: 'csrf-token',
      content: 'csrf-secret',
    });
    const customField = new ElementFixture('SECURE-INPUT', {
      id: 'clientSecret',
      value: 'client-secret',
      title: 'API configuration',
    });
    const root = new ElementFixture('HTML', {}, [dataToken, csrfMeta, customField]);

    sanitizeClonedDom(asElement(root));

    expect(dataToken.hasAttribute('data-access-token')).toBe(false);
    expect(dataToken.getAttribute('data-tokenizer')).toBe('visual-component');
    expect(dataToken.getAttribute('class')).toBe('account-panel');
    expect(csrfMeta.hasAttribute('content')).toBe(false);
    expect(csrfMeta.getAttribute('name')).toBe('csrf-token');
    expect(customField.hasAttribute('value')).toBe(false);
    expect(customField.getAttribute('id')).toBe('clientSecret');
    expect(customField.getAttribute('title')).toBe('API configuration');
  });

  it.each([
    'password',
    'csrf_token',
    'authToken',
    'data-api-key',
    'clientSecret',
    'one-time-code',
    'session_id',
  ])('recognizes the sensitive identifier %s', (identifier) => {
    expect(isSensitiveFieldIdentifier(identifier)).toBe(true);
  });

  it.each(['contact', 'tokenizer', 'monkey', 'keyboard-layout', 'session-title'])(
    'does not classify the structural identifier %s as sensitive',
    (identifier) => {
      expect(isSensitiveFieldIdentifier(identifier)).toBe(false);
    },
  );

  it('sanitizes only the deep clone used for serialization', () => {
    const liveInput = new ElementFixture('INPUT', { name: 'password', value: 'live-secret' });
    const clonedInput = new ElementFixture('INPUT', { name: 'password', value: 'cloned-secret' });
    const clonedRoot = new ElementFixture('HTML', {}, [clonedInput]);
    const cloneNode = vi.fn(() => asElement(clonedRoot));

    serializeDocument({
      doctype: null,
      documentElement: { cloneNode },
    });

    expect(cloneNode).toHaveBeenCalledWith(true);
    expect(clonedInput.value).toBe('');
    expect(clonedInput.hasAttribute('value')).toBe(false);
    expect(liveInput.value).toBe('live-secret');
    expect(liveInput.getAttribute('value')).toBe('live-secret');
  });
});
