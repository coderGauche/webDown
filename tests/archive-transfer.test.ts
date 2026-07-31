import { createCaptureError } from '@sitecapsule/domain';
import {
  ARCHIVE_TRANSFER_CHUNK_BYTE_LENGTH,
  createArchiveTransferChunk,
  decodeArchiveTransferBase64,
  encodeArchiveTransferBytes,
} from '@sitecapsule/messaging/archive-transfer';
import {
  createCaptureArchiveChunkError,
  createCaptureArchiveChunkResponse,
} from '@sitecapsule/messaging/protocol';
import { isCaptureArchiveChunkGetRequest } from '@sitecapsule/messaging/validators';
import { readCaptureArchiveBytes } from '@sitecapsule/ui';
import { describe, expect, it, vi } from 'vitest';

describe('archive transfer', () => {
  it('round-trips arbitrary bytes through canonical base64', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    expect(decodeArchiveTransferBase64(encodeArchiveTransferBytes(bytes))).toEqual(bytes);
    expect(() => decodeArchiveTransferBase64('not canonical')).toThrow(/base64/i);
  });

  it('reads a multi-chunk artifact in strict offset order', async () => {
    const bytes = new Uint8Array(ARCHIVE_TRANSFER_CHUNK_BYTE_LENGTH + 17);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
    const sender = vi.fn(async (request: unknown) => {
      expect(isCaptureArchiveChunkGetRequest(request)).toBe(true);
      if (!isCaptureArchiveChunkGetRequest(request)) throw new Error('invalid request');
      return createCaptureArchiveChunkResponse({
        jobId: request.payload.jobId,
        ...createArchiveTransferChunk(bytes, request.payload.offset),
      });
    });

    await expect(readCaptureArchiveBytes('job-1', bytes.byteLength, sender)).resolves.toEqual(
      bytes,
    );
    expect(sender).toHaveBeenCalledTimes(2);
  });

  it('propagates structured artifact errors', async () => {
    await expect(
      readCaptureArchiveBytes('job-1', 3, async () =>
        createCaptureArchiveChunkError(
          createCaptureError('archive-download-failed', { operation: 'archive-download' }),
        ),
      ),
    ).rejects.toMatchObject({ details: { code: 'archive-download-failed' } });
  });

  it('rejects inconsistent offsets, totals, completion flags, and malformed responses', async () => {
    const valid = createCaptureArchiveChunkResponse({
      jobId: 'job-1',
      offset: 0,
      totalByteLength: 3,
      base64: encodeArchiveTransferBytes(new Uint8Array([1, 2, 3])),
      done: true,
    });
    const invalid = [
      { ...valid, payload: { ...valid.payload, offset: 1 } },
      { ...valid, payload: { ...valid.payload, totalByteLength: 4 } },
      { ...valid, payload: { ...valid.payload, done: false } },
      { unexpected: true },
    ];
    for (const response of invalid) {
      await expect(readCaptureArchiveBytes('job-1', 3, async () => response)).rejects.toMatchObject(
        { details: { code: 'protocol-invalid-message' } },
      );
    }
  });
});
