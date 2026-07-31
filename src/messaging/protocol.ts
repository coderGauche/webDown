import {
  DEFAULT_RENDER_WAIT_MS,
  type CaptureError,
  type CaptureJob,
  type CaptureMode,
  type CaptureProfile,
  type CaptureSettings,
  type JobCounters,
  type JobStatus,
  type ResourceType,
} from '@sitecapsule/domain';
import type { PageSnapshot } from '@sitecapsule/page';
import type { ResourcePathMapping } from '@sitecapsule/archive';

export const MESSAGE_PROTOCOL_VERSION = 19 as const;

export const MESSAGE_TYPES = {
  pageInfoRequest: 'page-info/request',
  pageInfoCollect: 'page-info/collect',
  pageInfoResponse: 'page-info/response',
  pageArchiveRewrite: 'page-archive/rewrite',
  pageArchiveRewriteResponse: 'page-archive/rewrite-response',
  captureJobCreate: 'capture-job/create',
  captureJobControl: 'capture-job/control',
  captureJobGet: 'capture-job/get',
  captureJobHistoryList: 'capture-job/history-list',
  captureJobHistoryResponse: 'capture-job/history-response',
  captureJobDelete: 'capture-job/delete',
  captureJobHistoryClear: 'capture-job/history-clear',
  captureJobMutationResponse: 'capture-job/mutation-response',
  captureJobResultGet: 'capture-job/result-get',
  captureJobResultResponse: 'capture-job/result-response',
  captureArchiveChunkGet: 'capture-archive/chunk-get',
  captureArchiveChunkResponse: 'capture-archive/chunk-response',
  captureJobResponse: 'capture-job/response',
  captureJobUpdated: 'capture-job/updated',
} as const;

export const CAPTURE_JOB_COMMANDS = ['pause', 'resume', 'cancel', 'retry'] as const;
export const CAPTURE_RESULT_FAILURE_LIMIT = 100;
export const CAPTURE_JOB_HISTORY_LIMIT = 20;

export type MessageProtocolVersion = typeof MESSAGE_PROTOCOL_VERSION;
export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];
export type CaptureJobCommand = (typeof CAPTURE_JOB_COMMANDS)[number];

export type ProtocolMessage<
  TType extends MessageType,
  TPayload,
  TVersion extends number = MessageProtocolVersion,
> = {
  protocolVersion: TVersion;
  correlationId: string;
  type: TType;
  payload: TPayload;
};

export type PageInfo = PageSnapshot;

export type PageInfoRequest = ProtocolMessage<
  typeof MESSAGE_TYPES.pageInfoRequest,
  {
    tabId: number;
    renderWaitMs: CaptureSettings['renderWaitMs'];
  }
>;

export type PageInfoCollectRequest = ProtocolMessage<
  typeof MESSAGE_TYPES.pageInfoCollect,
  {
    tabUrl: string;
    renderWaitMs: CaptureSettings['renderWaitMs'];
  }
>;

export type PageInfoResponse = ProtocolMessage<
  typeof MESSAGE_TYPES.pageInfoResponse,
  | {
      ok: true;
      page: PageInfo;
    }
  | {
      ok: false;
      error: CaptureError;
    }
>;

export type PageArchiveRewriteRequest = ProtocolMessage<
  typeof MESSAGE_TYPES.pageArchiveRewrite,
  {
    html: string;
    documentUrl: string;
    baseUrl: string;
    savedResourceMappings: ResourcePathMapping[];
  }
>;

export type PageArchiveRewriteResponse = ProtocolMessage<
  typeof MESSAGE_TYPES.pageArchiveRewriteResponse,
  | {
      ok: true;
      html: string;
      rewrittenCount: number;
    }
  | {
      ok: false;
      error: CaptureError;
    }
>;

export type CaptureJobCreateInput = {
  tabId: number;
  startUrl: string;
  mode: CaptureMode;
  profile: CaptureProfile;
  settings: CaptureSettings;
};

export type CaptureJobCreateRequest = ProtocolMessage<
  typeof MESSAGE_TYPES.captureJobCreate,
  CaptureJobCreateInput
>;

