import { createCaptureError } from '@sitecapsule/domain';
import {
  CAPTURE_JOB_HISTORY_LIMIT,
  createCaptureJobDeleteRequest,
  createCaptureJobHistoryClearRequest,
  createCaptureJobHistoryError,
  createCaptureJobHistoryListRequest,
  createCaptureJobHistoryResponse,
  createCaptureJobMutationError,
  createCaptureJobMutationResponse,
  type CaptureJobHistoryItem,
} from '@sitecapsule/messaging/protocol';
import {
  isCaptureJobDeleteRequest,
  isCaptureJobHistoryClearRequest,
  isCaptureJobHistoryListRequest,
  isCaptureJobHistoryResponse,
  isCaptureJobMutationResponse,
} from '@sitecapsule/messaging/validators';
import { describe, expect, it } from 'vitest';

const item: CaptureJobHistoryItem = {
  jobId: 'job-1',
  status: 'completed',
  fileName: 'example.zip',
  updatedAt: '2026-07-31T08:00:00.000Z',
  archiveAvailable: true,
  counters: {
    pagesDiscovered: 1,
    pagesCaptured: 1,
    resourcesDiscovered: 3,
    resourcesSaved: 2,
    resourcesFailed: 1,
    resourcesSkipped: 0,
    bytesWritten: 128,
  },
};

describe('capture job history protocol', () => {
  it('accepts bounded list, explicit delete, and explicit clear requests', () => {
    expect(isCaptureJobHistoryListRequest(createCaptureJobHistoryListRequest())).toBe(true);
    expect(isCaptureJobDeleteRequest(createCaptureJobDeleteRequest(item.jobId))).toBe(true);
    expect(isCaptureJobHistoryClearRequest(createCaptureJobHistoryClearRequest())).toBe(true);
    expect(
      isCaptureJobHistoryListRequest(
        createCaptureJobHistoryListRequest(CAPTURE_JOB_HISTORY_LIMIT + 1),
      ),
    ).toBe(false);
  });

  it('validates metadata-only history and mutation responses', () => {
    const history = createCaptureJobHistoryResponse([item]);
    expect(isCaptureJobHistoryResponse(history)).toBe(true);
    expect(JSON.stringify(history)).not.toContain('startUrl');
    expect(JSON.stringify(history)).not.toContain('serializedDom');
    expect(
      isCaptureJobHistoryResponse(
        createCaptureJobHistoryError(createCaptureError('storage-unavailable')),
      ),
    ).toBe(true);
    expect(isCaptureJobMutationResponse(createCaptureJobMutationResponse(3))).toBe(true);
    expect(
      isCaptureJobMutationResponse(
        createCaptureJobMutationError(createCaptureError('storage-unavailable')),
      ),
    ).toBe(true);
  });

  it('rejects extra history fields and archive availability on failed tasks', () => {
    const withUrl = createCaptureJobHistoryResponse([
      { ...item, startUrl: 'https://secret.example/' } as CaptureJobHistoryItem,
    ]);
    const failedWithArchive = createCaptureJobHistoryResponse([
      { ...item, status: 'failed', archiveAvailable: true },
    ]);
    expect(isCaptureJobHistoryResponse(withUrl)).toBe(false);
    expect(isCaptureJobHistoryResponse(failedWithArchive)).toBe(false);
  });
});
