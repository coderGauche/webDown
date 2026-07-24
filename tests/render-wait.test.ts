import { DEFAULT_RENDER_WAIT_MS, MAX_RENDER_WAIT_MS, isRenderWaitMs } from '@sitecapsule/domain';
import { waitForRender, type RenderWaitScheduler } from '@sitecapsule/page';
import { describe, expect, it, vi } from 'vitest';

describe('render wait', () => {
  it('defines a valid default and inclusive boundaries', () => {
    expect(DEFAULT_RENDER_WAIT_MS).toBe(1_000);
    expect(MAX_RENDER_WAIT_MS).toBe(30_000);
    expect(isRenderWaitMs(0)).toBe(true);
    expect(isRenderWaitMs(DEFAULT_RENDER_WAIT_MS)).toBe(true);
    expect(isRenderWaitMs(MAX_RENDER_WAIT_MS)).toBe(true);
  });

  it('resolves zero wait without scheduling a timer', async () => {
    const schedule = vi.fn<RenderWaitScheduler>();

    await expect(waitForRender(0, schedule)).resolves.toBeUndefined();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('schedules a non-blocking wait with the configured duration', async () => {
    let release: (() => void) | undefined;
    const schedule: RenderWaitScheduler = (callback, delayMs) => {
      expect(delayMs).toBe(1_500);
      release = callback;
    };

    const wait = waitForRender(1_500, schedule);
    expect(release).toBeTypeOf('function');

    release?.();
    await expect(wait).resolves.toBeUndefined();
  });

  it.each([-1, MAX_RENDER_WAIT_MS + 1, 1.5, Number.NaN])(
    'rejects invalid render wait value %s',
    (value) => {
      expect(isRenderWaitMs(value)).toBe(false);
      expect(() => waitForRender(value)).toThrow(RangeError);
    },
  );
});