export type CaptureJobControlRequest = ProtocolMessage<
  typeof MESSAGE_TYPES.captureJobControl,
  {
    jobId: string;
    command: CaptureJobCommand;
  }
>;

export type CaptureJobGetRequest = ProtocolMessage<
  typeof MESSAGE_TYPES.captureJobGet,
  {
    jobId: string;
  }
>;

export type CaptureJobHistoryItem = {
  jobId: string;
  status: Extract<JobStatus, 'completed' | 'failed' | 'cancelled'>;
  fileName: string;
  updatedAt: string;
  counters: JobCounters;
  archiveAvailable: boolean;
};

export type CaptureJobHistoryListRequest = ProtocolMessage<
  typeof MESSAGE_TYPES.captureJobHistoryList,
  { limit: number }
>;

export type CaptureJobHistoryResponse = ProtocolMessage<
  typeof MESSAGE_TYPES.captureJobHistoryResponse,
  { ok: true; items: CaptureJobHistoryItem[] } | { ok: false; error: CaptureError }
>;

export type CaptureJobDeleteRequest = ProtocolMessage<
  typeof MESSAGE_TYPES.captureJobDelete,
  { jobId: string }
>;

export type CaptureJobHistoryClearRequest = ProtocolMessage<
  typeof MESSAGE_TYPES.captureJobHistoryClear,
  Record<string, never>
>;

export type CaptureJobMutationResponse = ProtocolMessage<
  typeof MESSAGE_TYPES.captureJobMutationResponse,
  { ok: true; deletedCount: number } | { ok: false; error: CaptureError }
>;

export type CaptureResultStatus = Extract<JobStatus, 'completed' | 'failed' | 'cancelled'>;

export type CaptureResourceFailure = {
  url: string;
  resourceType: ResourceType;
  httpStatus: number | null;
  affectsPrimaryVisual: boolean;
  error: CaptureError;
};

export type CaptureJobResult = {
  jobId: string;
  status: CaptureResultStatus;
  fileName: string;
  archiveAvailable: boolean;
  archiveByteLength: number | null;
  counters: JobCounters;
  error: CaptureError | null;
  failures: CaptureResourceFailure[];
  omittedFailureCount: number;
};

export type CaptureJobResultGetRequest = ProtocolMessage<
  typeof MESSAGE_TYPES.captureJobResultGet,
  { jobId: string }
>;

export type CaptureJobResultResponse = ProtocolMessage<
  typeof MESSAGE_TYPES.captureJobResultResponse,
  { ok: true; result: CaptureJobResult } | { ok: false; error: CaptureError }
>;

export type CaptureArchiveChunkGetRequest = ProtocolMessage<
  typeof MESSAGE_TYPES.captureArchiveChunkGet,
  { jobId: string; offset: number }
>;

export type CaptureArchiveChunkResponse = ProtocolMessage<
  typeof MESSAGE_TYPES.captureArchiveChunkResponse,
  | {
      ok: true;
      jobId: string;
      offset: number;
      totalByteLength: number;
      base64: string;
      done: boolean;
    }
  | { ok: false; error: CaptureError }
>;

export type CaptureJobResponse = ProtocolMessage<
  typeof MESSAGE_TYPES.captureJobResponse,
  | {
      ok: true;
      job: CaptureJob;
    }
  | {
      ok: false;
      error: CaptureError;
    }
>;

export type CaptureJobUpdatedEvent = ProtocolMessage<
  typeof MESSAGE_TYPES.captureJobUpdated,
  {
    job: CaptureJob;
  }
>;

export type SiteCapsuleRequest =
  | PageInfoRequest
  | PageInfoCollectRequest
  | PageArchiveRewriteRequest
  | CaptureJobCreateRequest
  | CaptureJobControlRequest
  | CaptureJobGetRequest
  | CaptureJobHistoryListRequest
  | CaptureJobDeleteRequest
  | CaptureJobHistoryClearRequest
  | CaptureJobResultGetRequest
  | CaptureArchiveChunkGetRequest;

