import { CONTENT_SCRIPT_FILE, RUNTIME_LOG_PREFIX } from '@sitecapsule/shared';
import {
  createPageInfoCollectRequest,
  createPageInfoError,
  isPageInfoRequest,
  isPageInfoResponse,
  type PageInfoResponse,
} from '@sitecapsule/messaging/protocol';

async function sendPageInfoRequestWithCorrelation(
  tabId: number,
  correlationId?: string,
): Promise<PageInfoResponse | null> {
  try {
    const response: unknown = await browser.tabs.sendMessage(
      tabId,
      createPageInfoCollectRequest(correlationId),
    );
    return isPageInfoResponse(response) ? response : null;
  } catch {
    return null;
  }
}

async function waitForPageInfoResponse(
  tabId: number,
  correlationId: string,
): Promise<PageInfoResponse | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await sendPageInfoRequestWithCorrelation(tabId, correlationId);
    if (response) return response;

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return null;
}

async function collectPageInfo(tabId: number, correlationId: string): Promise<PageInfoResponse> {
  const existingResponse = await sendPageInfoRequestWithCorrelation(tabId, correlationId);
  if (existingResponse) return existingResponse;

  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE],
    });
  } catch {
    return createPageInfoError('当前页面不允许注入内容脚本。', correlationId);
  }

  const injectedResponse = await waitForPageInfoResponse(tabId, correlationId);
  return injectedResponse ?? createPageInfoError('内容脚本未能返回页面信息。', correlationId);
}

export default defineBackground(() => {
  console.info(`${RUNTIME_LOG_PREFIX} Background service worker initialized.`);

  browser.runtime.onMessage.addListener(async (message: unknown) => {
    if (!isPageInfoRequest(message)) return;

    if (message.payload.tabId < 0) {
      return createPageInfoError('当前标签页不可用。', message.correlationId);
    }

    return collectPageInfo(message.payload.tabId, message.correlationId);
  });
});
