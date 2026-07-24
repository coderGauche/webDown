import { MAX_RENDER_WAIT_MS, isRenderWaitMs, type CaptureSettings } from '@sitecapsule/domain';

export type RenderWaitScheduler = (callback: () => void, delayMs: number) => unknown;

const scheduleWithTimeout: RenderWaitScheduler = (callback, delayMs) =>
  setTimeout(callback, delayMs);

export function waitForRender(
  renderWaitMs: CaptureSettings['renderWaitMs'],
  schedule: RenderWaitScheduler = scheduleWithTimeout,
): Promise<void> {
  if (!isRenderWaitMs(renderWaitMs)) {
    throw new RangeError(`renderWaitMs must be an integer between 0 and ${MAX_RENDER_WAIT_MS}.`);
  }

  if (renderWaitMs === 0) return Promise.resolve();

  return new Promise((resolve) => schedule(resolve, renderWaitMs));
}
