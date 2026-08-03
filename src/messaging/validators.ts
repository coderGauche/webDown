import {
  CAPTURE_MODES,
  CAPTURE_PROFILES,
  JOB_STATUSES,
  PAUSABLE_JOB_STATUSES,
  RESOURCE_TYPES,
  isCaptureError,
  isRenderWaitMs,
  type CaptureJob,
  type CaptureSettings,
  type JobCounters,
} from '@sitecapsule/domain';
import {
  matchesMergedResourceCandidates,
  matchesResourceGraph,
  DOM_CLEANUP_LIMITATIONS,
  DOM_CLEANUP_REASONS,
  PAGE_REGION_LIMITATIONS,
  PERFORMANCE_RESOURCE_INITIATORS,
  type PerformanceResourceRecord,
} from '@sitecapsule/page';
import {
  isCssResourceCandidate,
  isDomResourceCandidate,
  isEmbeddedCssSource,
  isSvgResourceCandidate,
  type CssResourceCandidate,
  type DomResourceCandidate,
  type SvgResourceCandidate,
} from '@sitecapsule/discovery';
import {
  CAPTURE_JOB_COMMANDS,
  CAPTURE_JOB_HISTORY_LIMIT,
  CAPTURE_RESULT_FAILURE_LIMIT,
  MESSAGE_PROTOCOL_VERSION,
  MESSAGE_TYPES,
  type CaptureArchiveChunkGetRequest,
  type CaptureArchiveChunkResponse,
  type CaptureJobControlRequest,
  type CaptureJobCreateRequest,
  type CaptureJobGetRequest,
  type CaptureJobDeleteRequest,
  type CaptureJobHistoryClearRequest,
  type CaptureJobHistoryListRequest,
  type CaptureJobHistoryResponse,
  type CaptureJobMutationResponse,
  type CaptureJobResultGetRequest,
  type CaptureJobResultResponse,
  type CaptureJobResponse,
  type CaptureJobUpdatedEvent,
  type MessageType,
  type PageInfoCollectRequest,
  type PageArchiveRewriteRequest,
  type PageArchiveRewriteResponse,
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

function isDomCleanupReport(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['removedElements', 'reasonCounts', 'limitations']) ||
    !isNonNegativeSafeInteger(value.removedElements) ||
    !isRecord(value.reasonCounts) ||
    !Array.isArray(value.limitations)
  ) {
    return false;
  }

  const reasonCounts = value.reasonCounts;
  const limitations = value.limitations;
  if (
    !hasExactKeys(reasonCounts, DOM_CLEANUP_REASONS) ||
    !DOM_CLEANUP_REASONS.every((reason) => isNonNegativeSafeInteger(reasonCounts[reason])) ||
    limitations.length !== DOM_CLEANUP_LIMITATIONS.length ||
    !DOM_CLEANUP_LIMITATIONS.every((limitation) => limitations.includes(limitation))
  ) {
    return false;
  }

  return (
    DOM_CLEANUP_REASONS.reduce((total, reason) => total + Number(reasonCounts[reason]), 0) ===
    value.removedElements
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

function isPageResourceDiscovery(page: UnknownRecord): boolean {
  if (
    !Array.isArray(page.domResources) ||
    !page.domResources.every(isDomResourceCandidate) ||
    !Array.isArray(page.cssResources) ||
    !page.cssResources.every(isCssResourceCandidate) ||
    !Array.isArray(page.svgResources) ||
    !page.svgResources.every(isSvgResourceCandidate) ||
    !isPerformanceResourceRecords(page.performanceResources)
  ) {
    return false;
  }

  const input = {
    domResources: page.domResources as DomResourceCandidate[],
    cssResources: page.cssResources as CssResourceCandidate[],
    svgResources: page.svgResources as SvgResourceCandidate[],
    performanceResources: page.performanceResources as PerformanceResourceRecord[],
  };
  if (!matchesMergedResourceCandidates(page.mergedResources, input)) return false;

  return (
    typeof page.finalUrl === 'string' &&
    matchesResourceGraph(page.resourceGraph, page.finalUrl, page.mergedResources)
  );
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
  if (!isRecord(value) || !hasExactKeys(value, CAPTURE_JOB_KEYS, ['resumeStatus', 'error'])) {
    return false;
  }

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
  const hasError = Object.prototype.hasOwnProperty.call(value, 'error');
  if (hasError && (value.status !== 'failed' || !isCaptureError(value.error))) return false;

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

function isCaptureResultError(value: unknown): boolean {
  if (!isCaptureError(value)) return false;
  const context = value.context;
  if (!context) return true;
  if (
    ['jobId', 'resourceId', 'url', 'field', 'targetStage'].some((key) =>
      Object.prototype.hasOwnProperty.call(context, key),
    )
  ) {
    return false;
  }
  return (
    context.browserError === undefined ||
    /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(context.browserError)
  );
}

function isCaptureResourceFailure(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['url', 'resourceType', 'httpStatus', 'affectsPrimaryVisual', 'error']) &&
    isNonEmptyString(value.url) &&
    RESOURCE_TYPES.includes(value.resourceType as (typeof RESOURCE_TYPES)[number]) &&
    (value.httpStatus === null ||
      (Number.isInteger(value.httpStatus) &&
        (value.httpStatus as number) >= 100 &&
        (value.httpStatus as number) <= 599)) &&
    typeof value.affectsPrimaryVisual === 'boolean' &&
    isCaptureResultError(value.error)
  );
}

