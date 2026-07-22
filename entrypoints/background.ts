import { RUNTIME_LOG_PREFIX } from '@sitecapsule/shared';

export default defineBackground(() => {
  console.info(`${RUNTIME_LOG_PREFIX} Background service worker initialized.`);
});
