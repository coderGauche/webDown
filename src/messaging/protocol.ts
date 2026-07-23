import type { CaptureJob, CaptureMode, CaptureProfile, CaptureSettings } from '@sitecapsule/domain';

export const MESSAGE_PROTOCOL_VERSION = 1 as const;

export const MESSAGE_TYPES = {
  pageInfoRequest: 'page-info/request',
  pageInfoCollect: 'page-info/collect',
  pageInfoResponse: 'page-info/response',
  captureJobCreate: 'capture-job/create',
  captureJobControl: 'capture-job/control',
  captureJobGet: 'capture-job/get',
  captureJobResponse: 'capture-job/response',
  captureJobUpdated: 'capture-job/updated',
} as const;

export const CAPTURE_JOB_COMMANDS = ['pause', 'resume', 'cancel', 'retry'] as const;

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

export type PageInfo = {
  title: string;
  url: string;
};

export type PageInfoRequest = ProtocolMessage<
  typeof MESSAGE_TYPES.pageInfoRequest,
  {
    tabId: number;
  }
>;

export type PageInfoCollectRequest = ProtocolMessage<
  typeof MESSAGE_TYPES.pageInfoCollect,
  Record<string, never>
>;

export type PageInfoResponse = ProtocolMessage<
  typeof MESSAGE_TYPES.pageInfoResponse,
  | {
      ok: true;
      page: PageInfo;
    }
  | {
      ok: false;
      error: string;
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

export type CaptureJobResponse = ProtocolMessage<
  typeof MESSAGE_TYPES.captureJobResponse,
  | {
      ok: true;
      job: CaptureJob;
    }
  | {
      ok: false;
      error: string;
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
  | CaptureJobCreateRequest
  | CaptureJobControlRequest
  | CaptureJobGetRequest;

export type SiteCapsuleResponse = PageInfoResponse | CaptureJobResponse;
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
  correlationId = createCorrelationId(),
): PageInfoRequest {
  return createMessage(MESSAGE_TYPES.pageInfoRequest, { tabId }, correlationId);
}

export function createPageInfoCollectRequest(
  correlationId = createCorrelationId(),
): PageInfoCollectRequest {
  return createMessage(MESSAGE_TYPES.pageInfoCollect, {}, correlationId);
}

export function createPageInfoResponse(
  page: PageInfo,
  correlationId = createCorrelationId(),
): PageInfoResponse {
  return createMessage(MESSAGE_TYPES.pageInfoResponse, { ok: true, page }, correlationId);
}

export function createPageInfoError(
  error: string,
  correlationId = createCorrelationId(),
): PageInfoResponse {
  return createMessage(MESSAGE_TYPES.pageInfoResponse, { ok: false, error }, correlationId);
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

export function createCaptureJobResponse(
  job: CaptureJob,
  correlationId = createCorrelationId(),
): CaptureJobResponse {
  return createMessage(MESSAGE_TYPES.captureJobResponse, { ok: true, job }, correlationId);
}

export function createCaptureJobError(
  error: string,
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

function hasSupportedEnvelope(message: unknown): message is ProtocolMessage<MessageType, unknown> {
  if (!message || typeof message !== 'object') return false;

  const candidate = message as {
    protocolVersion?: unknown;
    correlationId?: unknown;
    type?: unknown;
    payload?: unknown;
  };

  return (
    candidate.protocolVersion === MESSAGE_PROTOCOL_VERSION &&
    typeof candidate.correlationId === 'string' &&
    candidate.correlationId.length > 0 &&
    typeof candidate.type === 'string' &&
    'payload' in candidate
  );
}

export function isPageInfoRequest(message: unknown): message is PageInfoRequest {
  if (!hasSupportedEnvelope(message) || message.type !== MESSAGE_TYPES.pageInfoRequest)
    return false;

  const payload = message.payload as Partial<PageInfoRequest['payload']> | undefined;
  return !!payload && typeof payload === 'object' && Number.isInteger(payload.tabId);
}

export function isPageInfoCollectRequest(message: unknown): message is PageInfoCollectRequest {
  return hasSupportedEnvelope(message) && message.type === MESSAGE_TYPES.pageInfoCollect;
}

export function isPageInfoResponse(message: unknown): message is PageInfoResponse {
  if (!hasSupportedEnvelope(message) || message.type !== MESSAGE_TYPES.pageInfoResponse)
    return false;

  const payload = message.payload as {
    ok?: unknown;
    page?: unknown;
    error?: unknown;
  } | null;
  if (!payload || typeof payload !== 'object' || typeof payload.ok !== 'boolean') return false;

  if (payload.ok) {
    const page = payload.page as Partial<PageInfo> | undefined;
    return (
      !!page &&
      typeof page === 'object' &&
      typeof page.title === 'string' &&
      typeof page.url === 'string'
    );
  }

  return typeof payload.error === 'string';
}
