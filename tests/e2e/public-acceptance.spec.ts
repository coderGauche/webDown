import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { DOMParser as LinkedomDOMParser } from 'linkedom';

import { auditArchiveOfflineIntegritySync, ARCHIVE_METADATA_PATHS } from '../../src/archive';

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
  primaryVisualCount: number;
  visiblePrimaryVisualCount: number;
  styleSignatures: string[];
}

interface VisualContinuity {
  score: number;
  textRatio: number;
  loadedImageRatio: number;
  primaryVisualRatio: number;
  styleMatchRatio: number;
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
const baselinePath = resolve(
  process.cwd(),
  process.env.SITECAPSULE_PUBLIC_ACCEPTANCE_BASELINE ?? 'tests/baselines/public-sites.json',
);
const evidenceRoot = resolve(process.cwd(), 'test-results/public-acceptance');
const navigationTimeoutMs = 30_000;
const captureTimeoutMs = 120_000;
const captureSettings = {
  mode: 'current-page',
  profile: 'standard',
  renderWaitMs: 5_000,
  concurrentDownloads: 6,
  includeMedia: false,
  includeThirdPartyResources: true,
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

function safeDiagnosticText(value: string): string {
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
    .slice(0, 4_000);
}

async function pageMetrics(page: Page): Promise<PageMetrics> {
  return page.evaluate(() => {
    const text = document.body?.innerText ?? '';
    const images = [...document.images];
    const primaryVisuals = [
      ...document.querySelectorAll('header, main, nav, h1, h2, img, svg, canvas, video'),
    ].slice(0, 40);
    const visiblePrimaryVisuals = primaryVisuals.filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      );
    });
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
      primaryVisualCount: primaryVisuals.length,
      visiblePrimaryVisualCount: visiblePrimaryVisuals.length,
      styleSignatures: visiblePrimaryVisuals.slice(0, 20).map((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return [
          element.tagName.toLowerCase(),
          style.display,
          style.position,
          style.color,
          style.backgroundColor,
          style.fontFamily,
          style.fontSize,
          style.fontWeight,
          style.opacity,
          Math.round(rect.width / 8) * 8,
          Math.round(rect.height / 8) * 8,
        ].join('|');
      }),
    };
  });
}

function ratio(value: number, baseline: number): number {
  return baseline === 0 ? 1 : Math.min(1, value / baseline);
}

