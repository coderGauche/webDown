import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, test as base, type BrowserContext } from '@playwright/test';
import { unzipSync } from 'fflate';

type ExtensionFixtures = {
  context: BrowserContext;
  extensionId: string;
};

const extensionPath = resolve(process.cwd(), '.output/chrome-mv3');

const test = base.extend<ExtensionFixtures>({
  context: async ({}, use, testInfo) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sitecapsule-playwright-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      acceptDownloads: true,
      downloadsPath: testInfo.outputPath('downloads'),
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });

    try {
      await use(context);
    } finally {
      await context.close();
      await rm(userDataDir, { recursive: true, force: true });
    }
  },
  extensionId: async ({ context }, use) => {
    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent('serviceworker');
    await use(new URL(serviceWorker.url()).host);
  },
});

test('loads the extension and exports the current page archive', async ({
  context,
  extensionId,
}) => {
  const fixturePage = context.pages()[0] ?? (await context.newPage());
  await fixturePage.goto('http://127.0.0.1:4173/archive-page.html');
  await expect(
    fixturePage.getByRole('heading', { name: 'Offline archive acceptance page' }),
  ).toBeVisible();

  const panelPage = await context.newPage();
  await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panelPage).toHaveTitle('SiteCapsule');
  await panelPage.getByLabel('Language').selectOption('en');
  await panelPage.getByLabel('Render wait').fill('0');

  await fixturePage.bringToFront();
  const fixtureTabId = await panelPage.evaluate(async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  });
  expect(fixtureTabId).not.toBeNull();

  const extensionSession = await context.newCDPSession(panelPage);
  await panelPage.getByRole('button', { name: 'Use current page' }).waitFor();
  // A directly opened side panel is also a browser tab. Switch back and dispatch
  // the panel action in one task so the extension observes the fixture as active.
  await extensionSession.send('Runtime.evaluate', {
    expression: `(async () => {
      await chrome.tabs.update(${fixtureTabId}, { active: true });
      document.querySelector('button.primary-action')?.click();
    })()`,
    awaitPromise: true,
    userGesture: true,
  });

  await expect(panelPage.getByText('SiteCapsule E2E fixture', { exact: true })).toBeVisible();
  await expect(
    panelPage.getByText('http://127.0.0.1:4173/archive-page.html').first(),
  ).toBeVisible();
  await expect(panelPage.getByText('Archive settings ready.')).toBeVisible();

  await panelPage.getByRole('button', { name: 'Create archive' }).click();
  await expect(
    panelPage.getByRole('heading', { name: 'Archive ready', exact: true }),
  ).toBeVisible();
  await expect(panelPage.getByText('1 saved · 0 failed · 1 skipped').first()).toBeVisible();

  await panelPage.getByRole('button', { name: 'Download ZIP' }).click();
  await expect(panelPage.getByText(/Download started/)).toBeVisible();

  const completedDownloads = await panelPage.evaluate(async () => {
    const downloads = await browser.downloads.search({ state: 'complete' });
    return downloads.map(({ filename, mime, state }) => ({ filename, mime, state }));
  });
  expect(completedDownloads).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ mime: 'application/zip', state: 'complete' }),
    ]),
  );
  const archivePath = completedDownloads.find(({ mime }) => mime === 'application/zip')?.filename;
  if (!archivePath) throw new Error('Completed ZIP download path is missing.');
  const archive = unzipSync(await readFile(archivePath));
  const indexBytes = archive['index.html'];
  if (!indexBytes) throw new Error('Downloaded ZIP does not contain index.html.');
  const indexHtml = new TextDecoder().decode(indexBytes);
  expect(indexHtml).toContain('local-e2e-capture-marker');
  expect(indexHtml).not.toContain('must-not-be-archived');
});
