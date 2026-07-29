export const SHA_256_HEX_LENGTH = 64;

function bytesToHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createArchiveSha256Hex(bytes: Uint8Array): Promise<string> {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('Archive SHA-256 input must be a Uint8Array.');
  }
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable.');

  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  const hex = bytesToHex(digest);
  if (hex.length !== SHA_256_HEX_LENGTH) {
    throw new Error('Web Crypto returned an invalid SHA-256 digest length.');
  }
  return hex;
}
