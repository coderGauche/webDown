import { SiteCapsuleError, createCaptureError } from '@sitecapsule/domain';

import {
  auditArchiveOfflineIntegritySync,
  type ArchiveOfflineIntegrityAudit,
  type ArchiveOfflineIntegrityParser,
} from './archive-offline-integrity';

export type EnforceArchiveOfflineIntegrityInput = {
  archiveBytes: Uint8Array;
  parser?: ArchiveOfflineIntegrityParser;
  jobId?: string;
};

/** Prevents a structurally valid but network-dependent ZIP from becoming a completed task. */
export function enforceArchiveOfflineIntegritySync(
  input: EnforceArchiveOfflineIntegrityInput,
): ArchiveOfflineIntegrityAudit {
  const audit = auditArchiveOfflineIntegritySync({
    archiveBytes: input.archiveBytes,
    parser: input.parser,
  });
  if (audit.status === 'pass') return audit;

  throw new SiteCapsuleError(
    createCaptureError('archive-integrity-failed', {
      operation: 'archive-package',
      ...(input.jobId ? { jobId: input.jobId } : {}),
      stage: 'packaging',
    }),
  );
}
