import { createCaptureError, toCaptureError } from '@sitecapsule/domain';
import type { CaptureError } from '@sitecapsule/domain';
import { CONTENT_SCRIPT_FILE, RUNTIME_LOG_PREFIX } from '@sitecapsule/shared';
import {
  createPageInfoCollectRequest,
  createPageInfoError,
  type PageInfoResponse,
} from '@sitecapsule/messaging/protocol';
import { isPageInfoRequest, isPageInfoResponse } from '@sitecapsule/messaging/validators';

async function sendPageInfoRequestWithCorrelation(
  tabId: number,
  tabUrl: string,
  correlationId?: string,
): Promise<PageInfoResponse | null> {
  try {
    const response: unknown = await browser.tabs.sendMessage(
      tabId,
      createPageInfoCollectRequest(tabUrl, correlationId),
    );
    return isPageInfoResponse(response) ? response : null;
  } catch {
    return null;
  }
}

async function waitForPageInfoResponse(
  tabId: number,
  tabUrl: string,
  correlationId: string,
): Promise<PageInfoResponse | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await sendPageInfoRequestWithCorrelation(tabId, tabUrl, correlationId);
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

async function collectPageInfo(tabId: number, correlationId: string): Promise<PageInfoResponse> {
  const tab = await browser.tabs.get(tabId);
  if (!tab.url) {
    return createPageInfoError(
      createCaptureError('page-unavailable', { operation: 'page-info' }),
      correlationId,
    );
  }

  const existingResponse = await sendPageInfoRequestWithCorrelation(tabId, tab.url, correlationId);
  if (existingResponse) return existingResponse;

  const injectionError = await injectContentScript(tabId);
  if (injectionError) return createPageInfoError(injectionError, correlationId);

  const injectedResponse = await waitForPageInfoResponse(tabId, tab.url, correlationId);
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

    return collectPageInfo(message.payload.tabId, message.correlationId);
  });
});
