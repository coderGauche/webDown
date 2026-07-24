import {
  CAPTURE_MODES,
  CAPTURE_PROFILES,
  JOB_STATUSES,
  PAUSABLE_JOB_STATUSES,
  isCaptureError,
  isRenderWaitMs,
  type CaptureJob,
  type CaptureSettings,
  type JobCounters,
} from '@sitecapsule/domain';
import { PAGE_REGION_LIMITATIONS, PERFORMANCE_RESOURCE_INITIATORS } from '@sitecapsule/page';
import { isDomResourceCandidate } from '@sitecapsule/discovery';
import {
  CAPTURE_JOB_COMMANDS,
  MESSAGE_PROTOCOL_VERSION,
  MESSAGE_TYPES,
  type CaptureJobControlRequest,
  type CaptureJobCreateRequest,
  type CaptureJobGetRequest,
  type CaptureJobResponse,
  type CaptureJobUpdatedEvent,
  type MessageType,
  type PageInfoCollectRequest,
  type PageInfoRequest,
  type PageInfoResponse,
  type ProtocolMessage,
  type SiteCapsuleEvent,
  type SiteCapsuleMessage,
  type SiteCapsuleRequest,
  type SiteCapsuleResponse,
} from './protocol';

type UnknownRecord = Record<string, unknown>;

const MESSAGE_TYPE_VALUES = Object.values(MESSAGE_TYPES) as MessageType[];

const CAPTURE_SETTINGS_KEYS = [
  'archiveFileName',
  'renderWaitMs',
  'maxConcurrentRequests',
  'includeMedia',
  'includeScripts',
  'includeThirdPartyResources',
  'autoScroll',
  'maxDepth',
  'maxPages',
  'allowedUrlPatterns',
  'blockedUrlPatterns',
  'maxFileSizeBytes',
  'maxTotalSizeBytes',
] as const;

const JOB_COUNTER_KEYS = [
  'pagesDiscovered',
  'pagesCaptured',
  'resourcesDiscovered',
  'resourcesSaved',
  'resourcesFailed',
  'resourcesSkipped',
  'bytesWritten',
] as const;

const CAPTURE_JOB_KEYS = [
  'id',
  'tabId',
  'startUrl',
  'mode',
  'profile',
  'settings',
  'counters',
  'createdAt',
  'updatedAt',
  'status',
] as const;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: UnknownRecord,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): boolean {
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  const actualKeys = Object.keys(value);

  return (
    requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    actualKeys.every((key) => allowedKeys.has(key))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isAbsoluteUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;

  try {
    return new URL(value).href.length > 0;
  } catch {
    return false;
  }
}

function isNullableOrigin(value: unknown): value is string | null {
  if (value === null) return true;
  if (!isNonEmptyString(value)) return false;

  try {
    const url = new URL(value);
    return url.origin !== 'null' && url.origin === value;
  } catch {
    return false;
  }
}

function isNormalizedHttpResourceUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;

  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.href === value
    );
  } catch {
    return false;
  }
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNullablePositiveSafeInteger(value: unknown): value is number | null {
  return value === null || isPositiveSafeInteger(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function isMessageType(value: unknown): value is MessageType {
  return typeof value === 'string' && MESSAGE_TYPE_VALUES.includes(value as MessageType);
}

function isPageRegionDiagnostic(value: unknown): boolean {
  if (!isRecord(value) || !isPositiveSafeInteger(value.ordinal)) return false;
  if (!isNonNegativeSafeInteger(value.depth)) return false;

  if (value.kind === 'shadow-root') {
    return (
      hasExactKeys(value, ['kind', 'ordinal', 'depth', 'access', 'reason']) &&
      value.access === 'accessible' &&
      value.reason === 'open-shadow-root'
    );
  }

  if (value.kind !== 'iframe') return false;
  if (!hasExactKeys(value, ['kind', 'ordinal', 'depth', 'access', 'reason', 'sourceOrigin'])) {
    return false;
  }
  if (!isNullableOrigin(value.sourceOrigin)) return false;

  return value.reason === 'same-origin'
    ? value.access === 'accessible'
    : ['cross-origin', 'sandboxed', 'unavailable', 'access-denied'].includes(
        value.reason as string,
      ) && value.access === 'inaccessible';
}

function isPageRegionDiagnostics(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ['regions', 'limitations'])) return false;
  if (!Array.isArray(value.regions) || !value.regions.every(isPageRegionDiagnostic)) return false;
  if (!Array.isArray(value.limitations)) return false;
  const limitations = value.limitations;

  return (
    limitations.length === PAGE_REGION_LIMITATIONS.length &&
    PAGE_REGION_LIMITATIONS.every((limitation) => limitations.includes(limitation))
  );
}

function isPerformanceResourceRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'url',
      'initiatorType',
      'startTimeMs',
      'durationMs',
      'transferSize',
      'encodedBodySize',
      'decodedBodySize',
    ]) &&
    isNormalizedHttpResourceUrl(value.url) &&
    PERFORMANCE_RESOURCE_INITIATORS.includes(
      value.initiatorType as (typeof PERFORMANCE_RESOURCE_INITIATORS)[number],
    ) &&
    isNonNegativeFiniteNumber(value.startTimeMs) &&
    isNonNegativeFiniteNumber(value.durationMs) &&
    isNonNegativeSafeInteger(value.transferSize) &&
    isNonNegativeSafeInteger(value.encodedBodySize) &&
    isNonNegativeSafeInteger(value.decodedBodySize)
  );
}

