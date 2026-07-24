import { createCaptureError, toCaptureError } from '@sitecapsule/domain';
import type { CaptureError, CaptureSettings } from '@sitecapsule/domain';
import { CONTENT_SCRIPT_FILE, RUNTIME_LOG_PREFIX } from '@sitecapsule/shared';
import {
  createPageInfoCollectRequest,
  createPageInfoError,
  type PageInfoResponse,
} from '@sitecapsule/messaging/protocol';
import { isPageInfoRequest, isPageInfoResponse } from '@sitecapsule/messaging/validators';
import {
  getPageCaptureTimeoutMs,
  runPageCaptureSession,
  type PageCaptureLifecycleEvent,
} from '@sitecapsule/page';

async function sendPageInfoRequestWithCorrelation(
  tabId: number,
  tabUrl: string,
  renderWaitMs: CaptureSettings['renderWaitMs'],
  correlationId?: string,
): Promise<PageInfoResponse | null> {
  try {
    const response: unknown = await browser.tabs.sendMessage(
      tabId,
      createPageInfoCollectRequest(tabUrl, renderWaitMs, correlationId),
    );
    return isPageInfoResponse(response) ? response : null;
  } catch {
    return null;
  }
}

async function waitForPageInfoResponse(
  tabId: number,
  tabUrl: string,
  renderWaitMs: CaptureSettings['renderWaitMs'],
  correlationId: string,
): Promise<PageInfoResponse | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await sendPageInfoRequestWithCorrelation(
      tabId,
      tabUrl,
      renderWaitMs,
      correlationId,
    );
    if (response) return response;

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return null;
}

async function injectContentScript(tabId: number): Promise<CaptureError | null> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      // Chrome expects an extension-root-relative path. WXT's generated type uses public URL paths.
      files: [CONTENT_SCRIPT_FILE as unknown as ScriptPublicPath],
    });
    return null;
  } catch (error) {
    console.warn(`${RUNTIME_LOG_PREFIX} Content script injection failed.`, error);
    const browserError = error instanceof Error ? error.message : String(error);
    return toCaptureError(error, 'content-script-injection-failed', {
      operation: 'content-script-injection',
      ...(browserError.trim() ? { browserError } : {}),
    });
  }
}

async function collectPageInfoFromContent(
  tabId: number,
  tabUrl: string,
  renderWaitMs: CaptureSettings['renderWaitMs'],
  correlationId: string,
): Promise<PageInfoResponse> {
  const existingResponse = await sendPageInfoRequestWithCorrelation(
    tabId,
    tabUrl,
    renderWaitMs,
    correlationId,
  );
  if (existingResponse) return existingResponse;

  const injectionError = await injectContentScript(tabId);
  if (injectionError) return createPageInfoError(injectionError, correlationId);

  const injectedResponse = await waitForPageInfoResponse(
    tabId,
    tabUrl,
    renderWaitMs,
    correlationId,
  );
  return (
    injectedResponse ??
    createPageInfoError(
      createCaptureError('content-script-unresponsive', {
        operation: 'content-script-response',
      }),
      correlationId,
    )
  );
}

function subscribeToTabLifecycle(
  tabId: number,
  startUrl: string,
  listener: (event: PageCaptureLifecycleEvent) => void,
): () => void {
  const onUpdated = (updatedTabId: number, changeInfo: { status?: string; url?: string }) => {
    if (
      updatedTabId === tabId &&
      (changeInfo.status === 'loading' ||
        (changeInfo.url !== undefined && changeInfo.url !== startUrl))
    ) {
      listener('navigation');
    }
  };
  const onRemoved = (removedTabId: number) => {
    if (removedTabId === tabId) listener('tab-closed');
  };

  browser.tabs.onUpdated.addListener(onUpdated);
  browser.tabs.onRemoved.addListener(onRemoved);

  return () => {
    browser.tabs.onUpdated.removeListener(onUpdated);
    browser.tabs.onRemoved.removeListener(onRemoved);
  };
}

async function collectPageInfo(
  tabId: number,
  renderWaitMs: CaptureSettings['renderWaitMs'],
  correlationId: string,
): Promise<PageInfoResponse> {
  let tabUrl: string | undefined;
  try {
    tabUrl = (await browser.tabs.get(tabId)).url;
  } catch {
    // A tab that is already absent cannot start a capture session.
  }

  if (!tabUrl) {
    return createPageInfoError(
      createCaptureError('page-unavailable', { operation: 'page-info' }),
      correlationId,
    );
  }

  const session = await runPageCaptureSession({
    startUrl: tabUrl,
    timeoutMs: getPageCaptureTimeoutMs(renderWaitMs),
    capture: () => collectPageInfoFromContent(tabId, tabUrl, renderWaitMs, correlationId),
    getCurrentUrl: async () => (await browser.tabs.get(tabId)).url ?? null,
    subscribe: (listener) => subscribeToTabLifecycle(tabId, tabUrl, listener),
  });

  return session.ok ? session.value : createPageInfoError(session.error, correlationId);
}

export default defineBackground(() => {
  console.info(`${RUNTIME_LOG_PREFIX} Background service worker initialized.`);

  browser.action.onClicked.addListener((tab) => {
    if (tab.id === undefined) return;

    void browser.sidePanel
      .open({ tabId: tab.id })
      .catch((error) => console.error(`${RUNTIME_LOG_PREFIX} Failed to open side panel.`, error));
  });

  browser.runtime.onMessage.addListener(async (message: unknown) => {
    if (!isPageInfoRequest(message)) return;

    return collectPageInfo(
      message.payload.tabId,
      message.payload.renderWaitMs,
      message.correlationId,
    );
  });
});
