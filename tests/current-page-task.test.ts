import { createCaptureJobCreateRequest } from '@sitecapsule/messaging/protocol';
import { isCaptureJobCreateRequest } from '@sitecapsule/messaging/validators';
import {
  applyCurrentPageToArchiveName,
  buildCurrentPageTaskInput,
  createDefaultCurrentPageArchiveFileName,
  createInitialCurrentPageArchiveName,
  editCurrentPageArchiveName,
  validateCurrentPageArchiveFileName,
} from '@sitecapsule/ui';
import { describe, expect, it } from 'vitest';

describe('current-page task settings', () => {
  it('builds a protocol-valid current-page create input', () => {
    const input = buildCurrentPageTaskInput({
      tabId: 7,
      pageUrl: 'https://example.com/products?view=full#details',
      archiveFileName: 'example-products.zip',
      renderWaitMs: 1_500,
    });

    expect(input).toMatchObject({
      tabId: 7,
      startUrl: 'https://example.com/products?view=full#details',
      mode: 'current-page',
      profile: 'standard',
      settings: {
        archiveFileName: 'example-products.zip',
        renderWaitMs: 1_500,
        maxConcurrentRequests: 4,
        includeMedia: true,
        includeScripts: true,
        includeThirdPartyResources: false,
        maxDepth: 0,
        maxPages: 1,
      },
    });
    expect(isCaptureJobCreateRequest(createCaptureJobCreateRequest(input, 'current-page'))).toBe(
      true,
    );
  });

  it('creates a deterministic portable default from the page host and local date', () => {
    expect(
      createDefaultCurrentPageArchiveFileName(
        'https://www.Example.com/products',
        new Date(2026, 6, 29, 12),
      ),
    ).toBe('sitecapsule-example.com-20260729.zip');
  });

  it('explains empty, missing-extension, and non-portable file names', () => {
    expect(validateCurrentPageArchiveFileName('')).toMatchObject({
      valid: false,
      message: 'Enter a name for the ZIP file.',
    });
    expect(validateCurrentPageArchiveFileName('project')).toEqual({
      valid: false,
      fileName: null,
      message: 'The file name must end in .zip.',
      suggestion: 'project.zip',
    });
    expect(validateCurrentPageArchiveFileName('client/final.zip')).toEqual({
      valid: false,
      fileName: null,
      message: 'Use a portable file name without path separators or reserved characters.',
      suggestion: 'client_final.zip',
    });
    expect(validateCurrentPageArchiveFileName('client-final.zip')).toEqual({
      valid: true,
      fileName: 'client-final.zip',
      message: null,
      suggestion: null,
    });
  });

  it('uses the page-derived name until the user edits it', () => {
    const initial = createInitialCurrentPageArchiveName();
    const firstPage = applyCurrentPageToArchiveName(
      initial,
      'https://first.example/page',
      new Date(2026, 6, 29),
    );
    expect(firstPage.value).toBe('sitecapsule-first.example-20260729.zip');

    const edited = editCurrentPageArchiveName('customer-delivery.zip');
    const refreshed = applyCurrentPageToArchiveName(
      edited,
      'https://second.example/page',
      new Date(2026, 6, 30),
    );
    expect(refreshed).toBe(edited);
    expect(refreshed.value).toBe('customer-delivery.zip');
  });

  it('rejects invalid tab IDs, URLs, and file names before building a task', () => {
    expect(() =>
      buildCurrentPageTaskInput({
        tabId: -1,
        pageUrl: 'https://example.com',
        archiveFileName: 'example.zip',
      }),
    ).toThrow('tab ID');
    expect(() =>
      buildCurrentPageTaskInput({
        tabId: 1,
        pageUrl: 'chrome://extensions',
        archiveFileName: 'example.zip',
      }),
    ).toThrow('HTTP or HTTPS');
    expect(() =>
      buildCurrentPageTaskInput({
        tabId: 1,
        pageUrl: 'https://example.com',
        archiveFileName: 'example',
      }),
    ).toThrow('end in .zip');
  });
});
