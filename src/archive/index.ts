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
