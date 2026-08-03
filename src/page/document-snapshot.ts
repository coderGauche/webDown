import {
  discoverCssResources,
  discoverDomResources,
  discoverEmbeddedResources,
  type CssResourceCandidate,
  type DomResourceCandidate,
  type EmbeddedCssSource,
  type SvgResourceCandidate,
} from '@sitecapsule/discovery';
import { readPageMetadata, type PageMetadata, type PageMetadataSource } from './page-metadata';
import {
  collectPerformanceResources,
  type PerformanceResourceRecord,
  type PerformanceResourceSource,
} from './performance-resources';
import {
  inspectPageRegions,
  type PageRegionDiagnostics,
  type PageRegionSource,
} from './page-regions';
import { mergeResourceCandidates, type MergedResourceCandidate } from './resource-discovery';
import { buildResourceGraph, type ResourceGraph } from './resource-graph';
import { sanitizeClonedDom, type DomCleanupReport } from './sanitize-cloned-dom';

export type DocumentTypeSource = Pick<DocumentType, 'name' | 'publicId' | 'systemId'>;

export type DocumentSnapshotSource = PageMetadataSource &
  PageRegionSource & {
    doctype: DocumentTypeSource | null;
    documentElement: Pick<Document['documentElement'], 'cloneNode'>;
    defaultView: { performance: PerformanceResourceSource } | null;
  };

export type PageSnapshot = PageMetadata & {
  serializedDom: string;
  cleanupReport: DomCleanupReport;
  domResources: DomResourceCandidate[];
  cssSources: EmbeddedCssSource[];
  cssResources: CssResourceCandidate[];
  svgResources: SvgResourceCandidate[];
  regionDiagnostics: PageRegionDiagnostics;
  performanceResources: PerformanceResourceRecord[];
  mergedResources: MergedResourceCandidate[];
  resourceGraph: ResourceGraph;
};

function quoteDocumentTypeIdentifier(value: string): string {
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  return `"${value.replaceAll('"', '&quot;')}"`;
}

export function serializeDocumentType(doctype: DocumentTypeSource | null): string {
  if (!doctype) return '';

  const name = doctype.name || 'html';
  if (doctype.publicId) {
    const systemId = doctype.systemId ? ` ${quoteDocumentTypeIdentifier(doctype.systemId)}` : '';
    return `<!DOCTYPE ${name} PUBLIC ${quoteDocumentTypeIdentifier(doctype.publicId)}${systemId}>`;
  }
  if (doctype.systemId) {
    return `<!DOCTYPE ${name} SYSTEM ${quoteDocumentTypeIdentifier(doctype.systemId)}>`;
  }

  return `<!DOCTYPE ${name}>`;
}

export function serializeDocument(
  source: Pick<DocumentSnapshotSource, 'doctype' | 'documentElement'>,
): string {
  return serializeDocumentWithCleanup(source).serializedDom;
}

export function serializeDocumentWithCleanup(
  source: Pick<DocumentSnapshotSource, 'doctype' | 'documentElement'> &
    Partial<Pick<DocumentSnapshotSource, 'URL'>>,
): Pick<PageSnapshot, 'serializedDom' | 'cleanupReport'> {
  const clonedRoot = source.documentElement.cloneNode(true) as Element;
  const cleanupReport = sanitizeClonedDom(clonedRoot, source.URL ?? 'about:blank');
  const doctype = serializeDocumentType(source.doctype);
  const serializedDom = doctype ? `${doctype}\n${clonedRoot.outerHTML}` : clonedRoot.outerHTML;

  return { serializedDom, cleanupReport };
}

export function capturePageSnapshot(
  source: DocumentSnapshotSource,
  tabUrl = source.URL,
): PageSnapshot {
  const embeddedResources = discoverEmbeddedResources(source);
  const cssResources = discoverCssResources(embeddedResources.cssSources);
  const domResources = discoverDomResources(source);
  const performanceResources = collectPerformanceResources(source.defaultView?.performance ?? null);
  const mergedResources = mergeResourceCandidates({
    domResources,
    svgResources: embeddedResources.svgResources,
    cssResources,
    performanceResources,
  });
  const metadata = readPageMetadata(source, tabUrl);
  const serialized = serializeDocumentWithCleanup(source);

  return {
    ...metadata,
    ...serialized,
    domResources,
    ...embeddedResources,
    cssResources,
    regionDiagnostics: inspectPageRegions(source),
    performanceResources,
    mergedResources,
    resourceGraph: buildResourceGraph(metadata.finalUrl, mergedResources),
  };
}
