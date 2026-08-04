import { createArchiveDownloadFileName } from '@sitecapsule/archive';
import {
  DEFAULT_RENDER_WAIT_MS,
  MAX_RENDER_WAIT_MS,
  isRenderWaitMs,
  type CaptureSettings,
} from '@sitecapsule/domain';
import type { CaptureJobCreateInput } from '@sitecapsule/messaging/protocol';
import type { ThirdPartySiteAccessSummary } from '@sitecapsule/permissions';

export const DEFAULT_CURRENT_PAGE_ARCHIVE_FILE_NAME = 'sitecapsule-archive.zip';
export const DEFAULT_CURRENT_PAGE_CONCURRENCY = 6;
export const MIN_CURRENT_PAGE_CONCURRENCY = 1;
export const MAX_CURRENT_PAGE_CONCURRENCY = 12;
export const DEFAULT_CURRENT_PAGE_INCLUDE_MEDIA = false;
export const DEFAULT_CURRENT_PAGE_INCLUDE_SCRIPTS = false;
export const DEFAULT_CURRENT_PAGE_INCLUDE_THIRD_PARTY_RESOURCES = true;

export type ArchiveFileNameValidation =
  | { valid: true; fileName: string; message: null; suggestion: null }
  | { valid: false; fileName: null; message: string; suggestion: string | null };

export type CurrentPageArchiveNameState = {
  value: string;
  edited: boolean;
};

export type NumericSettingValidation =
  { valid: true; value: number; message: null } | { valid: false; value: null; message: string };

export type CurrentPageCaptureOptions = {
  renderWaitMs: number;
  maxConcurrentRequests: number;
  includeMedia: boolean;
  includeScripts: boolean;
  includeThirdPartyResources: boolean;
};

export type BuildCurrentPageTaskInput = {
  tabId: number;
  pageUrl: string;
  archiveFileName: string;
  renderWaitMs?: number;
  maxConcurrentRequests?: number;
  includeMedia?: boolean;
  includeScripts?: boolean;
  includeThirdPartyResources?: boolean;
};

function formatLocalDate(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}${month}${day}`;
}

function requireWebPageUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Current page URL must use HTTP or HTTPS.');
  }
  return url;
}

export function createDefaultCurrentPageArchiveFileName(
  pageUrl: string,
  date = new Date(),
): string {
  const url = requireWebPageUrl(pageUrl);
  const host = url.hostname.replace(/^www\./i, '') || 'archive';
  return createArchiveDownloadFileName(`sitecapsule-${host}-${formatLocalDate(date)}.zip`);
}

export function validateCurrentPageArchiveFileName(value: string): ArchiveFileNameValidation {
  const trimmed = value.trim();
  if (!trimmed) {
    return {
      valid: false,
      fileName: null,
      message: 'Enter a name for the ZIP file.',
      suggestion: null,
    };
  }

  const normalized = createArchiveDownloadFileName(trimmed);
  if (!trimmed.toLowerCase().endsWith('.zip')) {
    return {
      valid: false,
      fileName: null,
      message: 'The file name must end in .zip.',
      suggestion: normalized,
    };
  }
  if (value !== normalized) {
    return {
      valid: false,
      fileName: null,
      message: 'Use a portable file name without path separators or reserved characters.',
      suggestion: normalized,
    };
  }

  return { valid: true, fileName: normalized, message: null, suggestion: null };
}

function validateIntegerInput(
  value: string,
  label: string,
  minimum: number,
  maximum: number,
): NumericSettingValidation {
  const trimmed = value.trim();
  const sentenceLabel = `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
  if (!trimmed) {
    return { valid: false, value: null, message: `Enter ${label}.` };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { valid: false, value: null, message: `${sentenceLabel} must be a whole number.` };
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    return {
      valid: false,
      value: null,
      message: `${sentenceLabel} must be between ${minimum} and ${maximum}.`,
    };
  }
  return { valid: true, value: parsed, message: null };
}

export function validateRenderWaitInput(value: string): NumericSettingValidation {
  return validateIntegerInput(value, 'render wait', 0, MAX_RENDER_WAIT_MS);
}

export function validateConcurrencyInput(value: string): NumericSettingValidation {
  return validateIntegerInput(
    value,
    'concurrency',
    MIN_CURRENT_PAGE_CONCURRENCY,
    MAX_CURRENT_PAGE_CONCURRENCY,
  );
}

