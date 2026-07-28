import { RESOURCE_TYPES, type ResourceType } from '@sitecapsule/domain';

import { createResourceOriginDirectory } from './resource-directory';

export const PORTABLE_FILE_NAME_MAX_BYTES = 240;
export const PORTABLE_FILE_EXTENSION_MAX_BYTES = 32;

export const RESOURCE_TYPE_FALLBACK_FILE_NAMES = {
  document: 'index.html',
  stylesheet: 'style.css',
  image: 'image',
  font: 'font',
  script: 'script.js',
  video: 'video',
  audio: 'audio',
  wasm: 'module.wasm',
  manifest: 'manifest.webmanifest',
  model: 'model',
  texture: 'texture',
  data: 'data',
  other: 'resource',
} as const satisfies Record<ResourceType, string>;

const INVALID_FILE_NAME_CHARACTERS = /[\u0000-\u001f\u007f-\u009f<>:"/\\|?*]+/g;
const WINDOWS_RESERVED_DEVICE_NAME =
  /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com(?:[1-9]|[¹²³])|lpt(?:[1-9]|[¹²³]))$/i;
const UTF8_ENCODER = new TextEncoder();

function isResourceType(value: unknown): value is ResourceType {
  return RESOURCE_TYPES.includes(value as ResourceType);
}

function replaceLoneSurrogates(value: string): string {
  let result = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    result +=
      codePoint !== undefined && codePoint >= 0xd800 && codePoint <= 0xdfff ? '\uFFFD' : character;
  }
  return result;
}

function cleanFileName(value: string): string {
  return replaceLoneSurrogates(value)
    .normalize('NFC')
    .replace(INVALID_FILE_NAME_CHARACTERS, '_')
    .replace(/^ +|[ .]+$/g, '');
}

function protectWindowsDeviceName(value: string): string {
  const dotIndex = value.indexOf('.');
  const stem = (dotIndex === -1 ? value : value.slice(0, dotIndex)).replace(/[ .]+$/g, '');
  return WINDOWS_RESERVED_DEVICE_NAME.test(stem) ? `_${value}` : value;
}

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

function truncateUtf8(value: string, maxBytes: number): string {
  let result = '';
  let bytes = 0;

  for (const character of value) {
    const characterBytes = utf8ByteLength(character);
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }

  return result;
}

function truncateFileName(value: string): string {
  if (utf8ByteLength(value) <= PORTABLE_FILE_NAME_MAX_BYTES) return value;

  const dotIndex = value.lastIndexOf('.');
  if (dotIndex > 0) {
    const extension = value.slice(dotIndex);
    const extensionBytes = utf8ByteLength(extension);
    if (
      extensionBytes <= PORTABLE_FILE_EXTENSION_MAX_BYTES &&
      extensionBytes < PORTABLE_FILE_NAME_MAX_BYTES
    ) {
      const stem = truncateUtf8(
        value.slice(0, dotIndex),
        PORTABLE_FILE_NAME_MAX_BYTES - extensionBytes,
      ).replace(/[ .]+$/g, '');
      if (stem) return `${stem}${extension}`;
    }
  }

  return truncateUtf8(value, PORTABLE_FILE_NAME_MAX_BYTES).replace(/[ .]+$/g, '');
}

export function sanitizeArchiveFileName(value: string, fallback = 'resource'): string {
  if (typeof value !== 'string' || typeof fallback !== 'string') {
    throw new TypeError('Archive file name and fallback must be strings.');
  }

  const cleanedFallback = protectWindowsDeviceName(cleanFileName(fallback)) || 'resource';
  const cleanedName = protectWindowsDeviceName(cleanFileName(value)) || cleanedFallback;
  return truncateFileName(cleanedName) || truncateFileName(cleanedFallback) || 'resource';
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function createResourceFileName(value: string, resourceType: ResourceType): string {
  if (!isResourceType(resourceType)) throw new TypeError('Resource type is not supported.');

  const { normalizedUrl } = createResourceOriginDirectory(value);
  const url = new URL(normalizedUrl);
  const encodedFileName = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
  return sanitizeArchiveFileName(
    decodePathSegment(encodedFileName),
    RESOURCE_TYPE_FALLBACK_FILE_NAMES[resourceType],
  );
}