function isPerformanceResourceRecords(value: unknown): boolean {
  if (!Array.isArray(value) || !value.every(isPerformanceResourceRecord)) return false;
  const urls = value.map((resource) => (resource as UnknownRecord).url);
  return new Set(urls).size === urls.length;
}

function hasMessageType<TType extends MessageType>(
  message: ProtocolMessage<MessageType, unknown>,
  type: TType,
): message is ProtocolMessage<TType, unknown> {
  return message.type === type;
}

export function isProtocolMessageEnvelope(
  message: unknown,
): message is ProtocolMessage<MessageType, unknown> {
  if (
    !isRecord(message) ||
    !hasExactKeys(message, ['protocolVersion', 'correlationId', 'type', 'payload'])
  ) {
    return false;
  }

  return (
    message.protocolVersion === MESSAGE_PROTOCOL_VERSION &&
    isNonEmptyString(message.correlationId) &&
    isMessageType(message.type)
  );
}

export function isCaptureSettings(value: unknown): value is CaptureSettings {
  if (!isRecord(value) || !hasExactKeys(value, CAPTURE_SETTINGS_KEYS)) return false;

  return (
    isNonEmptyString(value.archiveFileName) &&
    isRenderWaitMs(value.renderWaitMs) &&
    isPositiveSafeInteger(value.maxConcurrentRequests) &&
    typeof value.includeMedia === 'boolean' &&
    typeof value.includeScripts === 'boolean' &&
    typeof value.includeThirdPartyResources === 'boolean' &&
    typeof value.autoScroll === 'boolean' &&
    isNonNegativeSafeInteger(value.maxDepth) &&
    isPositiveSafeInteger(value.maxPages) &&
    isStringArray(value.allowedUrlPatterns) &&
    isStringArray(value.blockedUrlPatterns) &&
    isNullablePositiveSafeInteger(value.maxFileSizeBytes) &&
    isNullablePositiveSafeInteger(value.maxTotalSizeBytes)
  );
}

export function isJobCounters(value: unknown): value is JobCounters {
  return (
    isRecord(value) &&
    hasExactKeys(value, JOB_COUNTER_KEYS) &&
    JOB_COUNTER_KEYS.every((key) => isNonNegativeSafeInteger(value[key]))
  );
}

export function isCaptureJob(value: unknown): value is CaptureJob {
  if (!isRecord(value) || !hasExactKeys(value, CAPTURE_JOB_KEYS, ['resumeStatus'])) return false;

  const hasValidBase =
    isNonEmptyString(value.id) &&
    isNonNegativeSafeInteger(value.tabId) &&
    isNonEmptyString(value.startUrl) &&
    CAPTURE_MODES.includes(value.mode as (typeof CAPTURE_MODES)[number]) &&
    CAPTURE_PROFILES.includes(value.profile as (typeof CAPTURE_PROFILES)[number]) &&
    isCaptureSettings(value.settings) &&
    isJobCounters(value.counters) &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt);

  if (!hasValidBase || typeof value.status !== 'string') return false;

  if (value.status === 'paused') {
    return (
      hasExactKeys(value, [...CAPTURE_JOB_KEYS, 'resumeStatus']) &&
      PAUSABLE_JOB_STATUSES.includes(value.resumeStatus as (typeof PAUSABLE_JOB_STATUSES)[number])
    );
  }

  return (
    !Object.prototype.hasOwnProperty.call(value, 'resumeStatus') &&
    value.status !== 'paused' &&
    JOB_STATUSES.includes(value.status as (typeof JOB_STATUSES)[number])
  );
}

export function isPageInfoRequest(message: unknown): message is PageInfoRequest {
  if (
    !isProtocolMessageEnvelope(message) ||
    !hasMessageType(message, MESSAGE_TYPES.pageInfoRequest)
  ) {
    return false;
  }

  return (
    isRecord(message.payload) &&
    hasExactKeys(message.payload, ['tabId', 'renderWaitMs']) &&
    isNonNegativeSafeInteger(message.payload.tabId) &&
    isRenderWaitMs(message.payload.renderWaitMs)
  );
}

export function isPageInfoCollectRequest(message: unknown): message is PageInfoCollectRequest {
  return (
    isProtocolMessageEnvelope(message) &&
    hasMessageType(message, MESSAGE_TYPES.pageInfoCollect) &&
    isRecord(message.payload) &&
    hasExactKeys(message.payload, ['tabUrl', 'renderWaitMs']) &&
    isAbsoluteUrl(message.payload.tabUrl) &&
    isRenderWaitMs(message.payload.renderWaitMs)
  );
}