export function getPendingThirdPartyPermissionPatterns(
  access: readonly ThirdPartySiteAccessSummary[],
): string[] {
  return access
    .filter((entry) => entry.status === 'not-granted' && entry.defaultSelected)
    .map((entry) => entry.permissionPattern);
}

export function isThirdPartyCaptureReady(
  includeThirdPartyResources: boolean,
  access: readonly ThirdPartySiteAccessSummary[],
): boolean {
  return !includeThirdPartyResources || getPendingThirdPartyPermissionPatterns(access).length === 0;
}

export function createInitialCurrentPageArchiveName(): CurrentPageArchiveNameState {
  return { value: DEFAULT_CURRENT_PAGE_ARCHIVE_FILE_NAME, edited: false };
}

export function editCurrentPageArchiveName(value: string): CurrentPageArchiveNameState {
  return { value, edited: true };
}

export function applyCurrentPageToArchiveName(
  state: CurrentPageArchiveNameState,
  pageUrl: string,
  date = new Date(),
): CurrentPageArchiveNameState {
  if (state.edited) return state;
  return {
    value: createDefaultCurrentPageArchiveFileName(pageUrl, date),
    edited: false,
  };
}

export function createDefaultCurrentPageSettings(
  archiveFileName: string,
  options: Partial<CurrentPageCaptureOptions> = {},
): CaptureSettings {
  const fileName = validateCurrentPageArchiveFileName(archiveFileName);
  if (!fileName.valid) throw new TypeError(fileName.message);
  const renderWaitMs = options.renderWaitMs ?? DEFAULT_RENDER_WAIT_MS;
  const maxConcurrentRequests = options.maxConcurrentRequests ?? DEFAULT_CURRENT_PAGE_CONCURRENCY;
  if (!isRenderWaitMs(renderWaitMs)) {
    throw new TypeError(`Render wait must be between 0 and ${MAX_RENDER_WAIT_MS}.`);
  }
  if (
    !Number.isSafeInteger(maxConcurrentRequests) ||
    maxConcurrentRequests < MIN_CURRENT_PAGE_CONCURRENCY ||
    maxConcurrentRequests > MAX_CURRENT_PAGE_CONCURRENCY
  ) {
    throw new TypeError(
      `Concurrency must be between ${MIN_CURRENT_PAGE_CONCURRENCY} and ${MAX_CURRENT_PAGE_CONCURRENCY}.`,
    );
  }

  return {
    archiveFileName: fileName.fileName,
    renderWaitMs,
    maxConcurrentRequests,
    includeMedia: options.includeMedia ?? DEFAULT_CURRENT_PAGE_INCLUDE_MEDIA,
    includeScripts: options.includeScripts ?? DEFAULT_CURRENT_PAGE_INCLUDE_SCRIPTS,
    includeThirdPartyResources:
      options.includeThirdPartyResources ?? DEFAULT_CURRENT_PAGE_INCLUDE_THIRD_PARTY_RESOURCES,
    autoScroll: false,
    maxDepth: 0,
    maxPages: 1,
    allowedUrlPatterns: [],
    blockedUrlPatterns: [],
    maxFileSizeBytes: null,
    maxTotalSizeBytes: null,
  };
}

export function buildCurrentPageTaskInput(input: BuildCurrentPageTaskInput): CaptureJobCreateInput {
  if (!Number.isSafeInteger(input.tabId) || input.tabId < 0) {
    throw new TypeError('Current page tab ID must be a non-negative safe integer.');
  }
  const pageUrl = requireWebPageUrl(input.pageUrl).href;

  return {
    tabId: input.tabId,
    startUrl: pageUrl,
    mode: 'current-page',
    profile: 'standard',
    settings: createDefaultCurrentPageSettings(input.archiveFileName, {
      ...(input.renderWaitMs === undefined ? {} : { renderWaitMs: input.renderWaitMs }),
      ...(input.maxConcurrentRequests === undefined
        ? {}
        : { maxConcurrentRequests: input.maxConcurrentRequests }),
      ...(input.includeMedia === undefined ? {} : { includeMedia: input.includeMedia }),
      ...(input.includeScripts === undefined ? {} : { includeScripts: input.includeScripts }),
      ...(input.includeThirdPartyResources === undefined
        ? {}
        : { includeThirdPartyResources: input.includeThirdPartyResources }),
    }),
  };
}