function isCaptureJobResult(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'jobId',
      'status',
      'fileName',
      'archiveAvailable',
      'archiveByteLength',
      'counters',
      'error',
      'failures',
      'omittedFailureCount',
    ])
  ) {
    return false;
  }
  if (
    !isNonEmptyString(value.jobId) ||
    !['completed', 'failed', 'cancelled'].includes(value.status as string) ||
    !isNonEmptyString(value.fileName) ||
    typeof value.archiveAvailable !== 'boolean' ||
    !isJobCounters(value.counters) ||
    (value.error !== null && !isCaptureResultError(value.error)) ||
    !Array.isArray(value.failures) ||
    value.failures.length > CAPTURE_RESULT_FAILURE_LIMIT ||
    !value.failures.every(isCaptureResourceFailure) ||
    !isNonNegativeSafeInteger(value.omittedFailureCount)
  ) {
    return false;
  }
  if (value.error !== null && value.status !== 'failed') return false;
  return value.archiveAvailable
    ? value.status === 'completed' && isPositiveSafeInteger(value.archiveByteLength)
    : value.archiveByteLength === null;
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
        'cleanupReport',
        'domResources',
        'cssSources',
        'cssResources',
        'svgResources',
        'regionDiagnostics',
        'performanceResources',
        'mergedResources',
        'resourceGraph',
      ]) &&
      typeof message.payload.page.title === 'string' &&
      isAbsoluteUrl(message.payload.page.tabUrl) &&
      isAbsoluteUrl(message.payload.page.baseUrl) &&
      isAbsoluteUrl(message.payload.page.finalUrl) &&
      isNonEmptyString(message.payload.page.serializedDom) &&
      isDomCleanupReport(message.payload.page.cleanupReport) &&
      Array.isArray(message.payload.page.cssSources) &&
      message.payload.page.cssSources.every(isEmbeddedCssSource) &&
      isPageRegionDiagnostics(message.payload.page.regionDiagnostics) &&
      isPageResourceDiscovery(message.payload.page)
    );
  }

  return hasExactKeys(message.payload, ['ok', 'error']) && isCaptureError(message.payload.error);
}

function isResourcePathMapping(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'normalizedUrl',
      'originalUrls',
      'resourceType',
      'directoryPath',
      'baseFileName',
      'queryHash',
      'collisionHash',
      'fileName',
      'relativePath',
    ]) &&
    isAbsoluteUrl(value.normalizedUrl) &&
    isStringArray(value.originalUrls) &&
    value.originalUrls.length > 0 &&
    value.originalUrls.every(isAbsoluteUrl) &&
    RESOURCE_TYPES.includes(value.resourceType as (typeof RESOURCE_TYPES)[number]) &&
    isNonEmptyString(value.directoryPath) &&
    isNonEmptyString(value.baseFileName) &&
    (value.queryHash === null || isNonEmptyString(value.queryHash)) &&
    (value.collisionHash === null || isNonEmptyString(value.collisionHash)) &&
    isNonEmptyString(value.fileName) &&
    isNonEmptyString(value.relativePath)
  );
}

