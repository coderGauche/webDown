import { RUNTIME_LOG_PREFIX } from '@sitecapsule/shared';
import { createPageInfoResponse, isPageInfoCollectRequest } from '@sitecapsule/messaging/protocol';

export default defineContentScript({
  registration: 'runtime',
  main() {
    console.info(`${RUNTIME_LOG_PREFIX} Content script initialized.`);

    browser.runtime.onMessage.addListener(async (message: unknown) => {
      if (!isPageInfoCollectRequest(message)) return;

      return createPageInfoResponse({
        title: document.title,
        url: window.location.href,
      });
    });
  },
});
