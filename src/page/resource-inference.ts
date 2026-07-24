import { RESOURCE_TYPES, type ResourceType } from '@sitecapsule/domain';

import type { ResourceDiscoveryEvidence } from './resource-discovery';
import { classifyResourceUrl } from './resource-protocol';

export const RESOURCE_INFERENCE_SOURCES = [
  'data-url-header',
  'dom-context',
  'css-context',
  'performance-initiator',
  'url-extension',
] as const;
export const RESOURCE_INFERENCE_CONFIDENCES = ['high', 'medium', 'low', 'unknown'] as const;

export type ResourceInferenceSource = (typeof RESOURCE_INFERENCE_SOURCES)[number];
export type ResourceInferenceConfidence = (typeof RESOURCE_INFERENCE_CONFIDENCES)[number];

export type ResourceInferenceEvidence = {
  source: ResourceInferenceSource;
  resourceType: ResourceType | null;
  mimeTypeHint: string | null;
  confidence: Exclude<ResourceInferenceConfidence, 'unknown'>;
  detail: string;
};

export type ResourceMetadataInference = {
  resourceType: ResourceType;
  resourceTypeSource: ResourceInferenceSource | null;
  resourceTypeConfidence: ResourceInferenceConfidence;
  mimeTypeHint: string | null;
  mimeTypeHintSource: ResourceInferenceSource | null;
  mimeTypeHintConfidence: ResourceInferenceConfidence;
  hasConflict: boolean;
  evidence: ResourceInferenceEvidence[];
};

type RankedEvidence = ResourceInferenceEvidence & { priority: number; sequence: number };
type ExtensionMetadata = { resourceType: ResourceType; mimeTypeHint: string | null };

const MIME_TYPE_PATTERN = /^[a-z\d!#$&^_.+-]+\/[a-z\d!#$&^_.+-]+$/;
const IMAGE_CSS_PROPERTY_PATTERN =
  /^(?:background|background-image|border-image|border-image-source|content|cursor|filter|list-style|list-style-image|mask|mask-image|shape-outside)$/;

const EXTENSION_METADATA: Readonly<Record<string, ExtensionMetadata>> = {
  html: { resourceType: 'document', mimeTypeHint: 'text/html' },
  htm: { resourceType: 'document', mimeTypeHint: 'text/html' },
  xhtml: { resourceType: 'document', mimeTypeHint: 'application/xhtml+xml' },
  css: { resourceType: 'stylesheet', mimeTypeHint: 'text/css' },
  js: { resourceType: 'script', mimeTypeHint: 'text/javascript' },
  mjs: { resourceType: 'script', mimeTypeHint: 'text/javascript' },
  cjs: { resourceType: 'script', mimeTypeHint: 'text/javascript' },
  json: { resourceType: 'data', mimeTypeHint: 'application/json' },
  map: { resourceType: 'data', mimeTypeHint: 'application/json' },
  wasm: { resourceType: 'wasm', mimeTypeHint: 'application/wasm' },
  webmanifest: { resourceType: 'manifest', mimeTypeHint: 'application/manifest+json' },
  manifest: { resourceType: 'manifest', mimeTypeHint: 'application/manifest+json' },
  png: { resourceType: 'image', mimeTypeHint: 'image/png' },
  jpg: { resourceType: 'image', mimeTypeHint: 'image/jpeg' },
  jpeg: { resourceType: 'image', mimeTypeHint: 'image/jpeg' },
  gif: { resourceType: 'image', mimeTypeHint: 'image/gif' },
  webp: { resourceType: 'image', mimeTypeHint: 'image/webp' },
  avif: { resourceType: 'image', mimeTypeHint: 'image/avif' },
  svg: { resourceType: 'image', mimeTypeHint: 'image/svg+xml' },
  ico: { resourceType: 'image', mimeTypeHint: 'image/x-icon' },
  bmp: { resourceType: 'image', mimeTypeHint: 'image/bmp' },
  woff: { resourceType: 'font', mimeTypeHint: 'font/woff' },
  woff2: { resourceType: 'font', mimeTypeHint: 'font/woff2' },
  ttf: { resourceType: 'font', mimeTypeHint: 'font/ttf' },
  otf: { resourceType: 'font', mimeTypeHint: 'font/otf' },
  eot: { resourceType: 'font', mimeTypeHint: 'application/vnd.ms-fontobject' },
  mp4: { resourceType: 'video', mimeTypeHint: 'video/mp4' },
  webm: { resourceType: 'video', mimeTypeHint: 'video/webm' },
  ogv: { resourceType: 'video', mimeTypeHint: 'video/ogg' },
  mp3: { resourceType: 'audio', mimeTypeHint: 'audio/mpeg' },
  wav: { resourceType: 'audio', mimeTypeHint: 'audio/wav' },
  oga: { resourceType: 'audio', mimeTypeHint: 'audio/ogg' },
  vtt: { resourceType: 'data', mimeTypeHint: 'text/vtt' },
  glb: { resourceType: 'model', mimeTypeHint: 'model/gltf-binary' },
  gltf: { resourceType: 'model', mimeTypeHint: 'model/gltf+json' },
  obj: { resourceType: 'model', mimeTypeHint: null },
  fbx: { resourceType: 'model', mimeTypeHint: null },
  ktx: { resourceType: 'texture', mimeTypeHint: 'image/ktx' },
  ktx2: { resourceType: 'texture', mimeTypeHint: 'image/ktx2' },
  basis: { resourceType: 'texture', mimeTypeHint: null },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => actualKeys.includes(key));
}

