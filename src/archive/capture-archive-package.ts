import type { CaptureJob, ResourceRecord } from '@sitecapsule/domain';

import { createArchiveManifestEntry, buildArchiveManifest } from './archive-manifest';
import {
  enforceArchiveOfflineIntegritySync,
  type EnforceArchiveOfflineIntegrityInput,
} from './archive-integrity-gate';
import { createArchiveLayoutZipSync } from './archive-layout';
import { createArchiveReportEntries, type ArchiveReportLocale } from './archive-report';
import { applyArchiveResourceSha256 } from './resource-integrity';
import {
  buildArchiveResourceManifests,
  createArchiveResourceManifestEntries,
  type ArchiveFailureManifest,
  type ArchiveResourceManifest,
} from './resource-manifests';
import type { ResourcePathMapping } from './resource-path-mapping';
import type { ZipArchiveEntry } from './zip-codec';

export interface CaptureArchivePackageInput {
  job: CaptureJob;
  finalUrl: string;
  resourceRecords: readonly ResourceRecord[];
  pathMappings: readonly ResourcePathMapping[];
  indexHtml: Uint8Array;
  assets: readonly ZipArchiveEntry[];
  locale: ArchiveReportLocale;
  knownLimitations: readonly string[];
  parser: EnforceArchiveOfflineIntegrityInput['parser'];
}

export interface CaptureArchivePackageResult {
  archiveBytes: Uint8Array;
  resourceManifest: ArchiveResourceManifest;
  failureManifest: ArchiveFailureManifest;
}

export async function createCaptureArchivePackage(
  input: CaptureArchivePackageInput,
): Promise<CaptureArchivePackageResult> {
  const manifests = buildArchiveResourceManifests({
    jobId: input.job.id,
    resourceRecords: input.resourceRecords,
    pathMappings: input.pathMappings,
  });
  const resourceEntries = [{ path: 'index.html', bytes: input.indexHtml }, ...input.assets];
  const integrity = await applyArchiveResourceSha256({
    enabled: true,
    resourceManifest: manifests.resources,
    resourceEntries,
  });
  const archiveManifestInput = {
    capturedAt: input.job.createdAt,
    startUrl: input.job.startUrl,
    finalUrl: input.finalUrl,
    mode: input.job.mode,
    captureProfile: input.job.profile,
    pages: Math.max(1, input.job.counters.pagesCaptured),
    resources: integrity.resourceManifest.resources.length,
    failedResources: manifests.failures.failures.length,
    requiresLocalHttpServer: true,
    onlineDependencies: [],
  } as const;
  const archiveManifest = buildArchiveManifest(archiveManifestInput);
  const resourceManifestEntries = createArchiveResourceManifestEntries({
    jobId: input.job.id,
    resourceRecords: input.resourceRecords,
    pathMappings: input.pathMappings,
  }).map((entry) =>
    entry.path === integrity.resourcesEntry.path ? integrity.resourcesEntry : entry,
  );
  const metadata = [
    createArchiveManifestEntry(archiveManifestInput),
    ...resourceManifestEntries,
    ...createArchiveReportEntries({
      locale: input.locale,
      archiveManifest,
      resourceManifest: integrity.resourceManifest,
      failureManifest: manifests.failures,
      knownLimitations: input.knownLimitations,
    }),
  ];
  const archiveBytes = createArchiveLayoutZipSync({
    indexHtml: input.indexHtml,
    assets: input.assets,
    metadata,
  });

  enforceArchiveOfflineIntegritySync({
    archiveBytes,
    jobId: input.job.id,
    parser: input.parser,
  });

  return {
    archiveBytes,
    resourceManifest: integrity.resourceManifest,
    failureManifest: manifests.failures,
  };
}
