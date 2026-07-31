import { SiteCapsuleError, createCaptureError } from '@sitecapsule/domain';
import { decodeArchiveTransferBase64 } from '@sitecapsule/messaging/archive-transfer';
import { createCaptureArchiveChunkGetRequest } from '@sitecapsule/messaging/protocol';
import { isCaptureArchiveChunkResponse } from '@sitecapsule/messaging/validators';

export type ArchiveChunkRequestSender = (request: unknown) => Promise<unknown>;

export async function readCaptureArchiveBytes(
  jobId: string,
  expectedByteLength: number,
  send: ArchiveChunkRequestSender,
): Promise<Uint8Array> {
  if (typeof jobId !== 'string' || jobId.trim() === '') {
    throw new TypeError('Archive job ID must be a non-empty string.');
  }
  if (!Number.isSafeInteger(expectedByteLength) || expectedByteLength <= 0) {
    throw new RangeError('Archive byte length must be a positive safe integer.');
  }
  if (typeof send !== 'function') throw new TypeError('Archive chunk sender must be a function.');

  const archive = new Uint8Array(expectedByteLength);
  let offset = 0;
  while (offset < expectedByteLength) {
    const response = await send(createCaptureArchiveChunkGetRequest(jobId, offset));
    if (!isCaptureArchiveChunkResponse(response)) {
      throw new SiteCapsuleError(
        createCaptureError('protocol-invalid-message', { operation: 'archive-download' }),
      );
    }
    if (!response.payload.ok) throw new SiteCapsuleError(response.payload.error);
    if (
      response.payload.jobId !== jobId ||
      response.payload.offset !== offset ||
      response.payload.totalByteLength !== expectedByteLength
    ) {
      throw new SiteCapsuleError(
        createCaptureError('protocol-invalid-message', { operation: 'archive-download' }),
      );
    }

    const chunk = decodeArchiveTransferBase64(response.payload.base64);
    if (chunk.byteLength === 0 || offset + chunk.byteLength > expectedByteLength) {
      throw new SiteCapsuleError(
        createCaptureError('protocol-invalid-message', { operation: 'archive-download' }),
      );
    }
    archive.set(chunk, offset);
    offset += chunk.byteLength;
    if (response.payload.done !== (offset === expectedByteLength)) {
      throw new SiteCapsuleError(
        createCaptureError('protocol-invalid-message', { operation: 'archive-download' }),
      );
    }
  }
  return archive;
}