function isResourceType(value: unknown): value is ResourceType {
  return RESOURCE_TYPES.includes(value as ResourceType);
}

function isMimeTypeHint(value: unknown): value is string {
  return (
    typeof value === 'string' && MIME_TYPE_PATTERN.test(value) && value.toLowerCase() === value
  );
}

function resourceTypeFromMimeType(mimeType: string): ResourceType | null {
  if (mimeType === 'text/css') return 'stylesheet';
  if (
    [
      'text/javascript',
      'application/javascript',
      'text/ecmascript',
      'application/ecmascript',
    ].includes(mimeType)
  ) {
    return 'script';
  }
  if (mimeType === 'application/wasm') return 'wasm';
  if (mimeType === 'application/manifest+json') return 'manifest';
  if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') return 'document';
  if (mimeType === 'text/vtt' || mimeType === 'application/json' || mimeType.endsWith('+json')) {
    return 'data';
  }
  if (mimeType === 'image/ktx' || mimeType === 'image/ktx2') return 'texture';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('font/') || mimeType === 'application/vnd.ms-fontobject') return 'font';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('model/')) return 'model';
  if (mimeType.startsWith('text/')) return 'data';
  return null;
}

function domContextType(evidence: ResourceDiscoveryEvidence): ResourceType | null {
  if (evidence.channel === 'svg-attribute') {
    return evidence.candidate.tagName === 'script' ? 'script' : 'image';
  }
  if (evidence.channel !== 'dom-attribute') return null;

  const { tagName, attributeName } = evidence.candidate;
  if (tagName === 'script') return 'script';
  if (tagName === 'img' || tagName === 'input' || attributeName === 'poster') return 'image';
  if (tagName === 'video') return 'video';
  if (tagName === 'audio') return 'audio';
  if (tagName === 'frame' || tagName === 'iframe') return 'document';
  if (tagName === 'track') return 'data';
  return null;
}

function cssContextType(evidence: ResourceDiscoveryEvidence): ResourceType | null {
  if (evidence.channel !== 'css-ast') return null;
  if (evidence.candidate.kind === 'import') return 'stylesheet';
  if (evidence.candidate.kind === 'font-face') return 'font';

  const propertyName = evidence.candidate.propertyName?.toLowerCase();
  if (
    (propertyName && IMAGE_CSS_PROPERTY_PATTERN.test(propertyName)) ||
    evidence.candidate.cssSourceType === 'svg-presentation-attribute'
  ) {
    return 'image';
  }
  return null;
}

function performanceContextType(evidence: ResourceDiscoveryEvidence): ResourceType | null {
  if (evidence.channel !== 'performance') return null;
  switch (evidence.candidate.initiatorType) {
    case 'script':
      return 'script';
    case 'img':
    case 'image':
    case 'input':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'frame':
    case 'iframe':
    case 'navigation':
      return 'document';
    case 'track':
      return 'data';
    default:
      return null;
  }
}

function extensionMetadata(url: string): { extension: string; metadata: ExtensionMetadata } | null {
  const classification = classifyResourceUrl(url);
  if (!classification || classification.kind === 'data' || classification.kind === 'blob')
    return null;
  const pathname = new URL(url).pathname;
  const fileName = pathname.slice(pathname.lastIndexOf('/') + 1);
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex === fileName.length - 1) return null;
  const extension = fileName.slice(dotIndex + 1).toLowerCase();
  const metadata = EXTENSION_METADATA[extension];
  return metadata ? { extension, metadata } : null;
}

function summarizeEvidence(
  evidence: readonly ResourceInferenceEvidence[],
): ResourceMetadataInference {
  const typeWinner = evidence.find((item) => item.resourceType !== null);
  const resourceType = typeWinner?.resourceType ?? 'other';
  const mimeWinner = evidence.find(
    (item) =>
      item.mimeTypeHint !== null &&
      (resourceType === 'other' ||
        item.resourceType === null ||
        item.resourceType === resourceType),
  );
  const conflictingTypes = new Set(
    evidence.map((item) => item.resourceType).filter((type): type is ResourceType => type !== null),
  );

  return {
    resourceType,
    resourceTypeSource: typeWinner?.source ?? null,
    resourceTypeConfidence: typeWinner?.confidence ?? 'unknown',
    mimeTypeHint: mimeWinner?.mimeTypeHint ?? null,
    mimeTypeHintSource: mimeWinner?.source ?? null,
    mimeTypeHintConfidence: mimeWinner?.confidence ?? 'unknown',
    hasConflict: conflictingTypes.size > 1,
    evidence: [...evidence],
  };
}

