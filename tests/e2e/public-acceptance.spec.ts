import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';

interface BaselineCase {
  id: string;
  owner: string;
  url: string;
  finalUrl: string;
  pageType: string;
  runtimeProfile: string;
  keyResources: string[];
  captureExpectation: {
    outcome: 'core-content-offline' | 'documented-degradation-allowed';
    assertions: string[];
  };
  knownLimitations: string[];
}

interface Baseline {
  schemaVersion: number;
  baselineId: string;
  cases: BaselineCase[];
}

interface PageMetrics {
  title: string;
  bodyTextChars: number;
  headings: string[];
  documentWidth: number;
  documentHeight: number;
  imageCount: number;
  loadedImageCount: number;
}

type Classification = 'pass' | 'allowed-degradation' | 'product-failure' | 'external-unavailable';

interface AcceptanceCaseResult {
  id: string;
  url: string;
  classification: Classification;
  visual: { status: string; screenshotPath: string | null; [key: string]: unknown };
  console: { status: string; errorCount: number; [key: string]: unknown };
  resourceIntegrity: {
    status: string;
    failedRequests: number;
    httpErrors: number;
    [key: string]: unknown;
  };
  offline: {
    status: string;
    externalRequests: number;
    screenshotPath: string | null;
    [key: string]: unknown;
  };
  notes: string[];
  [key: string]: unknown;
}

const extensionPath = resolve(process.cwd(), '.output/chrome-mv3');
const baselinePath = resolve(process.cwd(), 'tests/baselines/public-sites.json');
const evidenceRoot = resolve(process.cwd(), 'test-results/public-acceptance');
const navigationTimeoutMs = 30_000;
const captureTimeoutMs = 120_000;
const captureSettings = {
  mode: 'current-page',
  profile: 'standard',
  renderWaitMs: 5_000,
  concurrentDownloads: 6,
  includeMedia: false,
  includeThirdPartyResources: false,
} as const;

function runId(): string {
  return new Date().toISOString().replaceAll(':', '').replaceAll('.', '-');
}

function gitValue(args: string[]): string | null {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function evidencePath(path: string): string {
  return relative(process.cwd(), path).replaceAll('\\', '/');
}

function safeMessage(value: string): string {
  return value
    .replaceAll(/\u001b\[[0-9;]*m/g, '')
    .replaceAll(/https?:\/\/[^\s)"']+/g, (candidate) => {
      try {
        const url = new URL(candidate);
        url.search = '';
        url.hash = '';
        return url.href;
      } catch {
        return '[invalid-url]';
      }
    })
    .slice(0, 500);
}

async function pageMetrics(page: Page): Promise<PageMetrics> {
  return page.evaluate(() => {
    const text = document.body?.innerText ?? '';
    const images = [...document.images];
    return {
      title: document.title,
      bodyTextChars: text.trim().length,
      headings: [...document.querySelectorAll('h1, h2')]
        .map((heading) => heading.textContent?.trim() ?? '')
        .filter(Boolean)
        .slice(0, 8),
      documentWidth: Math.max(
        document.documentElement.scrollWidth,
        document.body?.scrollWidth ?? 0,
      ),
      documentHeight: Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight ?? 0,
      ),
      imageCount: images.length,
      loadedImageCount: images.filter((image) => image.complete && image.naturalWidth > 0).length,
    };
  });
}

async function extensionId(context: BrowserContext): Promise<string> {
  let [serviceWorker] = context.serviceWorkers();
  serviceWorker ??= await context.waitForEvent('serviceworker', { timeout: 15_000 });
  return new URL(serviceWorker.url()).host;
}

