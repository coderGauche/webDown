import { fileURLToPath } from 'node:url';
import { defineConfig } from 'wxt';

const sourceDirectory = fileURLToPath(new URL('./src', import.meta.url));

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
    action: {
      default_title: 'Open SiteCapsule',
      default_icon: extensionIcons,
    },
  },
});
