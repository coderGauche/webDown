export const ARCHIVE_TRANSFER_CHUNK_BYTE_LENGTH = 192 * 1024;

export type ArchiveTransferChunk = {
  offset: number;
  totalByteLength: number;
  base64: string;
  done: boolean;
};

function requireBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new TypeError('Archive transfer requires a non-empty Uint8Array.');
  }
  return value;
}

function requireOffset(value: unknown, totalByteLength: number): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) >= totalByteLength
  ) {
    throw new RangeError('Archive transfer offset is outside the artifact.');
  }
  return value as number;
}

export function encodeArchiveTransferBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index] as number);
  }
  return btoa(binary);
}

export function decodeArchiveTransferBase64(value: string): Uint8Array {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new TypeError('Archive transfer chunk is not canonical base64.');
  }

  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new TypeError('Archive transfer chunk is not valid base64.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (encodeArchiveTransferBytes(bytes) !== value) {
    throw new TypeError('Archive transfer chunk is not canonical base64.');
  }
  return bytes;
}

export function createArchiveTransferChunk(
  value: Uint8Array,
  requestedOffset: number,
): ArchiveTransferChunk {
  const bytes = requireBytes(value);
  const offset = requireOffset(requestedOffset, bytes.byteLength);
  const end = Math.min(offset + ARCHIVE_TRANSFER_CHUNK_BYTE_LENGTH, bytes.byteLength);
  return {
    offset,
    totalByteLength: bytes.byteLength,
    base64: encodeArchiveTransferBytes(bytes.subarray(offset, end)),
    done: end === bytes.byteLength,
  };
}
