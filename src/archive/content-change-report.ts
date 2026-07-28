import type {
  HtmlBaseHrefRemoval,
  HtmlCssRewriteResult,
  HtmlReferenceResult,
  HtmlSrcsetRewriteResult,
} from './html-rewriter';
import type { CspAdjustmentResult } from './csp-policy';
import type { CssRewriteResult } from './css-rewriter';
import {
  SERVICE_WORKER_GUARD_SOURCE,
  type ServiceWorkerSafetyResult,
} from './service-worker-safety';

export const CONTENT_CHANGE_KINDS = [
  'base-href-removal',
  'html-attribute-rewrite',
  'srcset-rewrite',
  'css-source-rewrite',
  'service-worker-call-rewrite',
  'service-worker-guard-insertion',
  'csp-policy-adjustment',
] as const;

export const CONTENT_CHANGE_REASONS = [
  'prevent-online-base-resolution',
  'point-to-saved-resource',
  'disable-service-worker-registration',
  'permit-offline-content-under-original-csp',
] as const;

export const CONTENT_CHANGE_REPORT_LIMITATIONS = [
  'domparser-serialization-normalization-not-itemized',
  'css-ast-regeneration-reported-at-source-level',
] as const;

export type ContentChangeKind = (typeof CONTENT_CHANGE_KINDS)[number];
export type ContentChangeReason = (typeof CONTENT_CHANGE_REASONS)[number];
export type ContentChangeReportLimitation = (typeof CONTENT_CHANGE_REPORT_LIMITATIONS)[number];

export type ContentChangeLocation = {
  documentPath: string;
  elementOrdinal: number;
  surface: 'attribute' | 'style-text' | 'script-text' | 'head' | 'meta-content';
  tagName: string | null;
  attributeName: string | null;
  startOffset: number | null;
  endOffset: number | null;
};

export type ContentChange = {
  sequence: number;
  kind: ContentChangeKind;
  reason: ContentChangeReason;
  location: ContentChangeLocation;
  before: string | null;
  after: string | null;
};

export type ContentChangeCounts = Record<ContentChangeKind, number>;

export type ContentChangeReport = {
  documentPath: string;
  totalChanges: number;
  counts: ContentChangeCounts;
  changes: ContentChange[];
  limitations: ContentChangeReportLimitation[];
};

export type ArchiveContentChangeReport = {
  filesChanged: number;
  totalChanges: number;
  counts: ContentChangeCounts;
  changes: ContentChange[];
  limitations: ContentChangeReportLimitation[];
};

export type BuildContentChangeReportOptions = {
  documentPath: string;
  references: readonly HtmlReferenceResult[];
  baseHrefRemovals: readonly HtmlBaseHrefRemoval[];
  cssRewrites: readonly HtmlCssRewriteResult[];
  srcsetRewrites: readonly HtmlSrcsetRewriteResult[];
  serviceWorkerSafety: ServiceWorkerSafetyResult;
  cspAdjustment: CspAdjustmentResult;
};

function emptyCounts(): ContentChangeCounts {
  return Object.fromEntries(CONTENT_CHANGE_KINDS.map((kind) => [kind, 0])) as ContentChangeCounts;
}