function visualContinuity(online: PageMetrics, offline: PageMetrics): VisualContinuity {
  const textRatio = ratio(offline.bodyTextChars, online.bodyTextChars);
  const loadedImageRatio = ratio(offline.loadedImageCount, online.loadedImageCount);
  const primaryVisualRatio = ratio(
    offline.visiblePrimaryVisualCount,
    online.visiblePrimaryVisualCount,
  );
  const comparedStyles = Math.min(online.styleSignatures.length, offline.styleSignatures.length);
  const styleMatches = Array.from({ length: comparedStyles }, (_, index) => index).filter(
    (index) => online.styleSignatures[index] === offline.styleSignatures[index],
  ).length;
  const styleMatchRatio = comparedStyles === 0 ? 1 : styleMatches / comparedStyles;
  return {
    score: (textRatio + loadedImageRatio + primaryVisualRatio + styleMatchRatio) / 4,
    textRatio,
    loadedImageRatio,
    primaryVisualRatio,
    styleMatchRatio,
  };
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

async function waitForArchiveTerminal(panel: Page): Promise<'completed' | 'failed'> {
  let status: 'completed' | 'failed' | null = null;
  await expect
    .poll(
      async () => {
        status = await panel.evaluate(() => {
          const headings = [...document.querySelectorAll('h1, h2, h3')].map(
            (heading) => heading.textContent?.trim() ?? '',
          );
          if (
            headings.includes('Archive ready') ||
            headings.includes('Archive ready with issues')
          ) {
            return 'completed';
          }
          if (headings.includes('Archive failed')) return 'failed';
          return null;
        });
        return status;
      },
      { timeout: captureTimeoutMs },
    )
    .not.toBeNull();
  return status!;
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
  const selectedIds = new Set(
    (process.env.SITECAPSULE_PUBLIC_ACCEPTANCE_CASES ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const baselineCases =
    selectedIds.size === 0
      ? baseline.cases
      : baseline.cases.filter(({ id }) => selectedIds.has(id));
  if (selectedIds.size > 0 && baselineCases.length !== selectedIds.size) {
    throw new Error('One or more requested public acceptance case IDs are unknown.');
  }
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
    for (const baselineCase of baselineCases) {
      const caseDirectory = join(runDirectory, baselineCase.id);
      console.log(`M10-R6 ${results.length + 1}/${baselineCases.length}: ${baselineCase.id}`);
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
      let archiveIntegrity: ReturnType<typeof auditArchiveOfflineIntegritySync> | null = null;
      let archiveError: string | null = null;
      let panelDiagnostics: string | null = null;
      let offlineOk = false;
      let offlineMetrics: PageMetrics | null = null;
      let offlineTextRatio: number | null = null;
      let offlineExternalRequests: string[] = [];
      let offlineExtensionRequests: string[] = [];
      let offlineFailedLocalRequests: string[] = [];
      let offlineMissingLocalRequests: string[] = [];
      let offlineError: string | null = null;
      let continuity: VisualContinuity | null = null;

      if (available && onlineMetrics) {
        const panel = await context.newPage();
        try {
          await panel.goto(`chrome-extension://${extensionIdentifier}/sidepanel.html`);
          await activateAndReadPage(panel, page);
          await panel.getByRole('button', { name: 'Create archive' }).click();
          const terminal = await waitForArchiveTerminal(panel);
          if (terminal === 'failed') {
            throw new Error('The extension reported Archive failed.');
          }
          const downloaded = await downloadArchive(panel);
          archivePath = downloaded.filename;
          archiveBytes = downloaded.bytesReceived;
          const extractedDirectory = join(caseDirectory, 'archive');
          archiveEntries = await extractArchive(downloaded.filename, extractedDirectory);
          archiveIntegrity = auditArchiveOfflineIntegritySync({
            archiveBytes: await readFile(downloaded.filename),
            parser: {
              parseFromString(input, mimeType) {
                return new LinkedomDOMParser().parseFromString(
                  input,
                  mimeType,
                ) as unknown as Document;
              },
            },
          });
          archiveOk =
            archiveEntries.includes('index.html') &&
            Object.values(ARCHIVE_METADATA_PATHS).every((path) => archiveEntries.includes(path)) &&
            archiveBytes > 0 &&
            archiveIntegrity.status === 'pass';

          if (archiveOk) {
            const offlinePage = await context.newPage();
            offlinePage.on('request', (request) => {
              if (/^(?:https?|wss?):/i.test(request.url())) {
                offlineExternalRequests.push(safeMessage(request.url()));
              } else if (/^(?:chrome|moz)-extension:/i.test(request.url())) {
                offlineExtensionRequests.push(safeMessage(request.url()));
              }
            });
            offlinePage.on('requestfailed', (request) => {
              if (request.url().startsWith('file:')) {
                offlineFailedLocalRequests.push(safeMessage(request.url()));
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
              continuity = visualContinuity(onlineMetrics, offlineMetrics);
              offlineMissingLocalRequests = [];
              for (const requestUrl of [...new Set(offlineFailedLocalRequests)]) {
                try {
                  await access(fileURLToPath(requestUrl));
                } catch {
                  offlineMissingLocalRequests.push(requestUrl);
                }
              }
              await offlinePage.screenshot({ path: offlineScreenshot, animations: 'disabled' });
              offlineOk =
                offlineMetrics.bodyTextChars > 0 &&
                offlineTextRatio >= 0.25 &&
                continuity.score >= 0.5 &&
                offlineExternalRequests.length === 0 &&
                offlineExtensionRequests.length === 0 &&
                offlineMissingLocalRequests.length === 0;
            } catch (error) {
              offlineError = safeMessage(error instanceof Error ? error.message : String(error));
            } finally {
              await context.setOffline(false);
              await offlinePage.close();
            }
          }
        } catch (error) {
          archiveError = safeMessage(error instanceof Error ? error.message : String(error));
          panelDiagnostics = safeDiagnosticText(
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
      if (offlineExtensionRequests.length > 0 || offlineMissingLocalRequests.length > 0) {
        notes.push('The offline archive attempted extension or missing local requests.');
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
          integrity: archiveIntegrity,
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
          extensionRequests: offlineExtensionRequests.length,
          extensionRequestUrls: [...new Set(offlineExtensionRequests)].slice(0, 100),
          failedLocalRequests: offlineFailedLocalRequests.length,
          failedLocalRequestUrls: [...new Set(offlineFailedLocalRequests)].slice(0, 100),
          missingLocalRequests: offlineMissingLocalRequests.length,
          missingLocalRequestUrls: [...new Set(offlineMissingLocalRequests)].slice(0, 100),
          visualContinuity: continuity,
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
    expect(summary.total).toBe(baselineCases.length);
  } finally {
    await context.close();
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});
