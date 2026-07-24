import { JOB_STATUSES, RESOURCE_TYPES, type JobStatus, type ResourceType } from './capture';

export const CAPTURE_ERROR_CODES = [
  'protocol-invalid-message',
  'page-unavailable',
  'page-capture-timeout',
  'page-navigation-changed',
  'tab-closed',
  'content-script-injection-failed',
  'content-script-unresponsive',
  'job-not-found',
  'invalid-job-transition',
  'invalid-job-counter',
  'storage-conflict',
  'storage-unavailable',
  'permission-denied',
  'network-request-failed',
  'resource-limit-exceeded',
  'capture-cancelled',
  'unexpected-error',
] as const;

export const CAPTURE_ERROR_OPERATIONS = [
  'page-info',
  'page-capture',
  'content-script-injection',
  'content-script-response',
  'job-transition',
  'job-counter-update',
  'job-create',
  'job-read',
  'job-list',
  'job-update',
  'job-delete',
  'job-cleanup',
  'resource-download',
  'archive-package',
] as const;

export type CaptureErrorCode = (typeof CAPTURE_ERROR_CODES)[number];
export type CaptureErrorOperation = (typeof CAPTURE_ERROR_OPERATIONS)[number];

export type CaptureErrorContext = {
  operation?: CaptureErrorOperation;
  jobId?: string;
  resourceId?: string;
  url?: string;
  resourceType?: ResourceType;
  stage?: JobStatus;
  targetStage?: JobStatus;
  field?: string;
  httpStatus?: number;
  browserError?: string;
  affectsPrimaryVisual?: boolean;
};

export type CaptureError = {
  code: CaptureErrorCode;
  message: string;
  retryable: boolean;
  suggestion?: string;
  context?: CaptureErrorContext;
};

type CaptureErrorDefinition = Pick<CaptureError, 'message' | 'retryable' | 'suggestion'>;

export const CAPTURE_ERROR_CATALOG = {
  'protocol-invalid-message': {
    message: '扩展收到了无法识别的消息。',
    retryable: true,
    suggestion: '重试操作；如问题持续，请重新加载扩展。',
  },
  'page-unavailable': {
    message: '当前标签页不可用。',
    retryable: false,
    suggestion: '请切换到普通的 HTTP 或 HTTPS 网页后重试。',
  },
  'page-capture-timeout': {
    message: '页面捕获超时。',
    retryable: true,
    suggestion: '请缩短渲染等待时间或在页面稳定后重试。',
  },
  'page-navigation-changed': {
    message: '捕获期间页面发生了跳转。',
    retryable: true,
    suggestion: '请等待目标页面稳定后重新捕获。',
  },
  'tab-closed': {
    message: '捕获期间标签页已关闭。',
    retryable: false,
    suggestion: '请打开需要归档的页面后创建新任务。',
  },
  'content-script-injection-failed': {
    message: '当前页面不允许注入内容脚本。',
    retryable: false,
    suggestion: '请确认页面不是浏览器内部页面，并检查站点权限。',
  },
  'content-script-unresponsive': {
    message: '内容脚本未能返回页面信息。',
    retryable: true,
    suggestion: '请等待页面加载完成后重试。',
  },
  'job-not-found': {
    message: '任务不存在或已被清理。',
    retryable: false,
    suggestion: '请刷新任务列表或创建新任务。',
  },
  'invalid-job-transition': {
    message: '任务当前状态不允许执行此操作。',
    retryable: false,
    suggestion: '请刷新任务状态后再选择可用操作。',
  },
  'invalid-job-counter': {
    message: '任务进度数据无效。',
    retryable: false,
    suggestion: '请重新启动该任务。',
  },
  'storage-conflict': {
    message: '本地任务数据发生冲突。',
    retryable: true,
    suggestion: '请刷新任务状态后重试。',
  },
  'storage-unavailable': {
    message: '本地任务存储暂时不可用。',
    retryable: true,
    suggestion: '请重新加载扩展后重试。',
  },
  'permission-denied': {
    message: '缺少执行此操作所需的浏览器权限。',
    retryable: true,
    suggestion: '请授予当前站点权限后重试。',
  },
  'network-request-failed': {
    message: '资源请求失败。',
    retryable: true,
    suggestion: '请检查网络和站点可用性后重试。',
  },
  'resource-limit-exceeded': {
    message: '资源超出当前任务的大小限制。',
    retryable: false,
    suggestion: '请提高体积上限或排除该资源。',
  },
  'capture-cancelled': {
    message: '任务已取消。',
    retryable: false,
    suggestion: '需要时请创建新的归档任务。',
  },
  'unexpected-error': {
    message: '扩展发生了未预期的错误。',
    retryable: true,
    suggestion: '请重试操作；如问题持续，请重新加载扩展。',
  },
} as const satisfies Record<CaptureErrorCode, CaptureErrorDefinition>;

