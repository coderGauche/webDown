import {
  ARCHIVE_DOWNLOAD_CONFLICT_ACTION,
  ARCHIVE_DOWNLOAD_MIME_TYPE,
  createArchiveDownloadFileName,
  exportArchiveDownload,
  type ArchiveDownloadEnvironment,
  type ArchiveDownloadRequest,
} from '@sitecapsule/archive';
import { SiteCapsuleError } from '@sitecapsule/domain';
import { describe, expect, it, vi } from 'vitest';

const encoder = new TextEncoder();

function createEnvironment(
  download: (request: ArchiveDownloadRequest) => Promise<number> = async () => 42,
): ArchiveDownloadEnvironment & {
  blobs: Blob[];
  revokedUrls: string[];
} {
  const blobs: Blob[] = [];
  const revokedUrls: string[] = [];

  return {
    blobs,
    revokedUrls,
    createObjectUrl(blob) {
      blobs.push(blob);
      return `blob:sitecapsule-test/${blobs.length}`;
    },
    revokeObjectUrl(url) {
      revokedUrls.push(url);
    },
    download,
  };
}

describe('Chrome archive download export', () => {
  it('starts one traceable ZIP download with explicit browser options', async () => {
    const events: string[] = [];
    const requests: ArchiveDownloadRequest[] = [];
    const environment = createEnvironment(async (request) => {
      events.push('download');
      requests.push(request);
      return 73;
    });
    const originalCreate = environment.createObjectUrl;
    const originalRevoke = environment.revokeObjectUrl;
    environment.createObjectUrl = (blob) => {
      events.push('create');
      return originalCreate(blob);
    };
    environment.revokeObjectUrl = (url) => {
      events.push('revoke');
      originalRevoke(url);
    };

    const result = await exportArchiveDownload(
      {
        archiveBytes: encoder.encode('zip bytes'),
        fileName: 'Client Delivery',
        saveAs: true,
      },
      environment,
    );

    expect(requests).toEqual([
      {
        url: 'blob:sitecapsule-test/1',
        filename: 'Client Delivery.zip',
        conflictAction: ARCHIVE_DOWNLOAD_CONFLICT_ACTION,
        saveAs: true,
      },
    ]);
    expect(result).toEqual({
      downloadId: 73,
      fileName: 'Client Delivery.zip',
      byteLength: 9,
      saveAs: true,
      conflictAction: 'uniquify',
    });
    expect(environment.blobs).toHaveLength(1);
    expect(environment.blobs[0]?.type).toBe(ARCHIVE_DOWNLOAD_MIME_TYPE);
    expect(await environment.blobs[0]?.text()).toBe('zip bytes');
    expect(environment.revokedUrls).toEqual(['blob:sitecapsule-test/1']);
    expect(events).toEqual(['create', 'download', 'revoke']);
  });

  it('copies bytes before the download callback can mutate caller input', async () => {
    const bytes = encoder.encode('original');
    const environment = createEnvironment(async () => {
      bytes.fill(0);
      return 1;
    });

    await exportArchiveDownload(
      { archiveBytes: bytes, fileName: 'archive.zip', saveAs: false },
      environment,
    );

    expect(await environment.blobs[0]?.text()).toBe('original');
  });

  it.each([
    ['report.ZIP', 'report.zip'],
    ['folder/name?.zip', 'folder_name_.zip'],
    ['CON', '_CON.zip'],
    ['.zip', 'sitecapsule-archive.zip'],
    [`${'汉'.repeat(100)}.zip`, `${'汉'.repeat(78)}.zip`],
  ])('normalizes a portable ZIP file name from %s', (input, expected) => {
    expect(createArchiveDownloadFileName(input)).toBe(expected);
    expect(new TextEncoder().encode(expected).byteLength).toBeLessThanOrEqual(240);
  });

  it('preserves saveAs false while keeping uniquify conflict handling', async () => {
    const download = vi.fn(async () => 8);
    const environment = createEnvironment(download);

    await exportArchiveDownload(
      { archiveBytes: encoder.encode('zip'), fileName: 'archive.zip', saveAs: false },
      environment,
    );

    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({ saveAs: false, conflictAction: 'uniquify' }),
    );
  });

  it('revokes the Blob URL and returns a structured error when download startup fails', async () => {
    class PrivateDownloadFailure extends Error {
      override readonly name = 'PrivateDownloadFailure';
    }
    const environment = createEnvironment(async () => {
      throw new PrivateDownloadFailure('token=must-not-leak');
    });

    await expect(
      exportArchiveDownload(
        { archiveBytes: encoder.encode('zip'), fileName: 'archive.zip', saveAs: true },
        environment,
      ),
    ).rejects.toMatchObject({
      details: {
        code: 'archive-download-failed',
        retryable: true,
        context: { operation: 'archive-download', browserError: 'PrivateDownloadFailure' },
      },
    });
    expect(environment.revokedUrls).toEqual(['blob:sitecapsule-test/1']);
  });

  it('does not replace a primary download failure with a cleanup failure', async () => {
    class DownloadStartupError extends Error {
      override readonly name = 'DownloadStartupError';
    }
    class CleanupError extends Error {
      override readonly name = 'CleanupError';
    }
    const environment = createEnvironment(async () => {
      throw new DownloadStartupError('private download detail');
    });
    environment.revokeObjectUrl = () => {
      throw new CleanupError('private cleanup detail');
    };

    try {
      await exportArchiveDownload(
        { archiveBytes: encoder.encode('zip'), fileName: 'archive.zip', saveAs: true },
        environment,
      );
      throw new Error('Expected export to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(SiteCapsuleError);
      expect((error as SiteCapsuleError).details.context?.browserError).toBe(
        'DownloadStartupError',
      );
      expect(JSON.stringify((error as SiteCapsuleError).details)).not.toContain('private');
    }
  });

  it.each([async () => -1, async () => Number.NaN])(
    'rejects an invalid download id from the browser adapter',
    async (download) => {
      const environment = createEnvironment(download);

      await expect(
        exportArchiveDownload(
          { archiveBytes: encoder.encode('zip'), fileName: 'archive.zip', saveAs: true },
          environment,
        ),
      ).rejects.toMatchObject({ details: { code: 'archive-download-failed' } });
      expect(environment.revokedUrls).toEqual(['blob:sitecapsule-test/1']);
    },
  );

  it('never passes a non-Blob URL to the Downloads API', async () => {
    const download = vi.fn(async () => 1);
    const environment = createEnvironment(download);
    environment.createObjectUrl = () => 'data:application/zip;base64,AA==';

    await expect(
      exportArchiveDownload(
        { archiveBytes: encoder.encode('zip'), fileName: 'archive.zip', saveAs: true },
        environment,
      ),
    ).rejects.toMatchObject({ details: { code: 'archive-download-failed' } });
    expect(download).not.toHaveBeenCalled();
    expect(environment.revokedUrls).toEqual(['data:application/zip;base64,AA==']);
  });

  it.each([
    null,
    { archiveBytes: new Uint8Array(), fileName: 'a.zip', saveAs: true },
    { archiveBytes: encoder.encode('zip'), fileName: '', saveAs: true },
    { archiveBytes: encoder.encode('zip'), fileName: 'a.zip', saveAs: 'yes' },
    {
      archiveBytes: encoder.encode('zip'),
      fileName: 'a.zip',
      saveAs: true,
      url: 'https://upload.test',
    },
  ])('rejects malformed input before creating a Blob URL', async (input) => {
    const environment = createEnvironment();

    await expect(exportArchiveDownload(input as never, environment)).rejects.toBeInstanceOf(Error);
    expect(environment.blobs).toHaveLength(0);
  });
});
