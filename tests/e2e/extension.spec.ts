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
const lastCaptureJobStorageKey = 'sitecapsule.lastCaptureJobId';

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
  await createArchive(panelPage);

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

async function createArchive(panelPage: Page): Promise<void> {
  await panelPage.getByRole('button', { name: 'Create archive' }).click();
  await expect(
    panelPage.getByRole('heading', { name: 'Archive ready', exact: true }),
  ).toBeVisible();
}

async function readLastCaptureJobId(panelPage: Page): Promise<string | null> {
  return panelPage.evaluate(async (storageKey) => {
    const stored = await browser.storage.local.get(storageKey);
    const value = stored[storageKey];
    return typeof value === 'string' ? value : null;
  }, lastCaptureJobStorageKey);
}

async function readPersistedCaptureSnapshot(panelPage: Page, jobId: string) {
  return panelPage.evaluate(async (requestedJobId) => {
    const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
      const request = indexedDB.open('sitecapsule');
      request.onsuccess = () => resolveDatabase(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction(['jobs', 'resources'], 'readonly');
      const read = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolveRequest, reject) => {
          request.onsuccess = () => resolveRequest(request.result);
          request.onerror = () => reject(request.error);
        });
      const job = (await read(transaction.objectStore('jobs').get(requestedJobId))) as
        | {
            id: string;
            status: string;
            counters: Record<string, number>;
          }
        | undefined;
      const resources = (await read(
        transaction.objectStore('resources').index('jobId').getAll(requestedJobId),
      )) as Array<{ id: string; state: string; originalUrl: string }>;
      return {
        job: job ? { id: job.id, status: job.status, counters: { ...job.counters } } : null,
        resources: resources
          .map(({ id, state, originalUrl }) => ({ id, state, originalUrl }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      };
    } finally {
      database.close();
    }
  }, jobId);
}

async function terminateExtensionServiceWorker(
  context: BrowserContext,
  panelPage: Page,
  extensionId: string,
) {
  const serviceWorkerUrl = `chrome-extension://${extensionId}/background.js`;
  if (!context.serviceWorkers().some((candidate) => candidate.url() === serviceWorkerUrl)) {
    throw new Error('Extension Service Worker is not running.');
  }
  const browserInstance = context.browser();
  if (!browserInstance) throw new Error('Chromium browser instance is unavailable.');

  const session = await context.newCDPSession(panelPage);
  const browserSession = await browserInstance.newBrowserCDPSession();
  const versions = new Map<
    string,
    { scriptURL: string; runningStatus: string; targetId?: string }
  >();
  session.on('ServiceWorker.workerVersionUpdated', ({ versions: updates }) => {
    for (const version of updates) versions.set(version.versionId, version);
  });
  try {
    await session.send('ServiceWorker.enable');
    await expect
      .poll(
        () =>
          [...versions.values()].some(
            (version) =>
              version.scriptURL === serviceWorkerUrl && version.runningStatus === 'running',
          ),
        { timeout: 5_000 },
      )
      .toBe(true);
    const version = [...versions.entries()].find(
      ([, candidate]) =>
        candidate.scriptURL === serviceWorkerUrl && candidate.runningStatus === 'running',
    );
    if (!version?.[1].targetId) throw new Error('Running Service Worker version has no target ID.');
    const [versionId, { targetId }] = version;
    await session.send('ServiceWorker.stopWorker', { versionId });
    await expect
      .poll(() => versions.get(versionId)?.runningStatus, { timeout: 5_000 })
      .toBe('stopped');
    await expect
      .poll(async () => {
        const { targetInfos } = await browserSession.send('Target.getTargets');
        return targetInfos.some((target) => target.targetId === targetId);
      })
      .toBe(false);
    return { serviceWorkerUrl, versionId, targetId };
  } finally {
    await browserSession.detach();
    await session.detach();
  }
}

