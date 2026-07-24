export {
  capturePageSnapshot,
  serializeDocument,
  serializeDocumentType,
  type DocumentSnapshotSource,
  type DocumentTypeSource,
  type PageSnapshot,
} from './document-snapshot';
export { readPageMetadata, type PageMetadata, type PageMetadataSource } from './page-metadata';
export {
  collectPerformanceResources,
  PERFORMANCE_RESOURCE_INITIATORS,
  type PerformanceResourceInitiator,
  type PerformanceResourceRecord,
  type PerformanceResourceSource,
} from './performance-resources';
export {
  isMergedResourceCandidate,
  isMergedResourceCandidates,
  isResourceDiscoveryEvidence,
  matchesMergedResourceCandidates,
  MERGED_RESOURCE_DISCOVERY_SOURCES,
  mergeResourceCandidates,
  RESOURCE_DISCOVERY_CHANNELS,
  type CssResourceEvidence,
  type DomResourceEvidence,
  type MergedResourceCandidate,
  type MergedResourceDiscoverySource,
  type MergeResourceCandidatesInput,
  type PerformanceResourceEvidence,
  type ResourceDiscoveryChannel,
  type ResourceDiscoveryEvidence,
  type SvgResourceEvidence,
} from './resource-discovery';
export {
  getPageCaptureTimeoutMs,
  PAGE_CAPTURE_TIMEOUT_GRACE_MS,
  runPageCaptureSession,
  type PageCaptureLifecycleEvent,
  type PageCaptureSessionOptions,
  type PageCaptureSessionResult,
} from './page-capture-session';
export {
  inspectPageRegions,
  PAGE_REGION_LIMITATIONS,
  type IframeRegionDiagnostic,
  type IframeRegionReason,
  type PageRegionDiagnostic,
  type PageRegionDiagnostics,
  type PageRegionLimitation,
  type PageRegionSource,
  type ShadowRootRegionDiagnostic,
} from './page-regions';
export { waitForRender, type RenderWaitScheduler } from './render-wait';
export { isSensitiveFieldIdentifier, sanitizeClonedDom } from './sanitize-cloned-dom';
