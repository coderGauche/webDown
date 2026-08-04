import { createCaptureError } from '@sitecapsule/domain';
import { rewriteHtmlResource } from '@sitecapsule/archive';
import { RUNTIME_LOG_PREFIX } from '@sitecapsule/shared';
import {
  createPageArchiveRewriteError,
  createPageArchiveRewriteResponse,
  createPageInfoError,
  createPageInfoResponse,
} from '@sitecapsule/messaging/protocol';
import {
  isPageArchiveRewriteRequest,
  isPageInfoCollectRequest,
} from '@sitecapsule/messaging/validators';
import {
  isContentRuntimeRequest,
  isTrustedBackgroundSender,
} from '@sitecapsule/messaging/runtime-policy';
import { capturePageSnapshot, waitForRender } from '@sitecapsule/page';

export default defineContentScript({
  registration: 'runtime',
  main() {
    console.info(`${RUNTIME_LOG_PREFIX} Content script initialized.`);

    browser.runtime.onMessage.addListener(async (message: unknown, sender) => {
      if (
        !isTrustedBackgroundSender(sender, browser.runtime.id) ||
        !isContentRuntimeRequest(message)
      ) {
        return;
      }
      if (isPageArchiveRewriteRequest(message)) {
        try {
          const result = rewriteHtmlResource({
            ...message.payload,
            documentPath: 'index.html',
            uncapturedResourcePolicy: 'neutralize',
            disableExecutableScripts: true,
          });
          return createPageArchiveRewriteResponse(
            result.html,
            result.rewrittenCount + result.cssRewrittenCount + result.srcsetRewrittenCount,
            message.correlationId,
          );
        } catch {
          return createPageArchiveRewriteError(
            createCaptureError('unexpected-error', {
              operation: 'page-capture',
              stage: 'rewriting',
            }),
            message.correlationId,
          );
        }
      }

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