async function waitForRestartedServiceWorkerTarget(
  context: BrowserContext,
  serviceWorkerUrl: string,
): Promise<string> {
  const browserInstance = context.browser();
  if (!browserInstance) throw new Error('Chromium browser instance is unavailable.');
  const session = await browserInstance.newBrowserCDPSession();
  try {
    await expect
      .poll(
        async () => {
          const { targetInfos } = await session.send('Target.getTargets');
          return targetInfos.some(
            (target) => target.type === 'service_worker' && target.url === serviceWorkerUrl,
          );
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    const { targetInfos } = await session.send('Target.getTargets');
    const restartedTarget = targetInfos.find(
      (target) => target.type === 'service_worker' && target.url === serviceWorkerUrl,
    );
    if (!restartedTarget) throw new Error('Restarted Service Worker target is unavailable.');
    return restartedTarget.targetId;
  } finally {
    await session.detach();
  }
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

test('restores persisted capture data after the extension Service Worker restarts', async ({
  context,
  extensionId,
}, testInfo) => {
  const fixturePage = context.pages()[0] ?? (await context.newPage());
  await fixturePage.goto(`${fixtureOrigin}/archive-page.html`);

  const panelPage = await context.newPage();
  await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panelPage.getByLabel('Language').selectOption('en');
  await panelPage.getByLabel('Render wait').fill('0');
  await readCurrentPage(panelPage, fixturePage);
  await createArchive(panelPage);
  await expect(panelPage.getByRole('button', { name: 'Download ZIP' })).toBeEnabled();

  const jobId = await readLastCaptureJobId(panelPage);
  if (!jobId) throw new Error('Completed task did not persist the recent job pointer.');
  const beforeRestart = await readPersistedCaptureSnapshot(panelPage, jobId);
  expect(beforeRestart.job).toMatchObject({ id: jobId, status: 'completed' });
  expect(beforeRestart.resources).toHaveLength(2);

  const stoppedWorker = await terminateExtensionServiceWorker(context, panelPage, extensionId);
  await panelPage.close();

  const restoredPanelPage = await context.newPage();
  await restoredPanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const restartedTargetId = await waitForRestartedServiceWorkerTarget(
    context,
    stoppedWorker.serviceWorkerUrl,
  );
  expect(restartedTargetId).not.toBe('');

  await expect(
    restoredPanelPage.getByRole('heading', { name: 'Archive ready', exact: true }),
  ).toBeVisible();
  await expect(restoredPanelPage.getByText('1 saved · 0 failed · 1 skipped').first()).toBeVisible();
  await expect(restoredPanelPage.getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(restoredPanelPage.getByRole('button', { name: 'Download ZIP' })).toBeDisabled();
  await expect(
    restoredPanelPage.getByText(
      'The ZIP is no longer in this browser session. Run the archive again to download it.',
    ),
  ).toBeVisible();
  await expect(restoredPanelPage.getByText(/metadata only/).first()).toBeVisible();

  expect(await readLastCaptureJobId(restoredPanelPage)).toBe(jobId);
  const afterRestart = await readPersistedCaptureSnapshot(restoredPanelPage, jobId);
  expect(afterRestart).toEqual(beforeRestart);

  const auditPath = testInfo.outputPath('service-worker-restart-audit.json');
  await writeFile(
    auditPath,
    JSON.stringify(
      {
        serviceWorkerUrl: stoppedWorker.serviceWorkerUrl,
        originalVersionId: stoppedWorker.versionId,
        originalTargetId: stoppedWorker.targetId,
        workerReachedStoppedState: true,
        stoppedTargetDisappeared: true,
        restartedTargetId,
        restartedTargetAppeared: true,
        targetIdReused: restartedTargetId === stoppedWorker.targetId,
        jobId,
        beforeRestart,
        afterRestart,
        archiveAvailableAfterRestart: false,
      },
      null,
      2,
    ),
    'utf8',
  );
  await testInfo.attach('service-worker-restart-audit', {
    path: auditPath,
    contentType: 'application/json',
  });
});
