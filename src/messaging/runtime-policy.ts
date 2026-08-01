import {
  MESSAGE_TYPES,
  type PageArchiveRewriteRequest,
  type PageInfoCollectRequest,
  type PageInfoRequest,
  type CaptureArchiveChunkGetRequest,
  type CaptureJobControlRequest,
  type CaptureJobCreateRequest,
  type CaptureJobDeleteRequest,
  type CaptureJobGetRequest,
  type CaptureJobHistoryClearRequest,
  type CaptureJobHistoryListRequest,
  type CaptureJobResultGetRequest,
} from './protocol';
import {
  isCaptureArchiveChunkGetRequest,
  isCaptureJobControlRequest,
  isCaptureJobCreateRequest,
  isCaptureJobDeleteRequest,
  isCaptureJobGetRequest,
  isCaptureJobHistoryClearRequest,
  isCaptureJobHistoryListRequest,
  isCaptureJobResultGetRequest,
  isPageArchiveRewriteRequest,
  isPageInfoCollectRequest,
  isPageInfoRequest,
} from './validators';

export const BACKGROUND_RUNTIME_REQUEST_TYPES = [
  MESSAGE_TYPES.pageInfoRequest,
  MESSAGE_TYPES.captureJobCreate,
  MESSAGE_TYPES.captureJobControl,
  MESSAGE_TYPES.captureJobGet,
  MESSAGE_TYPES.captureJobHistoryList,
  MESSAGE_TYPES.captureJobDelete,
  MESSAGE_TYPES.captureJobHistoryClear,
  MESSAGE_TYPES.captureJobResultGet,
  MESSAGE_TYPES.captureArchiveChunkGet,
] as const;

export const CONTENT_RUNTIME_REQUEST_TYPES = [
  MESSAGE_TYPES.pageInfoCollect,
  MESSAGE_TYPES.pageArchiveRewrite,
] as const;

export type BackgroundRuntimeRequest =
  | PageInfoRequest
  | CaptureJobCreateRequest
  | CaptureJobControlRequest
  | CaptureJobGetRequest
  | CaptureJobHistoryListRequest
  | CaptureJobDeleteRequest
  | CaptureJobHistoryClearRequest
  | CaptureJobResultGetRequest
  | CaptureArchiveChunkGetRequest;

export type ContentRuntimeRequest = PageInfoCollectRequest | PageArchiveRewriteRequest;

export type RuntimeMessageSenderLike = {
  id?: string;
  url?: string;
  tab?: unknown;
};

function isOwnExtensionDocument(
  sender: RuntimeMessageSenderLike,
  runtimeId: string,
  path: string,
): boolean {
  if (sender.id !== runtimeId || typeof sender.url !== 'string') {
    return false;
  }
  let url: URL;
  try {
    url = new URL(sender.url);
  } catch {
    return false;
  }
  return (
    url.protocol === 'chrome-extension:' &&
    url.hostname === runtimeId &&
    url.pathname === path &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === ''
  );
}

export function isTrustedSidePanelSender(
  sender: RuntimeMessageSenderLike,
  runtimeId: string,
): boolean {
  return isOwnExtensionDocument(sender, runtimeId, '/sidepanel.html');
}

export function isTrustedBackgroundSender(
  sender: RuntimeMessageSenderLike,
  runtimeId: string,
): boolean {
  if (sender.id !== runtimeId) return false;
  if (sender.url === undefined) return sender.tab === undefined;
  if (sender.tab !== undefined) return false;
  return isOwnExtensionDocument(sender, runtimeId, '/background.js');
}

export function isBackgroundRuntimeRequest(message: unknown): message is BackgroundRuntimeRequest {
  return (
    isPageInfoRequest(message) ||
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

export function isContentRuntimeRequest(message: unknown): message is ContentRuntimeRequest {
  return isPageInfoCollectRequest(message) || isPageArchiveRewriteRequest(message);
}
