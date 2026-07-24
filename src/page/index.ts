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
export { isNormalizedResourceUrl, normalizeResourceUrl } from './resource-url';
export {
  inferResourceMetadata,
  isResourceInferenceEvidence,
  isResourceMetadataInference,
  matchesResourceMetadataInference,
  RESOURCE_INFERENCE_CONFIDENCES,
  RESOURCE_INFERENCE_SOURCES,
  type ResourceInferenceConfidence,
  type ResourceInferenceEvidence,
  type ResourceInferenceSource,
  type ResourceMetadataInference,
} from './resource-inference';
export {
  classifyResourceUrl,
  DATA_URL_ENCODINGS,
  isResourceUrlClassification,
  matchesResourceUrlClassification,
  RESOURCE_URL_KINDS,
  UNSUPPORTED_RESOURCE_REASONS,
  type BlobResourceUrlClassification,
  type DataResourceUrlClassification,
  type DataUrlEncoding,
  type NetworkResourceUrlClassification,
  type ResourceUrlClassification,
  type ResourceUrlKind,
  type UnsupportedResourceReason,
  type UnsupportedResourceUrlClassification,
} from './resource-protocol';
export {
  buildResourceGraph,
  isResourceGraph,
  isResourceGraphEdge,
  isResourceGraphNode,
  matchesResourceGraph,
  type ResourceGraph,
  type ResourceGraphEdge,
  type ResourceGraphNode,
} from './resource-graph';
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