async function activateAndReadPage(panel: Page, target: Page): Promise<void> {
  await target.bringToFront();
  const tabId = await panel.evaluate(async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  });
  if (tabId === null) throw new Error('Current public-page tab ID is unavailable.');

  const session = await panel.context().newCDPSession(panel);
  try {
    await panel.getByRole('button', { name: /Use current page|Refresh page/ }).waitFor();
    await session.send('Runtime.evaluate', {
      expression: `(async () => {
        await chrome.tabs.update(${tabId}, { active: true });
        document.querySelector('button.primary-action')?.click();
      })()`,
      awaitPromise: true,
      userGesture: true,
    });
  } finally {
    await session.detach();
  }
  await expect(panel.getByRole('button', { name: 'Create archive' })).toBeEnabled({
    timeout: 30_000,
  });
}

async function waitForNewDownload(panel: Page, previousIds: number[]) {
  return expect
    .poll(
      () =>
        panel.evaluate(async (knownIds) => {
          const downloads = await browser.downloads.search({ orderBy: ['-startTime'] });
          const found = downloads.find(
            ({ id, state, mime }) =>
              !knownIds.includes(id) && state === 'complete' && mime === 'application/zip',
          );
          return found
            ? { id: found.id, filename: found.filename, bytesReceived: found.bytesReceived }
            : null;
        }, previousIds),
      { timeout: 30_000 },
    )
    .not.toBeNull();
}

async function downloadArchive(panel: Page): Promise<{ filename: string; bytesReceived: number }> {
  const previous = await panel.evaluate(async () =>
    (await browser.downloads.search({})).map(({ id }) => id),
  );
  await panel.getByRole('button', { name: 'Download ZIP' }).click();
  await waitForNewDownload(panel, previous);
  const downloaded = await panel.evaluate(async (knownIds) => {
    const downloads = await browser.downloads.search({ orderBy: ['-startTime'] });
    return (
      downloads.find(
        ({ id, state, mime }) =>
          !knownIds.includes(id) && state === 'complete' && mime === 'application/zip',
      ) ?? null
    );
  }, previous);
  if (!downloaded) throw new Error('Completed archive download is unavailable.');
  return { filename: downloaded.filename, bytesReceived: downloaded.bytesReceived };
}

async function extractArchive(archivePath: string, outputDirectory: string): Promise<string[]> {
  const entries = unzipSync(await readFile(archivePath));
  const outputRoot = resolve(outputDirectory);
  for (const [entryPath, bytes] of Object.entries(entries)) {
    const outputPath = resolve(outputRoot, entryPath);
    if (outputPath !== outputRoot && !outputPath.startsWith(`${outputRoot}${sep}`)) {
      throw new Error(`Archive entry escapes extraction directory: ${entryPath}`);
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, bytes);
  }
  return Object.keys(entries).sort();
}

function classify(result: {
  available: boolean;
  visualOk: boolean;
  archiveOk: boolean;
  offlineOk: boolean;
  expectedDegradation: boolean;
  hasReviewFindings: boolean;
}): Classification {
  if (!result.available) return 'external-unavailable';
  if (!result.visualOk || !result.archiveOk || !result.offlineOk) return 'product-failure';
  if (result.expectedDegradation || result.hasReviewFindings) return 'allowed-degradation';
  return 'pass';
}

function markdownReport(report: {
  runId: string;
  baselineId: string;
  startedAt: string;
  finishedAt: string;
  git: { commit: string | null; dirty: boolean };
  environment: { chrome: string; viewport: { width: number; height: number } };
  captureSettings: typeof captureSettings;
  summary: Record<Classification | 'total', number>;
  cases: AcceptanceCaseResult[];
}): string {
  const rows = report.cases.map(
    (item) =>
      `| ${item.id} | ${item.classification} | ${item.visual.status} | ${item.console.status} (${item.console.errorCount}) | ${item.resourceIntegrity.status} (${item.resourceIntegrity.failedRequests}/${item.resourceIntegrity.httpErrors}) | ${item.offline.status} (${item.offline.externalRequests}) |`,
  );
  return `# SiteCapsule Public Acceptance Report

| Field | Value |
| --- | --- |
| Run ID | \`${report.runId}\` |
| Baseline | \`${report.baselineId}\` |
| Started | ${report.startedAt} |
| Finished | ${report.finishedAt} |
| Git commit | \`${report.git.commit ?? 'unavailable'}\` |
| Worktree dirty | ${report.git.dirty ? 'yes' : 'no'} |
| Chrome | ${report.environment.chrome} |
| Viewport | ${report.environment.viewport.width} x ${report.environment.viewport.height} |
| Capture settings | \`${JSON.stringify(report.captureSettings)}\` |

## Summary

| Pass | Allowed degradation | Product failure | External unavailable | Total |
| ---: | ---: | ---: | ---: | ---: |
| ${report.summary.pass} | ${report.summary['allowed-degradation']} | ${report.summary['product-failure']} | ${report.summary['external-unavailable']} | ${report.summary.total} |

## Cases

| Case | Classification | Visual | Console errors | Resource failed/HTTP | Offline external |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

The machine report contains per-case URLs, baseline expectations, known limitations, metrics,
sanitized console errors, failed resource URLs, archive entries, and evidence paths. Public-site
availability is classified separately from SiteCapsule product failures. This report records
M10-T2 evidence only and does not decide M10-T3 MVP metrics.
`;
}

