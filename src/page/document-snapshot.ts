import { readPageMetadata, type PageMetadata, type PageMetadataSource } from './page-metadata';
import { sanitizeClonedDom } from './sanitize-cloned-dom';

export type DocumentTypeSource = Pick<DocumentType, 'name' | 'publicId' | 'systemId'>;

export type DocumentSnapshotSource = PageMetadataSource & {
  doctype: DocumentTypeSource | null;
  documentElement: Pick<Document['documentElement'], 'cloneNode'>;
};

export type PageSnapshot = PageMetadata & {
  serializedDom: string;
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
  };
}
