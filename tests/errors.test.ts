import {
  CAPTURE_ERROR_CATALOG,
  CAPTURE_ERROR_CODES,
  SiteCapsuleError,
  createCaptureError,
  isCaptureError,
  isCaptureErrorContext,
  toCaptureError,
  toSiteCapsuleError,
} from '@sitecapsule/domain';
import { describe, expect, it } from 'vitest';

describe('structured capture errors', () => {
  it('publishes a complete catalog with stable user-facing fields', () => {
    expect(Object.keys(CAPTURE_ERROR_CATALOG).sort()).toEqual([...CAPTURE_ERROR_CODES].sort());

    for (const code of CAPTURE_ERROR_CODES) {
      const error = createCaptureError(code);
      expect(isCaptureError(error)).toBe(true);
      expect(error).toMatchObject({
        code,
        message: expect.any(String),
        retryable: expect.any(Boolean),
        suggestion: expect.any(String),
      });
    }
  });

  it('accepts only whitelisted diagnostic context', () => {
    const context = {
      operation: 'resource-download',
      jobId: 'job-1',
      resourceId: 'resource-1',
      url: 'https://example.com/image.png',
      resourceType: 'image',
      stage: 'fetching',
      httpStatus: 503,
      browserError: 'TypeError',
      affectsPrimaryVisual: true,
    } as const;

    expect(isCaptureErrorContext(context)).toBe(true);
    expect(isCaptureError(createCaptureError('network-request-failed', context))).toBe(true);
    expect(isCaptureErrorContext({ ...context, responseBody: '<secret>' })).toBe(false);
    expect(isCaptureErrorContext({ ...context, httpStatus: 999 })).toBe(false);
    expect(isCaptureErrorContext({ ...context, operation: 'execute-page-command' })).toBe(false);
  });

  it('preserves known errors and sanitizes unknown exceptions', () => {
    const known = new SiteCapsuleError(
      createCaptureError('invalid-job-transition', {
        operation: 'job-transition',
        jobId: 'job-1',
        stage: 'idle',
        targetStage: 'completed',
      }),
    );

    expect(toCaptureError(known)).toBe(known.details);
    expect(toSiteCapsuleError(known)).toBe(known);

    const unknown = toCaptureError(new Error('token=must-not-leak'), 'storage-unavailable', {
      operation: 'job-read',
      jobId: 'job-1',
    });
    expect(unknown).toMatchObject({
      code: 'storage-unavailable',
      retryable: true,
      context: { operation: 'job-read', jobId: 'job-1', browserError: 'Error' },
    });
    expect(JSON.stringify(unknown)).not.toContain('must-not-leak');
  });

  it('rejects malformed serialized errors', () => {
    const valid = createCaptureError('job-not-found');

    expect(isCaptureError({ ...valid, code: 'unknown-code' })).toBe(false);
    expect(isCaptureError({ ...valid, message: '伪造的用户文案' })).toBe(false);
    expect(isCaptureError({ ...valid, retryable: true })).toBe(false);
    expect(isCaptureError({ ...valid, retryable: 'yes' })).toBe(false);
    expect(isCaptureError({ ...valid, extra: true })).toBe(false);
    expect(isCaptureError({ ...valid, context: { jobId: '' } })).toBe(false);
  });

  it('defines distinct lifecycle errors for page capture failures', () => {
    expect(createCaptureError('page-capture-timeout')).toMatchObject({
      retryable: true,
      message: '页面捕获超时。',
    });
    expect(createCaptureError('page-navigation-changed')).toMatchObject({
      retryable: true,
      message: '捕获期间页面发生了跳转。',
    });
    expect(createCaptureError('tab-closed')).toMatchObject({
      retryable: false,
      message: '捕获期间标签页已关闭。',
    });
  });
});