test('records visual, console, resource, archive, and offline evidence for the public baseline', async ({}, testInfo) => {
  test.skip(
    process.env.SITECAPSULE_PUBLIC_ACCEPTANCE !== '1',
    'Run with pnpm test:public-acceptance.',
  );
  test.setTimeout(45 * 60_000);

  const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as Baseline;
  const currentRunId = runId();
  const runDirectory = join(evidenceRoot, currentRunId);
  const downloadsDirectory = join(runDirectory, 'downloads');
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'sitecapsule-public-acceptance-'));
  await mkdir(downloadsDirectory, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDirectory, {
    channel: 'chromium',
    headless: true,
    acceptDownloads: true,
    downloadsPath: downloadsDirectory,
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const browserVersion = context.browser()?.version() ?? 'unknown';
  const extensionIdentifier = await extensionId(context);
  const startedAt = new Date().toISOString();
  const results: AcceptanceCaseResult[] = [];

  try {
    for (const baselineCase of baseline.cases) {
      const caseDirectory = join(runDirectory, baselineCase.id);
      console.log(`M10-T2 ${results.length + 1}/${baseline.cases.length}: ${baselineCase.id}`);
      await mkdir(caseDirectory, { recursive: true });
      const onlineScreenshot = join(caseDirectory, 'online.png');
      const offlineScreenshot = join(caseDirectory, 'offline.png');
      const consoleErrors: string[] = [];
      const failedRequests: string[] = [];
      const httpErrors: Array<{ url: string; status: number }> = [];
      const notes: string[] = [];
      const page = await context.newPage();
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(safeMessage(message.text()));
      });
      page.on('pageerror', (error) => consoleErrors.push(safeMessage(error.message)));
      page.on('requestfailed', (request) => failedRequests.push(safeMessage(request.url())));
      page.on('response', (response) => {
        if (response.status() >= 400) {
          httpErrors.push({ url: safeMessage(response.url()), status: response.status() });
        }
      });

      let mainStatus: number | null = null;
      let availabilityError: string | null = null;
      let onlineMetrics: PageMetrics | null = null;
      let screenshotBytes = 0;
      try {
        const response = await page.goto(baselineCase.url, {
          waitUntil: 'domcontentloaded',
          timeout: navigationTimeoutMs,
        });
        mainStatus = response?.status() ?? null;
        await page.waitForTimeout(captureSettings.renderWaitMs);
        onlineMetrics = await pageMetrics(page);
        const screenshot = await page.screenshot({
          path: onlineScreenshot,
          animations: 'disabled',
        });
        screenshotBytes = screenshot.byteLength;
      } catch (error) {
        availabilityError = safeMessage(error instanceof Error ? error.message : String(error));
      }

      const available =
        availabilityError === null &&
        (mainStatus === null || mainStatus < 400) &&
        onlineMetrics !== null &&
        onlineMetrics.bodyTextChars > 0;
      const visualOk =
        available &&
        onlineMetrics !== null &&
        onlineMetrics.documentWidth > 0 &&
        onlineMetrics.documentHeight > 0 &&
        screenshotBytes > 1_000;

      let archiveOk = false;
      let archivePath: string | null = null;
      let archiveBytes = 0;
      let archiveEntries: string[] = [];
      let archiveError: string | null = null;
      let panelDiagnostics: string | null = null;
      let offlineOk = false;
      let offlineMetrics: PageMetrics | null = null;
      let offlineTextRatio: number | null = null;
      let offlineExternalRequests: string[] = [];
      let offlineError: string | null = null;

      if (available && onlineMetrics) {
        const panel = await context.newPage();
        try {
          await panel.goto(`chrome-extension://${extensionIdentifier}/sidepanel.html`);
          await activateAndReadPage(panel, page);
          await panel.getByRole('button', { name: 'Create archive' }).click();
          await expect(
            panel.getByRole('heading', { name: 'Archive ready', exact: true }),
          ).toBeVisible({
            timeout: captureTimeoutMs,
          });
          const downloaded = await downloadArchive(panel);
          archivePath = downloaded.filename;
          archiveBytes = downloaded.bytesReceived;
          const extractedDirectory = join(caseDirectory, 'archive');
          archiveEntries = await extractArchive(downloaded.filename, extractedDirectory);
          archiveOk = archiveEntries.includes('index.html') && archiveBytes > 0;

          if (archiveOk) {
            const offlinePage = await context.newPage();
            offlinePage.on('request', (request) => {
              if (/^(?:https?|wss?):/i.test(request.url())) {
                offlineExternalRequests.push(safeMessage(request.url()));
              }
            });
            try {
              await context.setOffline(true);
              await offlinePage.goto(pathToFileURL(join(extractedDirectory, 'index.html')).href, {
                waitUntil: 'load',
                timeout: navigationTimeoutMs,
              });
              offlineMetrics = await pageMetrics(offlinePage);
              offlineTextRatio = Math.min(
                1,
                offlineMetrics.bodyTextChars / Math.max(1, onlineMetrics.bodyTextChars),
              );
              await offlinePage.screenshot({ path: offlineScreenshot, animations: 'disabled' });
              offlineOk = offlineMetrics.bodyTextChars > 0 && offlineTextRatio >= 0.25;
            } catch (error) {
              offlineError = safeMessage(error instanceof Error ? error.message : String(error));
            } finally {
              await context.setOffline(false);
              await offlinePage.close();
            }
          }
        } catch (error) {
          archiveError = safeMessage(error instanceof Error ? error.message : String(error));
          panelDiagnostics = safeMessage(
            await panel
              .locator('body')
              .innerText()
              .catch(() => ''),
          );
          await panel
            .screenshot({ path: join(caseDirectory, 'panel-error.png') })
            .catch(() => undefined);
        } finally {
          await panel.close();
        }
      }

      if (consoleErrors.length > 0) notes.push('The live page emitted console errors.');
      if (failedRequests.length > 0 || httpErrors.length > 0) {
        notes.push('The live page had failed or HTTP-error resource requests.');
      }
      if (offlineExternalRequests.length > 0) {
        notes.push('The offline archive attempted external requests.');
      }
      notes.push(...baselineCase.knownLimitations);

      const hasReviewFindings =
        consoleErrors.length > 0 ||
        failedRequests.length > 0 ||
        httpErrors.length > 0 ||
        offlineExternalRequests.length > 0 ||
        (onlineMetrics !== null && onlineMetrics.loadedImageCount < onlineMetrics.imageCount) ||
        (offlineTextRatio !== null && offlineTextRatio < 0.8);
      const classification = classify({
        available,
        visualOk,
        archiveOk,
        offlineOk,
        expectedDegradation:
          baselineCase.captureExpectation.outcome === 'documented-degradation-allowed',
        hasReviewFindings,
      });

      results.push({
        id: baselineCase.id,
        owner: baselineCase.owner,
        url: baselineCase.url,
        expectedFinalUrl: baselineCase.finalUrl,
        observedFinalUrl: available ? page.url() : null,
        pageType: baselineCase.pageType,
        runtimeProfile: baselineCase.runtimeProfile,
        keyResources: baselineCase.keyResources,
        captureExpectation: baselineCase.captureExpectation,
        knownLimitations: baselineCase.knownLimitations,
        classification,
        availability: {
          status: available ? 'reachable' : 'externally-unavailable',
          mainStatus,
          error: availabilityError,
        },
        visual: {
          status: visualOk ? 'passed' : available ? 'failed' : 'not-run',
          screenshotPath: screenshotBytes > 0 ? evidencePath(onlineScreenshot) : null,
          screenshotBytes,
          metrics: onlineMetrics,
        },
        console: {
          status: !available ? 'not-run' : consoleErrors.length === 0 ? 'passed' : 'review',
          errorCount: consoleErrors.length,
          errors: [...new Set(consoleErrors)].slice(0, 50),
        },
        resourceIntegrity: {
          status: !available
            ? 'not-run'
            : failedRequests.length === 0 && httpErrors.length === 0
              ? 'passed'
              : 'review',
          failedRequests: failedRequests.length,
          failedRequestUrls: [...new Set(failedRequests)].slice(0, 100),
          httpErrors: httpErrors.length,
          httpErrorResponses: httpErrors.slice(0, 100),
        },
        archive: {
          status: !available ? 'not-run' : archiveOk ? 'passed' : 'failed',
          path: archivePath ? evidencePath(archivePath) : null,
          bytes: archiveBytes,
          entryCount: archiveEntries.length,
          entries: archiveEntries,
          error: archiveError,
          panelDiagnostics,
        },
        offline: {
          status: !archiveOk ? 'not-run' : offlineOk ? 'passed' : 'failed',
          screenshotPath: offlineOk ? evidencePath(offlineScreenshot) : null,
          metrics: offlineMetrics,
          textRatio: offlineTextRatio,
          externalRequests: offlineExternalRequests.length,
          externalRequestUrls: [...new Set(offlineExternalRequests)].slice(0, 100),
          error: offlineError,
        },
        notes,
      });
      await page.close();
    }

    const summary = {
      pass: results.filter(({ classification }) => classification === 'pass').length,
      'allowed-degradation': results.filter(
        ({ classification }) => classification === 'allowed-degradation',
      ).length,
      'product-failure': results.filter(
        ({ classification }) => classification === 'product-failure',
      ).length,
      'external-unavailable': results.filter(
        ({ classification }) => classification === 'external-unavailable',
      ).length,
      total: results.length,
    };
    const finishedAt = new Date().toISOString();
    const report = {
      schemaVersion: 1,
      runId: currentRunId,
      baselineId: baseline.baselineId,
      startedAt,
      finishedAt,
      git: {
        commit: gitValue(['rev-parse', 'HEAD']),
        branch: gitValue(['branch', '--show-current']),
        dirty: (gitValue(['status', '--porcelain']) ?? '') !== '',
      },
      environment: {
        chrome: browserVersion,
        platform: process.platform,
        viewport: { width: 1440, height: 900 },
      },
      captureSettings,
      summary,
      cases: results,
    };
    const machine = `${JSON.stringify(report, null, 2)}\n`;
    const markdown = markdownReport(report);
    await Promise.all([
      writeFile(join(runDirectory, 'report.json'), machine, 'utf8'),
      writeFile(join(runDirectory, 'report.md'), markdown, 'utf8'),
      writeFile(join(evidenceRoot, 'latest.json'), machine, 'utf8'),
      writeFile(join(evidenceRoot, 'latest.md'), markdown, 'utf8'),
    ]);
    await testInfo.attach('public-acceptance-report', {
      path: join(runDirectory, 'report.json'),
      contentType: 'application/json',
    });
    expect(summary.total).toBe(baseline.cases.length);
  } finally {
    await context.close();
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});
