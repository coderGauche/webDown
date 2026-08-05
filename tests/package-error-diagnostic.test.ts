import { classifyArchivePackageError } from '@sitecapsule/archive';
import { describe, expect, it } from 'vitest';

describe('archive package error diagnostics', () => {
  it.each([
    [new TypeError('Resource record MIME type is invalid.'), 'TypeError.MimeType'],
    [new Error('Archive integrity bytes are missing.'), 'Error.Integrity'],
    [new RangeError('Resource byte length is invalid.'), 'RangeError.ByteLength'],
    [new TypeError('Private token=secret'), 'TypeError.Unknown'],
    ['private failure', 'Error.Unknown'],
  ])('returns a protocol-safe category without leaking exception content', (error, expected) => {
    const diagnostic = classifyArchivePackageError(error);

    expect(diagnostic).toBe(expected);
    expect(diagnostic).toMatch(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/);
    expect(diagnostic).not.toContain('secret');
  });
});
