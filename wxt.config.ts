import { fileURLToPath } from 'node:url';
import { defineConfig } from 'wxt';

const sourceDirectory = fileURLToPath(new URL('./src', import.meta.url));
const e2eHostPermissions =
  process.env.SITECAPSULE_E2E === '1'
    ? ['http://127.0.0.1/*', 'http://sitecapsule.test/*']
    : undefined;
const publicAcceptanceHostPermissions =
  process.env.SITECAPSULE_PUBLIC_ACCEPTANCE === '1' ? ['https://*/*'] : undefined;

const extensionIcons = {
  16: 'icon-16.png',
  32: 'icon-32.png',
  48: 'icon-48.png',
  128: 'icon-128.png',
};

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    resolve: {
      alias: {
        '@sitecapsule': sourceDirectory,
      },
    },
  }),
  manifest: {
    name: 'SiteCapsule',
    description: 'Archive public webpages for structured offline review.',
    permissions: ['activeTab', 'scripting', 'storage', 'downloads', 'offscreen'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    ...(publicAcceptanceHostPermissions
      ? { host_permissions: publicAcceptanceHostPermissions }
      : e2eHostPermissions
        ? { host_permissions: e2eHostPermissions }
        : {}),
    action: {
      default_title: 'Open SiteCapsule',
      default_icon: extensionIcons,
    },
  },
});
