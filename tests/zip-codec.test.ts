import {
  ZIP_DEFAULT_COMPRESSION_LEVEL,
  ZipCodecError,
  createZipArchiveSync,
  extractZipArchiveSync,
  type ZipArchiveEntry,
} from '@sitecapsule/archive';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function textEntry(path: string, value: string): ZipArchiveEntry {
  return { path, bytes: encoder.encode(value) };
}

describe('fflate ZIP codec', () => {
  it('creates and reads an empty ZIP archive', () => {
    const archive = createZipArchiveSync([]);

    expect(archive).toBeInstanceOf(Uint8Array);
    expect(extractZipArchiveSync(archive)).toEqual([]);
  });

  it('round-trips nested, Unicode, empty, and arbitrary binary entries', () => {
    const archive = createZipArchiveSync([
      textEntry('pages/你好.txt', '离线页面'),
      { path: 'assets/binary.dat', bytes: new Uint8Array([0, 255, 1, 128, 0]) },
      { path: 'empty.txt', bytes: new Uint8Array() },
    ]);
    const entries = extractZipArchiveSync(archive);

    expect(entries.map((entry) => entry.path)).toEqual([
      'assets/binary.dat',
      'empty.txt',
      'pages/你好.txt',
    ]);
    expect(Array.from(entries[0]?.bytes ?? [])).toEqual([0, 255, 1, 128, 0]);
    expect(entries[1]?.bytes).toHaveLength(0);
    expect(decoder.decode(entries[2]?.bytes)).toBe('离线页面');
  });

  it('produces identical bytes for repeated calls and different input orders', () => {
    const entries = [
      textEntry('z-last.txt', 'last'),
      textEntry('a-first.txt', 'first'),
      textEntry('nested/middle.txt', 'middle'),
    ];
    const first = createZipArchiveSync(entries);
    const repeated = createZipArchiveSync(entries);
    const reversed = createZipArchiveSync([...entries].reverse());

    expect(first).toEqual(repeated);
    expect(first).toEqual(reversed);
    expect(Array.from(first.slice(10, 14))).toEqual([0, 0, 33, 0]);
  });

  it('copies entry bytes and does not reorder the caller array', () => {
    const sourceBytes = encoder.encode('stable');
    const entries = [{ path: 'z.txt', bytes: sourceBytes }, textEntry('a.txt', 'first')];
    const originalOrder = entries.map((entry) => entry.path);
    const archive = createZipArchiveSync(entries);

    sourceBytes.fill(0);
    expect(entries.map((entry) => entry.path)).toEqual(originalOrder);
    expect(decoder.decode(extractZipArchiveSync(archive)[1]?.bytes)).toBe('stable');
  });

  it('supports every valid compression level and defaults to level six', () => {
    const repetitive = new Uint8Array(4_096).fill(65);
    const stored = createZipArchiveSync([{ path: 'repeat.bin', bytes: repetitive }], {
      compressionLevel: 0,
    });
    const defaultCompressed = createZipArchiveSync([{ path: 'repeat.bin', bytes: repetitive }]);

    expect(ZIP_DEFAULT_COMPRESSION_LEVEL).toBe(6);
    expect(defaultCompressed.byteLength).toBeLessThan(stored.byteLength);
    for (let level = 0; level <= 9; level += 1) {
      expect(
        createZipArchiveSync([{ path: 'file.txt', bytes: new Uint8Array() }], {
          compressionLevel: level as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
        }),
      ).toBeInstanceOf(Uint8Array);
    }
  });

  it('rejects unsafe, duplicate, and malformed entry input before encoding', () => {
    expect(() => createZipArchiveSync([textEntry('../escape.txt', 'x')])).toThrow(TypeError);
    expect(() =>
      createZipArchiveSync([textEntry('same.txt', 'first'), textEntry('same.txt', 'second')]),
    ).toThrow('Duplicate ZIP entry path: same.txt');
    expect(() =>
      createZipArchiveSync([textEntry('file.txt', 'x')], { compressionLevel: 10 as never }),
    ).toThrow(RangeError);
    expect(() => createZipArchiveSync(null as never)).toThrow(TypeError);
  });

  it('wraps corrupt and unsafe decoded archives with an operation-specific error', () => {
    expect(() => extractZipArchiveSync(new Uint8Array([1, 2, 3]))).toThrowError(
      expect.objectContaining({ name: 'ZipCodecError', operation: 'decode' }),
    );

    const unsafeArchive = zipSync(
      { '../escape.txt': encoder.encode('unsafe') },
      { mtime: new Date(1980, 0, 1) },
    );
    try {
      extractZipArchiveSync(unsafeArchive);
      throw new Error('Expected unsafe ZIP extraction to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(ZipCodecError);
      expect(error).toMatchObject({ operation: 'decode' });
      expect((error as ZipCodecError).cause).toBeInstanceOf(TypeError);
    }
  });
});
