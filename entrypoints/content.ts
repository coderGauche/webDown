import { createCaptureError } from '@sitecapsule/domain';
import { RUNTIME_LOG_PREFIX } from '@sitecapsule/shared';
import { createPageInfoError, createPageInfoResponse } from '@sitecapsule/messaging/protocol';
import { isPageInfoCollectRequest } from '@sitecapsule/messaging/validators';
import { capturePageSnapshot, waitForRender } from '@sitecapsule/page';

export default defineContentScript({
  registration: 'runtime',
  main() {
    console.info(`${RUNTIME_LOG_PREFIX} Content script initialized.`);

    browser.runtime.onMessage.addListener(async (message: unknown) => {
      if (!isPageInfoCollectRequest(message)) return;

      const startUrl = document.URL;
      if (startUrl !== message.payload.tabUrl) {
        return createPageInfoError(
          createCaptureError('page-navigation-changed', {
            operation: 'page-capture',
            url: message.payload.tabUrl,
          }),
          message.correlationId,
        );
      }

      await waitForRender(message.payload.renderWaitMs);

      if (document.URL !== startUrl) {
        return createPageInfoError(
          createCaptureError('page-navigation-changed', {
            operation: 'page-capture',
            url: message.payload.tabUrl,
          }),
          message.correlationId,
        );
      }

      return createPageInfoResponse(
        capturePageSnapshot(document, message.payload.tabUrl),
        message.correlationId,
      );
    });
  },
});
