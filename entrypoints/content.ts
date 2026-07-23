import { RUNTIME_LOG_PREFIX } from '@sitecapsule/shared';
import { createPageInfoResponse } from '@sitecapsule/messaging/protocol';
import { isPageInfoCollectRequest } from '@sitecapsule/messaging/validators';

export default defineContentScript({
  registration: 'runtime',
  main() {
    console.info(`${RUNTIME_LOG_PREFIX} Content script initialized.`);

    browser.runtime.onMessage.addListener(async (message: unknown) => {
      if (!isPageInfoCollectRequest(message)) return;

      return createPageInfoResponse(
        {
          title: document.title,
          url: window.location.href,
        },
        message.correlationId,
      );
    });
  },
});
