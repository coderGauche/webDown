import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';

type ExtensionFixtures = {
  context: BrowserContext;
  extensionId: string;
};

const extensionPath = resolve(process.cwd(), '.output/chrome-mv3');
const fixtureOrigin = 'http://127.0.0.1:4173';
const offlineFixtureOrigin = 'http://sitecapsule.test:4173';

const test = base.extend<ExtensionFixtures>({
  context: async ({}, use, testInfo) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sitecapsule-playwright-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      acceptDownloads: true,
      downloadsPath: testInfo.outputPath('downloads'),
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--host-resolver-rules=MAP sitecapsule.test 127.0.0.1',
        '--no-proxy-server',
      ],
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

async function readCurrentPage(panelPage: Page, fixturePage: Page): Promise<void> {
  await fixturePage.bringToFront();
  const fixtureTabId = await panelPage.evaluate(async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  });
  expect(fixtureTabId).not.toBeNull();

  const extensionSession = await panelPage.context().newCDPSession(panelPage);
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
}

async function createAndDownloadArchive(panelPage: Page): Promise<string> {
  await panelPage.getByRole('button', { name: 'Create archive' }).click();
  await expect(
    panelPage.getByRole('heading', { name: 'Archive ready', exact: true }),
  ).toBeVisible();

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
  return archivePath;
}

async function extractArchive(archivePath: string, outputDirectory: string): Promise<void> {
  const archive = unzipSync(await readFile(archivePath));
  const outputRoot = resolve(outputDirectory);
  for (const [entryPath, bytes] of Object.entries(archive)) {
    const outputPath = resolve(outputRoot, entryPath);
    if (outputPath !== outputRoot && !outputPath.startsWith(`${outputRoot}${sep}`)) {
      throw new Error(`Archive entry escapes extraction directory: ${entryPath}`);
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, bytes);
  }
}

test('loads the extension and exports the current page archive', async ({
  context,
  extensionId,
}) => {
  const fixturePage = context.pages()[0] ?? (await context.newPage());
  await fixturePage.goto(`${fixtureOrigin}/archive-page.html`);
  await expect(
    fixturePage.getByRole('heading', { name: 'Offline archive acceptance page' }),
  ).toBeVisible();

  const panelPage = await context.newPage();
  await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panelPage).toHaveTitle('SiteCapsule');
  await panelPage.getByLabel('Language').selectOption('en');
  await panelPage.getByLabel('Render wait').fill('0');

  await readCurrentPage(panelPage, fixturePage);

  await expect(panelPage.getByText('SiteCapsule E2E fixture', { exact: true })).toBeVisible();
  await expect(panelPage.getByText(`${fixtureOrigin}/archive-page.html`).first()).toBeVisible();
  await expect(panelPage.getByText('Archive settings ready.')).toBeVisible();

  const archivePath = await createAndDownloadArchive(panelPage);
  await expect(panelPage.getByText('1 saved · 0 failed · 1 skipped').first()).toBeVisible();

  const archive = unzipSync(await readFile(archivePath));
  const indexBytes = archive['index.html'];
  if (!indexBytes) throw new Error('Downloaded ZIP does not contain index.html.');
  const indexHtml = new TextDecoder().decode(indexBytes);
  expect(indexHtml).toContain('local-e2e-capture-marker');
  expect(indexHtml).not.toContain('must-not-be-archived');
});

test('opens the exported archive offline without HTTP requests', async ({
  context,
  extensionId,
}, testInfo) => {
  const fixturePage = context.pages()[0] ?? (await context.newPage());
  await fixturePage.goto(`${offlineFixtureOrigin}/offline-page.html`);
  await expect(
    fixturePage.getByRole('heading', { name: 'Offline archive is local' }),
  ).toBeVisible();

  const panelPage = await context.newPage();
  await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panelPage.getByLabel('Language').selectOption('en');
  await panelPage.getByLabel('Render wait').fill('0');
  await readCurrentPage(panelPage, fixturePage);
  await expect(panelPage.getByText('SiteCapsule offline fixture', { exact: true })).toBeVisible();

  const archivePath = await createAndDownloadArchive(panelPage);
  const extractedDirectory = testInfo.outputPath('offline-archive');
  await extractArchive(archivePath, extractedDirectory);

  const offlinePage = await context.newPage();
  const attemptedRequests: string[] = [];
  offlinePage.on('request', (request) => attemptedRequests.push(request.url()));
  await context.setOffline(true);
  try {
    await offlinePage.goto(pathToFileURL(join(extractedDirectory, 'index.html')).href);
    await expect(
      offlinePage.getByRole('heading', { name: 'Offline archive is local' }),
    ).toBeVisible();
    await expect(offlinePage.locator('#offline-marker')).toHaveText('offline-local-request-marker');
    await expect(offlinePage.locator('.offline-logo')).toHaveJSProperty('complete', true);
    await expect(offlinePage.locator('.offline-logo')).toHaveJSProperty('naturalWidth', 64);
    await expect(offlinePage.locator('.offline-card')).toHaveCSS(
      'border-top-color',
      'rgb(23, 107, 83)',
    );
    await expect(offlinePage.locator('.offline-card')).toHaveCSS(
      'background-image',
      /background\.svg/,
    );
  } finally {
    await context.setOffline(false);
  }

  const externalRequests = attemptedRequests.filter((url) => /^(?:https?|wss?):/i.test(url));
  const localRequestPaths = attemptedRequests
    .filter((url) => url.startsWith('file:'))
    .map((url) => decodeURIComponent(new URL(url).pathname));
  const auditPath = testInfo.outputPath('offline-request-audit.json');
  await writeFile(
    auditPath,
    JSON.stringify({ offline: true, attemptedRequests, externalRequests }, null, 2),
    'utf8',
  );
  await testInfo.attach('offline-request-audit', {
    path: auditPath,
    contentType: 'application/json',
  });

  expect(externalRequests).toEqual([]);
  for (const fileName of ['index.html', 'offline.css', 'logo.svg', 'background.svg']) {
    expect(localRequestPaths.some((path) => path.endsWith(`/${fileName}`))).toBe(true);
  }
});
