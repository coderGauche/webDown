import { CONTENT_SCRIPT_FILE, RUNTIME_LOG_PREFIX } from '@sitecapsule/shared';
import {
  createPageInfoCollectRequest,
  createPageInfoError,
  isPageInfoRequest,
  isPageInfoResponse,
  type PageInfoResponse,
} from '@sitecapsule/messaging/protocol';

async function sendPageInfoRequest(tabId: number): Promise<PageInfoResponse | null> {
  try {
    const response: unknown = await browser.tabs.sendMessage(tabId, createPageInfoCollectRequest());
    return isPageInfoResponse(response) ? response : null;
  } catch {
    return null;
  }
}

async function collectPageInfo(tabId: number): Promise<PageInfoResponse> {
  const existingResponse = await sendPageInfoRequest(tabId);
  if (existingResponse) return existingResponse;

  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE],
    });
  } catch {
    return createPageInfoError('当前页面不允许注入内容脚本。');
  }

  const injectedResponse = await sendPageInfoRequest(tabId);
  return injectedResponse ?? createPageInfoError('内容脚本未能返回页面信息。');
}

export default defineBackground(() => {
  console.info(`${RUNTIME_LOG_PREFIX} Background service worker initialized.`);

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isPageInfoRequest(message)) return;

    if (message.tabId < 0) {
      return createPageInfoError('当前标签页不可用。');
    }

    return collectPageInfo(message.tabId);
  });
});
