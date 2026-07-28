import { RESOURCE_TYPES, type ResourceType } from '@sitecapsule/domain';
import {
  PORTABLE_FILE_NAME_MAX_BYTES,
  RESOURCE_TYPE_FALLBACK_FILE_NAMES,
  createResourceFileName,
  sanitizeArchiveFileName,
} from '@sitecapsule/archive';
import { describe, expect, it } from 'vitest';

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

describe('portable archive file names', () => {
  it('replaces control characters and characters forbidden by Windows file systems', () => {
    expect(sanitizeArchiveFileName('report\u0000<>:"/\\|?*\u007f.txt')).toBe('report_.txt');
  });

  it('removes leading spaces and trailing spaces or dots', () => {
    expect(sanitizeArchiveFileName('  quarterly report...   ')).toBe('quarterly report');
  });

  it.each(['', '.', '..', '   ', '...'])('uses a stable fallback for empty name %j', (value) => {
    expect(sanitizeArchiveFileName(value, 'download.bin')).toBe('download.bin');
  });

  it('sanitizes the fallback with the same portable rules', () => {
    expect(sanitizeArchiveFileName('', ' bad/name?.bin. ')).toBe('bad_name_.bin');
    expect(sanitizeArchiveFileName('', '...')).toBe('resource');
  });

  it.each([
    ['CON', '_CON'],
    ['con.txt', '_con.txt'],
    ['PRN .log', '_PRN .log'],
    ['AUX', '_AUX'],
    ['NUL.json', '_NUL.json'],
    ['COM1', '_COM1'],
    ['com9.js', '_com9.js'],
    ['COM¹.log', '_COM¹.log'],
    ['LPT1.css', '_LPT1.css'],
    ['lpt9', '_lpt9'],
    ['LPT³.txt', '_LPT³.txt'],
    ['CLOCK$', '_CLOCK$'],
    ['CONIN$.txt', '_CONIN$.txt'],
    ['CONOUT$', '_CONOUT$'],
  ])('protects Windows device name %s', (value, expected) => {
    expect(sanitizeArchiveFileName(value)).toBe(expected);
  });

  it('does not rewrite ordinary names containing reserved-name prefixes', () => {
    expect(sanitizeArchiveFileName('console.txt')).toBe('console.txt');
    expect(sanitizeArchiveFileName('com10.js')).toBe('com10.js');
  });

  it('normalizes canonically equivalent Unicode names without removing Unicode', () => {
    const decomposed = sanitizeArchiveFileName('Cafe\u0301-页面.png');
    const composed = sanitizeArchiveFileName('Café-页面.png');

    expect(decomposed).toBe(composed);
    expect(composed).toBe('Café-页面.png');
  });

  it('replaces lone UTF-16 surrogates without damaging valid emoji', () => {
    expect(sanitizeArchiveFileName(`icon-😀-\ud800.png`)).toBe('icon-😀-\uFFFD.png');
  });

  it('limits names by UTF-8 bytes and preserves a normal extension', () => {
    const result = sanitizeArchiveFileName(`${'界'.repeat(100)}.woff2`);

    expect(byteLength(result)).toBeLessThanOrEqual(PORTABLE_FILE_NAME_MAX_BYTES);
    expect(result.endsWith('.woff2')).toBe(true);
    expect(result).not.toContain('�');
  });

  it('truncates deterministically without treating an excessive suffix as an extension', () => {
    const input = `asset.${'x'.repeat(300)}`;
    const first = sanitizeArchiveFileName(input);

    expect(byteLength(first)).toBe(PORTABLE_FILE_NAME_MAX_BYTES);
    expect(first).toBe(sanitizeArchiveFileName(input));
  });

  it('decodes and sanitizes the URL path leaf while ignoring query and fragment', () => {
    expect(
      createResourceFileName(
        'https://example.test/assets/My%20Report%3Ffinal.pdf?version=2#page',
        'document',
      ),
    ).toBe('My Report_final.pdf');
  });

  it('keeps the URL leaf independent from query ordering and values', () => {
    expect(createResourceFileName('https://example.test/app.js?v=1', 'script')).toBe(
      createResourceFileName('https://example.test/app.js?theme=dark&v=2', 'script'),
    );
  });

  it('keeps malformed percent escapes as deterministic literal text', () => {
    expect(createResourceFileName('https://example.test/%E0%A4%A', 'other')).toBe('%E0%A4%A');
  });

  it.each(Object.entries(RESOURCE_TYPE_FALLBACK_FILE_NAMES) as [ResourceType, string][])(
    'uses %s fallback name %s for directory URLs',
    (resourceType, expected) => {
      expect(createResourceFileName('https://example.test/assets/', resourceType)).toBe(expected);
    },
  );

  it('rejects unsupported URLs and resource types', () => {
    expect(RESOURCE_TYPES).toHaveLength(13);
    expect(() => createResourceFileName('data:text/plain,hello', 'data')).toThrow('HTTP and HTTPS');
    expect(() =>
      createResourceFileName('https://example.test/file', 'binary' as ResourceType),
    ).toThrow('Resource type is not supported');
  });
});
