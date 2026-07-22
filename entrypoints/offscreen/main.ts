import { RUNTIME_LOG_PREFIX } from '@sitecapsule/shared';

document.documentElement.dataset.sitecapsuleRuntime = 'ready';

console.info(`${RUNTIME_LOG_PREFIX} Offscreen runtime initialized.`);