export function isPageArchiveRewriteRequest(
  message: unknown,
): message is PageArchiveRewriteRequest {
  return (
    isProtocolMessageEnvelope(message) &&
    hasMessageType(message, MESSAGE_TYPES.pageArchiveRewrite) &&
    isRecord(message.payload) &&
    hasExactKeys(message.payload, ['html', 'documentUrl', 'baseUrl', 'savedResourceMappings']) &&
    isNonEmptyString(message.payload.html) &&
    isAbsoluteUrl(message.payload.documentUrl) &&
    isAbsoluteUrl(message.payload.baseUrl) &&
    Array.isArray(message.payload.savedResourceMappings) &&
    message.payload.savedResourceMappings.every(isResourcePathMapping)
  );
}

export function isPageArchiveRewriteResponse(
  message: unknown,
): message is PageArchiveRewriteResponse {
  if (
    !isProtocolMessageEnvelope(message) ||
    !hasMessageType(message, MESSAGE_TYPES.pageArchiveRewriteResponse) ||
    !isRecord(message.payload) ||
    typeof message.payload.ok !== 'boolean'
  ) {
    return false;
  }
  if (message.payload.ok) {
    return (
      hasExactKeys(message.payload, ['ok', 'html', 'rewrittenCount']) &&
      isNonEmptyString(message.payload.html) &&
      isNonNegativeSafeInteger(message.payload.rewrittenCount)
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

export function isCaptureJobHistoryListRequest(
  message: unknown,
): message is CaptureJobHistoryListRequest {
  return (
    isProtocolMessageEnvelope(message) &&
    hasMessageType(message, MESSAGE_TYPES.captureJobHistoryList) &&
    isRecord(message.payload) &&
    hasExactKeys(message.payload, ['limit']) &&
    isPositiveSafeInteger(message.payload.limit) &&
    message.payload.limit <= CAPTURE_JOB_HISTORY_LIMIT
  );
}

export function isCaptureJobDeleteRequest(message: unknown): message is CaptureJobDeleteRequest {
  return (
    isProtocolMessageEnvelope(message) &&
    hasMessageType(message, MESSAGE_TYPES.captureJobDelete) &&
    isRecord(message.payload) &&
    hasExactKeys(message.payload, ['jobId']) &&
    isNonEmptyString(message.payload.jobId)
  );
}

export function isCaptureJobHistoryClearRequest(
  message: unknown,
): message is CaptureJobHistoryClearRequest {
  return (
    isProtocolMessageEnvelope(message) &&
    hasMessageType(message, MESSAGE_TYPES.captureJobHistoryClear) &&
    isRecord(message.payload) &&
    hasExactKeys(message.payload, [])
  );
}

function isCaptureJobHistoryItem(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'jobId',
      'status',
      'fileName',
      'updatedAt',
      'counters',
      'archiveAvailable',
    ]) &&
    isNonEmptyString(value.jobId) &&
    ['completed', 'failed', 'cancelled'].includes(value.status as string) &&
    isNonEmptyString(value.fileName) &&
    isTimestamp(value.updatedAt) &&
    isJobCounters(value.counters) &&
    typeof value.archiveAvailable === 'boolean' &&
    (!value.archiveAvailable || value.status === 'completed')
  );
}

export function isCaptureJobHistoryResponse(
  message: unknown,
): message is CaptureJobHistoryResponse {
  if (
    !isProtocolMessageEnvelope(message) ||
    !hasMessageType(message, MESSAGE_TYPES.captureJobHistoryResponse) ||
    !isRecord(message.payload) ||
    typeof message.payload.ok !== 'boolean'
  )
    return false;
  return message.payload.ok
    ? hasExactKeys(message.payload, ['ok', 'items']) &&
        Array.isArray(message.payload.items) &&
        message.payload.items.length <= CAPTURE_JOB_HISTORY_LIMIT &&
        message.payload.items.every(isCaptureJobHistoryItem)
    : hasExactKeys(message.payload, ['ok', 'error']) && isCaptureError(message.payload.error);
}

