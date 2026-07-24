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
