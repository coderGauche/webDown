import { serializeDocument } from '@sitecapsule/page';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';

const sensitiveValues = [
  'unit-static-password-6f27',
  'unit-runtime-password-e331',
  'unit-static-token-730d',
  'unit-runtime-token-917c',
  'unit-static-email@example.test',
  'unit-runtime-email@example.test',
  'unit-static-note-b158',
  'unit-runtime-note-32c0',
  'unit-static-output-4ea3',
  'unit-runtime-output-d52f',
  'unit-static-button-72db',
  'unit-runtime-button-a0d8',
  'unit-meta-secret-57c4',
  'unit-data-secret-008e',
] as const;

function requireElement<T>(document: Window['document'], selector: string): T {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Missing fixture element: ${selector}`);
  return element as unknown as T;
}

describe('sensitive form archive boundary', () => {
  it('removes static attributes and live form properties while preserving structure', () => {
    const window = new Window();
    const document = window.document;
    document.write(`<!doctype html>
      <html><head><meta name="csrf-token" content="unit-meta-secret-57c4"></head><body>
        <main data-access-token="unit-data-secret-008e">
          <form id="profile-form">
            <label for="password">Password</label>
            <input id="password" name="password" type="password" value="unit-static-password-6f27">
            <input id="csrf" name="csrf_token" type="hidden" value="unit-static-token-730d">
            <input id="email" name="email" type="email" placeholder="name@example.test" value="unit-static-email@example.test">
            <textarea id="note" name="note">unit-static-note-b158</textarea>
            <input id="remember" name="remember" type="checkbox" checked>
            <select id="region" name="region"><option value="north">North</option><option value="south" selected>South</option></select>
            <output id="result" value="unit-static-output-4ea3">unit-static-output-4ea3</output>
            <button id="continue" value="unit-static-button-72db">Continue</button>
          </form>
        </main>
      </body></html>`);

    const password = requireElement<HTMLInputElement>(document, '#password');
    password.value = 'unit-runtime-password-e331';
    requireElement<HTMLInputElement>(document, '#csrf').value = 'unit-runtime-token-917c';
    requireElement<HTMLInputElement>(document, '#email').value = 'unit-runtime-email@example.test';
    requireElement<HTMLTextAreaElement>(document, '#note').value = 'unit-runtime-note-32c0';
    requireElement<HTMLInputElement>(document, '#remember').checked = true;
    requireElement<HTMLSelectElement>(document, '#region').selectedIndex = 1;
    requireElement<HTMLOutputElement>(document, '#result').value = 'unit-runtime-output-d52f';
    requireElement<HTMLButtonElement>(document, '#continue').value = 'unit-runtime-button-a0d8';

    const html = serializeDocument(document as unknown as Parameters<typeof serializeDocument>[0]);

    for (const value of sensitiveValues) expect(html).not.toContain(value);
    expect(html).toContain('id="profile-form"');
    expect(html).toContain('name="password"');
    expect(html).toContain('name="csrf_token"');
    expect(html).toContain('placeholder="name@example.test"');
    expect(html).toContain('<option value="north">North</option>');
    expect(html).toContain('<option value="south">South</option>');
    expect(html).toContain('>Continue</button>');
    expect(html).not.toMatch(/\s(?:checked|selected)(?:\s|=|>)/i);
    expect(document.querySelector('[data-access-token]')).not.toBeNull();
    expect(password.value).toBe('unit-runtime-password-e331');
  });
});
