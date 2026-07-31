import {
  SIDE_PANEL_FOCUS_TARGETS,
  getFirstInvalidArchiveFocusTarget,
  getPostActionFocusTarget,
} from '@sitecapsule/ui';
import { describe, expect, it } from 'vitest';

describe('Side Panel focus management', () => {
  it('focuses the first invalid field in visual and keyboard order', () => {
    expect(
      getFirstInvalidArchiveFocusTarget({
        archiveFileName: false,
        renderWait: false,
        concurrency: false,
      }),
    ).toBe('archive-file-name');
    expect(
      getFirstInvalidArchiveFocusTarget({
        archiveFileName: true,
        renderWait: false,
        concurrency: false,
      }),
    ).toBe('render-wait');
    expect(
      getFirstInvalidArchiveFocusTarget({
        archiveFileName: true,
        renderWait: true,
        concurrency: false,
      }),
    ).toBe('capture-concurrency');
    expect(
      getFirstInvalidArchiveFocusTarget({
        archiveFileName: true,
        renderWait: true,
        concurrency: true,
      }),
    ).toBeNull();
  });

  it('moves focus away from removed history controls after mutations', () => {
    expect(getPostActionFocusTarget('capture-updated')).toBe('capture-progress');
    expect(getPostActionFocusTarget('history-opened')).toBe('capture-result');
    expect(getPostActionFocusTarget('history-mutated')).toBe('task-history');
    expect(new Set(SIDE_PANEL_FOCUS_TARGETS).size).toBe(SIDE_PANEL_FOCUS_TARGETS.length);
  });
});