export function isCaptureJobMutationResponse(
  message: unknown,
): message is CaptureJobMutationResponse {
  if (
    !isProtocolMessageEnvelope(message) ||
    !hasMessageType(message, MESSAGE_TYPES.captureJobMutationResponse) ||
    !isRecord(message.payload) ||
    typeof message.payload.ok !== 'boolean'
  )
    return false;
  return message.payload.ok
    ? hasExactKeys(message.payload, ['ok', 'deletedCount']) &&
        isNonNegativeSafeInteger(message.payload.deletedCount)
    : hasExactKeys(message.payload, ['ok', 'error']) && isCaptureError(message.payload.error);
}

export function isCaptureJobResultGetRequest(
  message: unknown,
): message is CaptureJobResultGetRequest {
  return (
    isProtocolMessageEnvelope(message) &&
    hasMessageType(message, MESSAGE_TYPES.captureJobResultGet) &&
    isRecord(message.payload) &&
    hasExactKeys(message.payload, ['jobId']) &&
    isNonEmptyString(message.payload.jobId)
  );
}

export function isCaptureJobResultResponse(message: unknown): message is CaptureJobResultResponse {
  if (
    !isProtocolMessageEnvelope(message) ||
    !hasMessageType(message, MESSAGE_TYPES.captureJobResultResponse) ||
    !isRecord(message.payload) ||
    typeof message.payload.ok !== 'boolean'
  ) {
    return false;
  }
  return message.payload.ok
    ? hasExactKeys(message.payload, ['ok', 'result']) && isCaptureJobResult(message.payload.result)
    : hasExactKeys(message.payload, ['ok', 'error']) && isCaptureError(message.payload.error);
}

export function isCaptureArchiveChunkGetRequest(
  message: unknown,
): message is CaptureArchiveChunkGetRequest {
  return (
    isProtocolMessageEnvelope(message) &&
    hasMessageType(message, MESSAGE_TYPES.captureArchiveChunkGet) &&
    isRecord(message.payload) &&
    hasExactKeys(message.payload, ['jobId', 'offset']) &&
    isNonEmptyString(message.payload.jobId) &&
    isNonNegativeSafeInteger(message.payload.offset)
  );
}

function isCanonicalBase64(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}

export function isCaptureArchiveChunkResponse(
  message: unknown,
): message is CaptureArchiveChunkResponse {
  if (
    !isProtocolMessageEnvelope(message) ||
    !hasMessageType(message, MESSAGE_TYPES.captureArchiveChunkResponse) ||
    !isRecord(message.payload) ||
    typeof message.payload.ok !== 'boolean'
  ) {
    return false;
  }
  if (!message.payload.ok) {
    return hasExactKeys(message.payload, ['ok', 'error']) && isCaptureError(message.payload.error);
  }
  return (
    hasExactKeys(message.payload, ['ok', 'jobId', 'offset', 'totalByteLength', 'base64', 'done']) &&
    isNonEmptyString(message.payload.jobId) &&
    isNonNegativeSafeInteger(message.payload.offset) &&
    isPositiveSafeInteger(message.payload.totalByteLength) &&
    message.payload.offset < message.payload.totalByteLength &&
    isCanonicalBase64(message.payload.base64) &&
    typeof message.payload.done === 'boolean'
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
    isPageArchiveRewriteRequest(message) ||
    isCaptureJobCreateRequest(message) ||
    isCaptureJobControlRequest(message) ||
    isCaptureJobGetRequest(message) ||
    isCaptureJobHistoryListRequest(message) ||
    isCaptureJobDeleteRequest(message) ||
    isCaptureJobHistoryClearRequest(message) ||
    isCaptureJobResultGetRequest(message) ||
    isCaptureArchiveChunkGetRequest(message)
  );
}

export function isSiteCapsuleResponse(message: unknown): message is SiteCapsuleResponse {
  return (
    isPageInfoResponse(message) ||
    isPageArchiveRewriteResponse(message) ||
    isCaptureJobResponse(message) ||
    isCaptureJobHistoryResponse(message) ||
    isCaptureJobMutationResponse(message) ||
    isCaptureJobResultResponse(message) ||
    isCaptureArchiveChunkResponse(message)
  );
}

export function isSiteCapsuleEvent(message: unknown): message is SiteCapsuleEvent {
  return isCaptureJobUpdatedEvent(message);
}

export function isSiteCapsuleMessage(message: unknown): message is SiteCapsuleMessage {
  return (
    isSiteCapsuleRequest(message) || isSiteCapsuleResponse(message) || isSiteCapsuleEvent(message)
  );
}
