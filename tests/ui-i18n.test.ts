import { CAPTURE_ERROR_CODES, createCaptureError } from '@sitecapsule/domain';
import {
  UI_MESSAGES,
  hasCompleteErrorTranslations,
  localizeCaptureError,
  resolveUiLocale,
  translate,
} from '@sitecapsule/ui';
import { describe, expect, it } from 'vitest';

describe('Side Panel localization', () => {
  it('keeps the English and Chinese key sets identical', () => {
    expect(Object.keys(UI_MESSAGES['zh-CN']).sort()).toEqual(Object.keys(UI_MESSAGES.en).sort());
  });

  it('resolves browser locale values with a deterministic English fallback', () => {
    expect(resolveUiLocale('zh-CN')).toBe('zh-CN');
    expect(resolveUiLocale('zh-TW')).toBe('zh-CN');
    expect(resolveUiLocale('en-US')).toBe('en');
    expect(resolveUiLocale(undefined)).toBe('en');
  });

  it('interpolates dynamic values without changing machine identifiers', () => {
    expect(translate('zh-CN', 'resourceCounts', { saved: 3, failed: 1, skipped: 2 })).toBe(
      '已保存 3 · 失败 1 · 跳过 2',
    );
    expect(translate('en', 'downloadStarted', { value: 'archive.zip' })).toContain('archive.zip');
  });

  it('provides an English projection for every structured error code', () => {
    expect(hasCompleteErrorTranslations()).toBe(true);
    for (const code of CAPTURE_ERROR_CODES) {
      const source = createCaptureError(code);
      const localized = localizeCaptureError(source, 'en');
      expect(localized.code).toBe(code);
      expect(localized.message).not.toBe(source.message);
      expect(localized.context).toBe(source.context);
    }
  });
});