export function isPageInfoResponse(message: unknown): message is PageInfoResponse {
  if (
    !isProtocolMessageEnvelope(message) ||
    !hasMessageType(message, MESSAGE_TYPES.pageInfoResponse)
  ) {
    return false;
  }
  if (!isRecord(message.payload) || typeof message.payload.ok !== 'boolean') return false;

  if (message.payload.ok) {
    return (
      hasExactKeys(message.payload, ['ok', 'page']) &&
      isRecord(message.payload.page) &&
      hasExactKeys(message.payload.page, [
        'title',
        'tabUrl',
        'baseUrl',
        'finalUrl',
        'serializedDom',
        'domResources',
        'regionDiagnostics',
        'performanceResources',
      ]) &&
      typeof message.payload.page.title === 'string' &&
      isAbsoluteUrl(message.payload.page.tabUrl) &&
      isAbsoluteUrl(message.payload.page.baseUrl) &&
      isAbsoluteUrl(message.payload.page.finalUrl) &&
      isNonEmptyString(message.payload.page.serializedDom) &&
      Array.isArray(message.payload.page.domResources) &&
      message.payload.page.domResources.every(isDomResourceCandidate) &&
      isPageRegionDiagnostics(message.payload.page.regionDiagnostics) &&
      isPerformanceResourceRecords(message.payload.page.performanceResources)
    );
  }

  return hasExactKeys(message.payload, ['ok', 'error']) && isCaptureError(message.payload.error);
}

export function isCaptureJobCreateRequest(message: unknown): message is CaptureJobCreateRequest {
  if (
    !isProtocolMessageEnvelope(message) ||
    !hasMessageType(message, MESSAGE_TYPES.captureJobCreate)
  ) {
    return false;
  }
  if (
    !isRecord(message.payload) ||
    !hasExactKeys(message.payload, ['tabId', 'startUrl', 'mode', 'profile', 'settings'])
  ) {
    return false;
  }

  return (
    isNonNegativeSafeInteger(message.payload.tabId) &&
    isNonEmptyString(message.payload.startUrl) &&
    CAPTURE_MODES.includes(message.payload.mode as (typeof CAPTURE_MODES)[number]) &&
    CAPTURE_PROFILES.includes(message.payload.profile as (typeof CAPTURE_PROFILES)[number]) &&
    isCaptureSettings(message.payload.settings)
  );
}

export function isCaptureJobControlRequest(message: unknown): message is CaptureJobControlRequest {
  if (
    !isProtocolMessageEnvelope(message) ||
    !hasMessageType(message, MESSAGE_TYPES.captureJobControl)
  ) {
    return false;
  }

  return (
    isRecord(message.payload) &&
    hasExactKeys(message.payload, ['jobId', 'command']) &&
    isNonEmptyString(message.payload.jobId) &&
    CAPTURE_JOB_COMMANDS.includes(message.payload.command as (typeof CAPTURE_JOB_COMMANDS)[number])
  );
}

export function isCaptureJobGetRequest(message: unknown): message is CaptureJobGetRequest {
  if (
    !isProtocolMessageEnvelope(message) ||
    !hasMessageType(message, MESSAGE_TYPES.captureJobGet)
  ) {
    return false;
  }

  return (
    isRecord(message.payload) &&
    hasExactKeys(message.payload, ['jobId']) &&
    isNonEmptyString(message.payload.jobId)
  );
}

export function isCaptureJobResponse(message: unknown): message is CaptureJobResponse {
  if (
    !isProtocolMessageEnvelope(message) ||
    !hasMessageType(message, MESSAGE_TYPES.captureJobResponse)
  ) {
    return false;
  }
  if (!isRecord(message.payload) || typeof message.payload.ok !== 'boolean') return false;

  if (message.payload.ok) {
    return hasExactKeys(message.payload, ['ok', 'job']) && isCaptureJob(message.payload.job);
  }

  return hasExactKeys(message.payload, ['ok', 'error']) && isCaptureError(message.payload.error);
}

export function isCaptureJobUpdatedEvent(message: unknown): message is CaptureJobUpdatedEvent {
  if (
    !isProtocolMessageEnvelope(message) ||
    !hasMessageType(message, MESSAGE_TYPES.captureJobUpdated)
  ) {
    return false;
  }

  return (
    isRecord(message.payload) &&
    hasExactKeys(message.payload, ['job']) &&
    isCaptureJob(message.payload.job)
  );
}

export function isSiteCapsuleRequest(message: unknown): message is SiteCapsuleRequest {
  return (
    isPageInfoRequest(message) ||
    isPageInfoCollectRequest(message) ||
    isCaptureJobCreateRequest(message) ||
    isCaptureJobControlRequest(message) ||
    isCaptureJobGetRequest(message)
  );
}

export function isSiteCapsuleResponse(message: unknown): message is SiteCapsuleResponse {
  return isPageInfoResponse(message) || isCaptureJobResponse(message);
}

export function isSiteCapsuleEvent(message: unknown): message is SiteCapsuleEvent {
  return isCaptureJobUpdatedEvent(message);
}

export function isSiteCapsuleMessage(message: unknown): message is SiteCapsuleMessage {
  return (
    isSiteCapsuleRequest(message) || isSiteCapsuleResponse(message) || isSiteCapsuleEvent(message)
  );
}
