import {
  DEFAULT_RENDER_WAIT_MS,
  type CaptureError,
  type CaptureJob,
  type CaptureMode,
  type CaptureProfile,
  type CaptureSettings,
} from '@sitecapsule/domain';
import type { PageSnapshot } from '@sitecapsule/page';

export const MESSAGE_PROTOCOL_VERSION = 10 as const;

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
