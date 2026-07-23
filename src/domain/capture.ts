export const CAPTURE_MODES = ['current-page', 'site-crawl'] as const;
export const CAPTURE_PROFILES = ['standard', 'deep'] as const;
export const JOB_STATUSES = [
  'idle',
  'preparing',
  'discovering',
  'fetching',
  'rewriting',
  'packaging',
  'completed',
  'paused',
  'cancelling',
  'cancelled',
  'failed',
  'retrying',
] as const;

export const PAUSABLE_JOB_STATUSES = [
  'preparing',
  'discovering',
  'fetching',
  'rewriting',
  'packaging',
  'retrying',
] as const satisfies readonly (typeof JOB_STATUSES)[number][];

export const RESOURCE_TYPES = [
  'document',
  'stylesheet',
  'image',
  'font',
  'script',
  'video',
  'audio',
  'wasm',
  'manifest',
  'model',
  'texture',
  'data',
  'other',
] as const;

export const RESOURCE_STATES = [
  'discovered',
  'queued',
  'fetching',
  'saved',
  'failed',
  'skipped',
] as const;

export const RESOURCE_DISCOVERY_SOURCES = ['dom', 'css', 'performance', 'cdp', 'crawler'] as const;

export type CaptureMode = (typeof CAPTURE_MODES)[number];
export type CaptureProfile = (typeof CAPTURE_PROFILES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type ResourceType = (typeof RESOURCE_TYPES)[number];
export type ResourceState = (typeof RESOURCE_STATES)[number];
export type ResourceDiscoverySource = (typeof RESOURCE_DISCOVERY_SOURCES)[number];
export type PausableJobStatus = (typeof PAUSABLE_JOB_STATUSES)[number];

export type JobState =
  | {
      status: 'paused';
      resumeStatus: PausableJobStatus;
    }
  | {
      status: Exclude<JobStatus, 'paused'>;
      resumeStatus?: never;
    };

export type CaptureSettings = {
  archiveFileName: string;
  renderWaitMs: number;
  maxConcurrentRequests: number;
  includeMedia: boolean;
  includeScripts: boolean;
  includeThirdPartyResources: boolean;
  autoScroll: boolean;
  maxDepth: number;
  maxPages: number;
  allowedUrlPatterns: string[];
  blockedUrlPatterns: string[];
  maxFileSizeBytes: number | null;
  maxTotalSizeBytes: number | null;
};

export type JobCounters = {
  pagesDiscovered: number;
  pagesCaptured: number;
  resourcesDiscovered: number;
  resourcesSaved: number;
  resourcesFailed: number;
  resourcesSkipped: number;
  bytesWritten: number;
};

type CaptureJobDetails = {
  id: string;
  tabId: number;
  startUrl: string;
  mode: CaptureMode;
  profile: CaptureProfile;
  settings: CaptureSettings;
  counters: JobCounters;
  createdAt: string;
  updatedAt: string;
};

export type CaptureJob = CaptureJobDetails & JobState;

export type ResourceRecord = {
  id: string;
  jobId: string;
  originalUrl: string;
  finalUrl?: string;
  referrerUrl: string;
  type: ResourceType;
  discoverySources: ResourceDiscoverySource[];
  mimeType?: string;
  httpStatus?: number;
  localPath?: string;
  byteLength?: number;
  sha256?: string;
  state: ResourceState;
  error?: CaptureError;
};
import type { CaptureError } from './errors';
