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
import { sanitizeClonedDom } from './sanitize-cloned-dom';

export type DocumentTypeSource = Pick<DocumentType, 'name' | 'publicId' | 'systemId'>;

export type DocumentSnapshotSource = PageMetadataSource &
  PageRegionSource & {
    doctype: DocumentTypeSource | null;
    documentElement: Pick<Document['documentElement'], 'cloneNode'>;
    defaultView: { performance: PerformanceResourceSource } | null;
  };

export type PageSnapshot = PageMetadata & {
  serializedDom: string;
  domResources: DomResourceCandidate[];
  regionDiagnostics: PageRegionDiagnostics;
  performanceResources: PerformanceResourceRecord[];
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
  const clonedRoot = source.documentElement.cloneNode(true) as Element;
  sanitizeClonedDom(clonedRoot);
  const doctype = serializeDocumentType(source.doctype);

  return doctype ? `${doctype}\n${clonedRoot.outerHTML}` : clonedRoot.outerHTML;
}

export function capturePageSnapshot(
  source: DocumentSnapshotSource,
  tabUrl = source.URL,
): PageSnapshot {
  return {
    ...readPageMetadata(source, tabUrl),
    serializedDom: serializeDocument(source),
    domResources: discoverDomResources(source),
    regionDiagnostics: inspectPageRegions(source),
    performanceResources: collectPerformanceResources(source.defaultView?.performance ?? null),
  };
}
import { discoverDomResources, type DomResourceCandidate } from '@sitecapsule/discovery';