export type SiteCapsuleResponse =
  | PageInfoResponse
  | PageArchiveRewriteResponse
  | CaptureJobResponse
  | CaptureJobHistoryResponse
  | CaptureJobMutationResponse
  | CaptureJobResultResponse
  | CaptureArchiveChunkResponse;
export type SiteCapsuleEvent = CaptureJobUpdatedEvent;
export type SiteCapsuleMessage = SiteCapsuleRequest | SiteCapsuleResponse | SiteCapsuleEvent;

let correlationSequence = 0;

export function createCorrelationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  correlationSequence += 1;
  return `sitecapsule-${Date.now().toString(36)}-${correlationSequence.toString(36)}`;
}

function createMessage<TType extends MessageType, TPayload>(
  type: TType,
  payload: TPayload,
  correlationId = createCorrelationId(),
): ProtocolMessage<TType, TPayload> {
  return {
    protocolVersion: MESSAGE_PROTOCOL_VERSION,
    correlationId,
    type,
    payload,
  };
}

export function createPageInfoRequest(
  tabId: number,
  renderWaitMs: CaptureSettings['renderWaitMs'] = DEFAULT_RENDER_WAIT_MS,
  correlationId = createCorrelationId(),
): PageInfoRequest {
  return createMessage(MESSAGE_TYPES.pageInfoRequest, { tabId, renderWaitMs }, correlationId);
}

export function createPageInfoCollectRequest(
  tabUrl: string,
  renderWaitMs: CaptureSettings['renderWaitMs'] = DEFAULT_RENDER_WAIT_MS,
  correlationId = createCorrelationId(),
): PageInfoCollectRequest {
  return createMessage(MESSAGE_TYPES.pageInfoCollect, { tabUrl, renderWaitMs }, correlationId);
}

export function createPageInfoResponse(
  page: PageInfo,
  correlationId = createCorrelationId(),
): PageInfoResponse {
  return createMessage(MESSAGE_TYPES.pageInfoResponse, { ok: true, page }, correlationId);
}

export function createPageInfoError(
  error: CaptureError,
  correlationId = createCorrelationId(),
): PageInfoResponse {
  return createMessage(MESSAGE_TYPES.pageInfoResponse, { ok: false, error }, correlationId);
}

export function createPageArchiveRewriteRequest(
  payload: PageArchiveRewriteRequest['payload'],
  correlationId = createCorrelationId(),
): PageArchiveRewriteRequest {
  return createMessage(MESSAGE_TYPES.pageArchiveRewrite, payload, correlationId);
}

export function createPageArchiveRewriteResponse(
  html: string,
  rewrittenCount: number,
  correlationId = createCorrelationId(),
): PageArchiveRewriteResponse {
  return createMessage(
    MESSAGE_TYPES.pageArchiveRewriteResponse,
    { ok: true, html, rewrittenCount },
    correlationId,
  );
}

export function createPageArchiveRewriteError(
  error: CaptureError,
  correlationId = createCorrelationId(),
): PageArchiveRewriteResponse {
  return createMessage(
    MESSAGE_TYPES.pageArchiveRewriteResponse,
    { ok: false, error },
    correlationId,
  );
}

export function createCaptureJobCreateRequest(
  input: CaptureJobCreateInput,
  correlationId = createCorrelationId(),
): CaptureJobCreateRequest {
  return createMessage(MESSAGE_TYPES.captureJobCreate, input, correlationId);
}

export function createCaptureJobControlRequest(
  jobId: string,
  command: CaptureJobCommand,
  correlationId = createCorrelationId(),
): CaptureJobControlRequest {
  return createMessage(MESSAGE_TYPES.captureJobControl, { jobId, command }, correlationId);
}

export function createCaptureJobGetRequest(
  jobId: string,
  correlationId = createCorrelationId(),
): CaptureJobGetRequest {
  return createMessage(MESSAGE_TYPES.captureJobGet, { jobId }, correlationId);
}

export function createCaptureJobHistoryListRequest(
  limit = CAPTURE_JOB_HISTORY_LIMIT,
  correlationId = createCorrelationId(),
): CaptureJobHistoryListRequest {
  return createMessage(MESSAGE_TYPES.captureJobHistoryList, { limit }, correlationId);
}

