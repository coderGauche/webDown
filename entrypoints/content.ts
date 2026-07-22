import { RUNTIME_LOG_PREFIX } from '@sitecapsule/shared';

export default defineContentScript({
  registration: 'runtime',
  main() {
    console.info(`${RUNTIME_LOG_PREFIX} Content script initialized.`);
  },
});
