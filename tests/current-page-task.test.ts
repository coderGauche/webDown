import { createCaptureJobCreateRequest } from '@sitecapsule/messaging/protocol';
import { isCaptureJobCreateRequest } from '@sitecapsule/messaging/validators';
import {
  applyCurrentPageToArchiveName,
  buildCurrentPageTaskInput,
  createDefaultCurrentPageArchiveFileName,
  createInitialCurrentPageArchiveName,
  editCurrentPageArchiveName,
  getPendingThirdPartyPermissionPatterns,
  isThirdPartyCaptureReady,
  validateConcurrencyInput,
  validateCurrentPageArchiveFileName,
  validateRenderWaitInput,
} from '@sitecapsule/ui';
import type { ThirdPartySiteAccessSummary } from '@sitecapsule/permissions';
import { describe, expect, it } from 'vitest';

describe('current-page task settings', () => {
  it('builds a protocol-valid current-page create input', () => {
    const input = buildCurrentPageTaskInput({
      tabId: 7,
      pageUrl: 'https://example.com/products?view=full#details',
      archiveFileName: 'example-products.zip',
      renderWaitMs: 1_500,
      maxConcurrentRequests: 9,
      includeMedia: true,
      includeThirdPartyResources: true,
    });

    expect(input).toMatchObject({
      tabId: 7,
      startUrl: 'https://example.com/products?view=full#details',
      mode: 'current-page',
      profile: 'standard',
      settings: {
        archiveFileName: 'example-products.zip',
        renderWaitMs: 1_500,
        maxConcurrentRequests: 9,
        includeMedia: true,
        includeScripts: false,
        includeThirdPartyResources: true,
        maxDepth: 0,
        maxPages: 1,
      },
    });
    expect(isCaptureJobCreateRequest(createCaptureJobCreateRequest(input, 'current-page'))).toBe(
      true,
    );
  });

  it('uses the product defaults for concurrency, media, and third-party resources', () => {
    const input = buildCurrentPageTaskInput({
      tabId: 1,
      pageUrl: 'https://example.com',
      archiveFileName: 'example.zip',
    });

    expect(input.settings).toMatchObject({
      renderWaitMs: 1_000,
      maxConcurrentRequests: 6,
      includeMedia: false,
      includeScripts: false,
      includeThirdPartyResources: true,
    });
  });

  it('can opt into the static snapshot mode by excluding runtime scripts', () => {
    const input = buildCurrentPageTaskInput({
      tabId: 7,
      pageUrl: 'https://example.com/page',
      archiveFileName: 'example.zip',
      includeScripts: false,
    });

    expect(input.settings.includeScripts).toBe(false);
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

  it('validates render wait as a whole number from 0 through 30000', () => {
    expect(validateRenderWaitInput('0')).toEqual({ valid: true, value: 0, message: null });
    expect(validateRenderWaitInput('30000')).toEqual({
      valid: true,
      value: 30_000,
      message: null,
    });
    expect(validateRenderWaitInput('')).toMatchObject({
      valid: false,
      message: 'Enter render wait.',
    });
    expect(validateRenderWaitInput('1.5')).toMatchObject({
      valid: false,
      message: 'Render wait must be a whole number.',
    });
    expect(validateRenderWaitInput('30001')).toMatchObject({
      valid: false,
      message: 'Render wait must be between 0 and 30000.',
    });
  });

  it('validates concurrency as a whole number from 1 through 12', () => {
    expect(validateConcurrencyInput('1')).toEqual({ valid: true, value: 1, message: null });
    expect(validateConcurrencyInput('12')).toEqual({ valid: true, value: 12, message: null });
    for (const value of ['', '0', '13', '2.5', '-1', '1e1']) {
      expect(validateConcurrencyInput(value).valid).toBe(false);
    }
  });

  it('requires every archive-critical third-party host to be granted when inclusion is enabled', () => {
    const access: ThirdPartySiteAccessSummary[] = [
      {
        status: 'granted',
        permissionPattern: 'https://ready.example/*',
        scheme: 'https:',
        hostname: 'ready.example',
        origins: ['https://ready.example'],
        resourceCount: 1,
        provenanceCount: 1,
        discoverySources: ['dom'],
        resourceTypes: ['image'],
        criticalResourceCount: 1,
        excludedResourceCount: 0,
        defaultSelected: true,
        policyReasons: ['critical-resource-type'],
      },
      {
        status: 'not-granted',
        permissionPattern: 'https://pending.example/*',
        scheme: 'https:',
        hostname: 'pending.example',
        origins: ['https://pending.example'],
        resourceCount: 2,
        provenanceCount: 3,
        discoverySources: ['css', 'performance'],
        resourceTypes: ['font'],
        criticalResourceCount: 2,
        excludedResourceCount: 0,
        defaultSelected: true,
        policyReasons: ['critical-resource-type'],
      },
    ];

    expect(getPendingThirdPartyPermissionPatterns(access)).toEqual(['https://pending.example/*']);
    expect(isThirdPartyCaptureReady(false, access)).toBe(true);
    expect(isThirdPartyCaptureReady(true, access)).toBe(false);
    expect(isThirdPartyCaptureReady(true, [{ ...access[0]!, status: 'granted' }])).toBe(true);
  });

  it('does not block capture for runtime-only third-party hosts', () => {
    const runtimeOnly: ThirdPartySiteAccessSummary[] = [
      {
        status: 'not-granted',
        permissionPattern: 'https://analytics.example/*',
        scheme: 'https:',
        hostname: 'analytics.example',
        origins: ['https://analytics.example'],
        resourceCount: 2,
        provenanceCount: 2,
        discoverySources: ['performance'],
        resourceTypes: ['script'],
        criticalResourceCount: 0,
        excludedResourceCount: 2,
        defaultSelected: false,
        policyReasons: ['tracking-runtime'],
      },
    ];

    expect(getPendingThirdPartyPermissionPatterns(runtimeOnly)).toEqual([]);
    expect(isThirdPartyCaptureReady(true, runtimeOnly)).toBe(true);
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
    expect(() =>
      buildCurrentPageTaskInput({
        tabId: 1,
        pageUrl: 'https://example.com',
        archiveFileName: 'example.zip',
        renderWaitMs: 30_001,
      }),
    ).toThrow('Render wait');
    expect(() =>
      buildCurrentPageTaskInput({
        tabId: 1,
        pageUrl: 'https://example.com',
        archiveFileName: 'example.zip',
        maxConcurrentRequests: 13,
      }),
    ).toThrow('Concurrency');
  });
});
