export {
  ARCHIVE_ASSET_ROOT,
  RESOURCE_TYPE_DIRECTORIES,
  createResourceDirectoryMapping,
  createResourceOriginDirectory,
  getResourceTypeDirectory,
  type ResourceDirectoryMapping,
  type ResourceOriginDirectory,
  type ResourceTypeDirectory,
} from './resource-directory';
export {
  PORTABLE_FILE_EXTENSION_MAX_BYTES,
  PORTABLE_FILE_NAME_MAX_BYTES,
  RESOURCE_TYPE_FALLBACK_FILE_NAMES,
  appendArchiveFileNameSuffix,
  createResourceFileName,
  sanitizeArchiveFileName,
} from './resource-file-name';
export {
  ARCHIVE_HASH_HEX_LENGTH,
  createQueryHash,
  createResourcePathMappings,
  createStableArchiveHash,
  type ResourcePathInput,
  type ResourcePathMapping,
} from './resource-path-mapping';
export {
  rewriteHtmlResource,
  type HtmlBaseHrefRemoval,
  type HtmlCssRewriteResult,
  type HtmlDomParser,
  type HtmlReferenceResult,
  type HtmlRewriteResult,
  type HtmlSrcsetRewriteResult,
  type RewriteHtmlResourceOptions,
} from './html-rewriter';
export { createLocalArchiveReference, createRelativeArchivePath } from './rewrite-support';
export {
  CSS_REWRITE_CONTEXTS,
  rewriteCssResource,
  type CssReferenceResult,
  type CssRewriteContext,
  type CssRewriteKind,
  type CssRewriteResult,
  type RewriteCssResourceOptions,
} from './css-rewriter';
export {
  rewriteSrcsetResource,
  type RewriteSrcsetResourceOptions,
  type SrcsetReferenceResult,
  type SrcsetRewriteResult,
} from './srcset-rewriter';
export {
  UNCAPTURED_DEPENDENCY_CHANNELS,
  UNCAPTURED_DEPENDENCY_REASONS,
  collectUncapturedDependencies,
  type CollectUncapturedDependenciesOptions,
  type CssDependencySource,
  type HtmlDependencySource,
  type RetainedReferenceCounts,
  type SrcsetDependencySource,
  type UncapturedDependency,
  type UncapturedDependencyChannel,
  type UncapturedDependencyReason,
  type UncapturedDependencyReport,
  type UncapturedDependencySource,
} from './uncaptured-dependencies';
export {
  SERVICE_WORKER_BLOCK_FUNCTION,
  SERVICE_WORKER_POLICY_ATTRIBUTE,
  SERVICE_WORKER_POLICY_LIMITATIONS,
  SERVICE_WORKER_POLICY_VALUE,
  SERVICE_WORKER_SCRIPT_KINDS,
  SERVICE_WORKER_SCRIPT_STATUSES,
  applyServiceWorkerSafetyPolicy,
  type ServiceWorkerPolicyLimitation,
  type ServiceWorkerRegistrationChange,
  type ServiceWorkerSafetyResult,
  type ServiceWorkerScriptKind,
  type ServiceWorkerScriptResult,
  type ServiceWorkerScriptStatus,
} from './service-worker-safety';