type UnknownRecord = Record<string, unknown>;

const CONTEXT_KEYS = [
  'operation',
  'jobId',
  'resourceId',
  'url',
  'resourceType',
  'stage',
  'targetStage',
  'field',
  'httpStatus',
  'browserError',
  'affectsPrimaryVisual',
] as const;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.trim().length > 0);
}

export function isCaptureErrorContext(value: unknown): value is CaptureErrorContext {
  if (!isRecord(value) || !hasOnlyKeys(value, CONTEXT_KEYS)) return false;

  return (
    (value.operation === undefined ||
      CAPTURE_ERROR_OPERATIONS.includes(value.operation as CaptureErrorOperation)) &&
    isOptionalNonEmptyString(value.jobId) &&
    isOptionalNonEmptyString(value.resourceId) &&
    isOptionalNonEmptyString(value.url) &&
    (value.resourceType === undefined ||
      RESOURCE_TYPES.includes(value.resourceType as ResourceType)) &&
    (value.stage === undefined || JOB_STATUSES.includes(value.stage as JobStatus)) &&
    (value.targetStage === undefined || JOB_STATUSES.includes(value.targetStage as JobStatus)) &&
    isOptionalNonEmptyString(value.field) &&
    (value.httpStatus === undefined ||
      (Number.isInteger(value.httpStatus) &&
        (value.httpStatus as number) >= 100 &&
        (value.httpStatus as number) <= 599)) &&
    isOptionalNonEmptyString(value.browserError) &&
    (value.affectsPrimaryVisual === undefined || typeof value.affectsPrimaryVisual === 'boolean')
  );
}

export function isCaptureError(value: unknown): value is CaptureError {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['code', 'message', 'retryable', 'suggestion', 'context'])
  ) {
    return false;
  }

  if (!CAPTURE_ERROR_CODES.includes(value.code as CaptureErrorCode)) return false;

  const definition = CAPTURE_ERROR_CATALOG[value.code as CaptureErrorCode];
  return (
    value.message === definition.message &&
    value.retryable === definition.retryable &&
    value.suggestion === definition.suggestion &&
    (value.context === undefined || isCaptureErrorContext(value.context))
  );
}

export function createCaptureError(
  code: CaptureErrorCode,
  context?: CaptureErrorContext,
): CaptureError {
  const definition = CAPTURE_ERROR_CATALOG[code];

  return {
    code,
    ...definition,
    ...(context && Object.keys(context).length > 0 ? { context } : {}),
  };
}

export class SiteCapsuleError extends Error {
  readonly details: CaptureError;

  constructor(details: CaptureError, options: { cause?: unknown } = {}) {
    super(details.message, options);
    this.name = 'SiteCapsuleError';
    this.details = details;
  }
}

export function toCaptureError(
  error: unknown,
  fallbackCode: CaptureErrorCode = 'unexpected-error',
  context: CaptureErrorContext = {},
): CaptureError {
  if (error instanceof SiteCapsuleError) return error.details;
  if (isCaptureError(error)) return error;

  const browserError =
    error instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name)
      ? error.name
      : undefined;
  return createCaptureError(fallbackCode, {
    ...context,
    ...(browserError && context.browserError === undefined ? { browserError } : {}),
  });
}

export function toSiteCapsuleError(
  error: unknown,
  fallbackCode: CaptureErrorCode = 'unexpected-error',
  context: CaptureErrorContext = {},
): SiteCapsuleError {
  if (error instanceof SiteCapsuleError) return error;
  return new SiteCapsuleError(toCaptureError(error, fallbackCode, context), { cause: error });
}