export function inferResourceMetadata(
  url: string,
  discoveryEvidence: readonly ResourceDiscoveryEvidence[],
): ResourceMetadataInference {
  const ranked: RankedEvidence[] = [];
  const add = (item: Omit<RankedEvidence, 'sequence'>) => {
    ranked.push({ ...item, sequence: ranked.length });
  };
  const classification = classifyResourceUrl(url);

  if (classification?.kind === 'data') {
    const rawMediaType = classification.header.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    const isValidDeclaredType = rawMediaType !== '' && MIME_TYPE_PATTERN.test(rawMediaType);
    if (rawMediaType === '' || isValidDeclaredType) {
      const mimeTypeHint = isValidDeclaredType ? rawMediaType : 'text/plain';
      add({
        source: 'data-url-header',
        resourceType: resourceTypeFromMimeType(mimeTypeHint),
        mimeTypeHint,
        confidence: isValidDeclaredType ? 'high' : 'medium',
        detail: isValidDeclaredType ? 'data:declared-media-type' : 'data:default-media-type',
        priority: isValidDeclaredType ? 500 : 250,
      });
    }
  }

  for (const item of discoveryEvidence) {
    const domType = domContextType(item);
    if (domType) {
      add({
        source: 'dom-context',
        resourceType: domType,
        mimeTypeHint: null,
        confidence: 'high',
        detail: `dom:${item.channel}`,
        priority: 400,
      });
    }

    const cssType = cssContextType(item);
    if (cssType) {
      add({
        source: 'css-context',
        resourceType: cssType,
        mimeTypeHint: null,
        confidence: 'high',
        detail: `css:${item.channel === 'css-ast' ? item.candidate.kind : 'unknown'}`,
        priority: 400,
      });
    }

    const performanceType = performanceContextType(item);
    if (performanceType) {
      add({
        source: 'performance-initiator',
        resourceType: performanceType,
        mimeTypeHint: null,
        confidence: 'medium',
        detail: `performance:${item.channel === 'performance' ? item.candidate.initiatorType : 'other'}`,
        priority: 300,
      });
    }
  }

  const extension = extensionMetadata(url);
  if (extension) {
    add({
      source: 'url-extension',
      resourceType: extension.metadata.resourceType,
      mimeTypeHint: extension.metadata.mimeTypeHint,
      confidence: 'low',
      detail: `extension:.${extension.extension}`,
      priority: 100,
    });
  }

  const sortedEvidence = ranked
    .sort((left, right) => right.priority - left.priority || left.sequence - right.sequence)
    .map(({ priority: _priority, sequence: _sequence, ...item }) => item);
  const evidence = Array.from(
    new Map(sortedEvidence.map((item) => [JSON.stringify(item), item])).values(),
  );
  return summarizeEvidence(evidence);
}

export function isResourceInferenceEvidence(value: unknown): value is ResourceInferenceEvidence {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['source', 'resourceType', 'mimeTypeHint', 'confidence', 'detail']) &&
    RESOURCE_INFERENCE_SOURCES.includes(value.source as ResourceInferenceSource) &&
    (value.resourceType === null || isResourceType(value.resourceType)) &&
    (value.mimeTypeHint === null || isMimeTypeHint(value.mimeTypeHint)) &&
    (value.resourceType !== null || value.mimeTypeHint !== null) &&
    ['high', 'medium', 'low'].includes(value.confidence as string) &&
    typeof value.detail === 'string' &&
    value.detail.trim() !== ''
  );
}

export function isResourceMetadataInference(value: unknown): value is ResourceMetadataInference {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'resourceType',
      'resourceTypeSource',
      'resourceTypeConfidence',
      'mimeTypeHint',
      'mimeTypeHintSource',
      'mimeTypeHintConfidence',
      'hasConflict',
      'evidence',
    ]) ||
    !Array.isArray(value.evidence) ||
    !value.evidence.every(isResourceInferenceEvidence) ||
    new Set(value.evidence.map((item) => JSON.stringify(item))).size !== value.evidence.length
  ) {
    return false;
  }

  const expected = summarizeEvidence(value.evidence);
  return JSON.stringify(value) === JSON.stringify(expected);
}

export function matchesResourceMetadataInference(
  value: unknown,
  url: string,
  evidence: readonly ResourceDiscoveryEvidence[],
): value is ResourceMetadataInference {
  return (
    isResourceMetadataInference(value) &&
    JSON.stringify(value) === JSON.stringify(inferResourceMetadata(url, evidence))
  );
}