export function createCaptureJobHistoryResponse(
  items: CaptureJobHistoryItem[],
  correlationId = createCorrelationId(),
): CaptureJobHistoryResponse {
  return createMessage(MESSAGE_TYPES.captureJobHistoryResponse, { ok: true, items }, correlationId);
}

export function createCaptureJobHistoryError(
  error: CaptureError,
  correlationId = createCorrelationId(),
): CaptureJobHistoryResponse {
  return createMessage(
    MESSAGE_TYPES.captureJobHistoryResponse,
    { ok: false, error },
    correlationId,
  );
}

export function createCaptureJobDeleteRequest(
  jobId: string,
  correlationId = createCorrelationId(),
): CaptureJobDeleteRequest {
  return createMessage(MESSAGE_TYPES.captureJobDelete, { jobId }, correlationId);
}

export function createCaptureJobHistoryClearRequest(
  correlationId = createCorrelationId(),
): CaptureJobHistoryClearRequest {
  return createMessage(MESSAGE_TYPES.captureJobHistoryClear, {}, correlationId);
}

export function createCaptureJobMutationResponse(
  deletedCount: number,
  correlationId = createCorrelationId(),
): CaptureJobMutationResponse {
  return createMessage(
    MESSAGE_TYPES.captureJobMutationResponse,
    { ok: true, deletedCount },
    correlationId,
  );
}

export function createCaptureJobMutationError(
  error: CaptureError,
  correlationId = createCorrelationId(),
): CaptureJobMutationResponse {
  return createMessage(
    MESSAGE_TYPES.captureJobMutationResponse,
    { ok: false, error },
    correlationId,
  );
}

export function createCaptureJobResultGetRequest(
  jobId: string,
  correlationId = createCorrelationId(),
): CaptureJobResultGetRequest {
  return createMessage(MESSAGE_TYPES.captureJobResultGet, { jobId }, correlationId);
}

export function createCaptureJobResultResponse(
  result: CaptureJobResult,
  correlationId = createCorrelationId(),
): CaptureJobResultResponse {
  return createMessage(MESSAGE_TYPES.captureJobResultResponse, { ok: true, result }, correlationId);
}

export function createCaptureJobResultError(
  error: CaptureError,
  correlationId = createCorrelationId(),
): CaptureJobResultResponse {
  return createMessage(MESSAGE_TYPES.captureJobResultResponse, { ok: false, error }, correlationId);
}

export function createCaptureArchiveChunkGetRequest(
  jobId: string,
  offset: number,
  correlationId = createCorrelationId(),
): CaptureArchiveChunkGetRequest {
  return createMessage(MESSAGE_TYPES.captureArchiveChunkGet, { jobId, offset }, correlationId);
}

export function createCaptureArchiveChunkResponse(
  payload: Omit<Extract<CaptureArchiveChunkResponse['payload'], { ok: true }>, 'ok'>,
  correlationId = createCorrelationId(),
): CaptureArchiveChunkResponse {
  return createMessage(
    MESSAGE_TYPES.captureArchiveChunkResponse,
    { ok: true, ...payload },
    correlationId,
  );
}

export function createCaptureArchiveChunkError(
  error: CaptureError,
  correlationId = createCorrelationId(),
): CaptureArchiveChunkResponse {
  return createMessage(
    MESSAGE_TYPES.captureArchiveChunkResponse,
    { ok: false, error },
    correlationId,
  );
}

export function createCaptureJobResponse(
  job: CaptureJob,
  correlationId = createCorrelationId(),
): CaptureJobResponse {
  return createMessage(MESSAGE_TYPES.captureJobResponse, { ok: true, job }, correlationId);
}

export function createCaptureJobError(
  error: CaptureError,
  correlationId = createCorrelationId(),
): CaptureJobResponse {
  return createMessage(MESSAGE_TYPES.captureJobResponse, { ok: false, error }, correlationId);
}

export function createCaptureJobUpdatedEvent(
  job: CaptureJob,
  correlationId = createCorrelationId(),
): CaptureJobUpdatedEvent {
  return createMessage(MESSAGE_TYPES.captureJobUpdated, { job }, correlationId);
}