export function buildContentChangeReport(
  options: BuildContentChangeReportOptions,
): ContentChangeReport {
  const changes: ContentChange[] = [];
  const append = (change: Omit<ContentChange, 'sequence'>) => {
    changes.push({ sequence: changes.length + 1, ...change });
  };

  for (const removal of options.baseHrefRemovals) {
    append({
      kind: 'base-href-removal',
      reason: 'prevent-online-base-resolution',
      location: {
        documentPath: options.documentPath,
        elementOrdinal: removal.elementOrdinal,
        surface: 'attribute',
        tagName: 'base',
        attributeName: 'href',
        startOffset: null,
        endOffset: null,
      },
      before: removal.originalValue,
      after: null,
    });
  }

  for (const reference of options.references) {
    if (reference.status !== 'rewritten') continue;
    append({
      kind: 'html-attribute-rewrite',
      reason: 'point-to-saved-resource',
      location: {
        documentPath: options.documentPath,
        elementOrdinal: reference.elementOrdinal,
        surface: 'attribute',
        tagName: reference.tagName,
        attributeName: reference.attributeName,
        startOffset: null,
        endOffset: null,
      },
      before: reference.originalValue,
      after: reference.rewrittenValue,
    });
  }

  for (const rewrite of options.srcsetRewrites) {
    if (rewrite.result.rewrittenCount === 0) continue;
    append({
      kind: 'srcset-rewrite',
      reason: 'point-to-saved-resource',
      location: {
        documentPath: options.documentPath,
        elementOrdinal: rewrite.elementOrdinal,
        surface: 'attribute',
        tagName: rewrite.tagName,
        attributeName: rewrite.attributeName,
        startOffset: null,
        endOffset: null,
      },
      before: rewrite.originalValue,
      after: rewrite.result.srcset,
    });
  }

  for (const rewrite of options.cssRewrites) {
    if (rewrite.result.rewrittenCount === 0) continue;
    append({
      kind: 'css-source-rewrite',
      reason: 'point-to-saved-resource',
      location: {
        documentPath: options.documentPath,
        elementOrdinal: rewrite.elementOrdinal,
        surface: rewrite.sourceType === 'style-element' ? 'style-text' : 'attribute',
        tagName: rewrite.tagName,
        attributeName: rewrite.attributeName,
        startOffset: null,
        endOffset: null,
      },
      before: rewrite.originalValue,
      after: rewrite.result.cssText,
    });
  }

  for (const script of options.serviceWorkerSafety.scripts) {
    for (const change of script.changes) {
      append({
        kind: 'service-worker-call-rewrite',
        reason: 'disable-service-worker-registration',
        location: {
          documentPath: options.documentPath,
          elementOrdinal: script.elementOrdinal,
          surface: 'script-text',
          tagName: 'script',
          attributeName: null,
          startOffset: change.startOffset,
          endOffset: change.endOffset,
        },
        before: change.originalValue,
        after: change.replacement,
      });
    }
  }

  if (options.serviceWorkerSafety.guardInserted) {
    append({
      kind: 'service-worker-guard-insertion',
      reason: 'disable-service-worker-registration',
      location: {
        documentPath: options.documentPath,
        elementOrdinal: 0,
        surface: 'head',
        tagName: 'script',
        attributeName: null,
        startOffset: null,
        endOffset: null,
      },
      before: null,
      after: SERVICE_WORKER_GUARD_SOURCE,
    });
  }

  for (const policy of options.cspAdjustment.policies) {
    if (policy.status !== 'adjusted') continue;
    append({
      kind: 'csp-policy-adjustment',
      reason: 'permit-offline-content-under-original-csp',
      location: {
        documentPath: options.documentPath,
        elementOrdinal: policy.elementOrdinal,
        surface: 'meta-content',
        tagName: 'meta',
        attributeName: 'content',
        startOffset: null,
        endOffset: null,
      },
      before: policy.originalPolicy,
      after: policy.adjustedPolicy,
    });
  }

  const counts = emptyCounts();
  for (const change of changes) counts[change.kind] += 1;
  const limitations: ContentChangeReportLimitation[] = [
    'domparser-serialization-normalization-not-itemized',
  ];
  if (counts['css-source-rewrite'] > 0) {
    limitations.push('css-ast-regeneration-reported-at-source-level');
  }

  return {
    documentPath: options.documentPath,
    totalChanges: changes.length,
    counts,
    changes,
    limitations,
  };
}

export function buildCssContentChangeReport(result: CssRewriteResult): ContentChangeReport {
  if (!result || typeof result !== 'object') {
    throw new TypeError('A CSS rewrite result is required for the content change report.');
  }
  const changes: ContentChange[] = [];
  if (result.rewrittenCount > 0) {
    changes.push({
      sequence: 1,
      kind: 'css-source-rewrite',
      reason: 'point-to-saved-resource',
      location: {
        documentPath: result.sourcePath,
        elementOrdinal: 0,
        surface: 'style-text',
        tagName: null,
        attributeName: null,
        startOffset: null,
        endOffset: null,
      },
      before: result.originalCssText,
      after: result.cssText,
    });
  }
  const counts = emptyCounts();
  counts['css-source-rewrite'] = changes.length;
  return {
    documentPath: result.sourcePath,
    totalChanges: changes.length,
    counts,
    changes,
    limitations: changes.length > 0 ? ['css-ast-regeneration-reported-at-source-level'] : [],
  };
}

export function combineContentChangeReports(
  reports: readonly ContentChangeReport[],
): ArchiveContentChangeReport {
  if (!Array.isArray(reports)) throw new TypeError('Content change reports must be an array.');
  const paths = reports.map((report) => report.documentPath);
  if (new Set(paths).size !== paths.length) {
    throw new TypeError('Content change reports must have unique document paths.');
  }
  const ordered = [...reports].sort((left, right) =>
    left.documentPath < right.documentPath ? -1 : left.documentPath > right.documentPath ? 1 : 0,
  );
  const changes: ContentChange[] = ordered
    .flatMap((report) => report.changes)
    .map((change, index): ContentChange => ({
      ...change,
      sequence: index + 1,
    }));
  const counts = emptyCounts();
  for (const change of changes) counts[change.kind] += 1;
  const limitationSet = new Set(ordered.flatMap((report) => report.limitations));

  return {
    filesChanged: new Set(changes.map((change) => change.location.documentPath)).size,
    totalChanges: changes.length,
    counts,
    changes,
    limitations: CONTENT_CHANGE_REPORT_LIMITATIONS.filter((limitation) =>
      limitationSet.has(limitation),
    ),
  };
}
