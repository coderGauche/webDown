import {
  SiteCapsuleError,
  createCaptureError,
  toCaptureError,
  type CaptureError,
  type CaptureJob,
  type CaptureSettings,
  type ResourceRecord,
} from '@sitecapsule/domain';
import {
  createArchiveLayoutZipSync,
  createResourcePathMappings,
  rewriteCssResource,
  type ResourcePathMapping,
} from '@sitecapsule/archive';
import {
  TaskByteBudget,
  applyResourceResponseMetadata,
  checkResourceNetworkAccess,
  checkResourceResponseNetworkPolicy,
  classifyResourceResponse,
  consumeResourceBodyWithLimits,
  createSecureResourceFetchInit,
  runRequestWithRetry,
  runResourceDownloadBatch,
  type ResourceDownloadWorker,
  type ResourceHttpFailure,
} from '@sitecapsule/download';
import { runCapturePipeline, type CapturePipelineHandlers } from '@sitecapsule/jobs';
import { CONTENT_SCRIPT_FILE, RUNTIME_LOG_PREFIX } from '@sitecapsule/shared';
import {
  createPageInfoCollectRequest,
  createPageArchiveRewriteRequest,
  createCaptureJobError,
  createCaptureJobResponse,
  createCaptureJobUpdatedEvent,
  createPageInfoError,
  type PageInfo,
  type PageInfoResponse,
} from '@sitecapsule/messaging/protocol';
import {
  isCaptureJobCreateRequest,
  isCaptureJobGetRequest,
  isPageArchiveRewriteResponse,
  isPageInfoRequest,
  isPageInfoResponse,
} from '@sitecapsule/messaging/validators';
import { checkCurrentSiteAccess } from '@sitecapsule/permissions';
import {
  getPageCaptureTimeoutMs,
  runPageCaptureSession,
  type PageCaptureLifecycleEvent,
} from '@sitecapsule/page';
import { jobRepository } from '@sitecapsule/storage';

const LAST_CAPTURE_JOB_STORAGE_KEY = 'sitecapsule.lastCaptureJobId';
const archiveArtifacts = new Map<string, Uint8Array>();

type RuntimeCaptureContext = {
  page: PageInfo | null;
  resources: ResourceRecord[];
  bodies: Map<string, Uint8Array>;
  mappings: ResourcePathMapping[];
  rewrittenHtml: string | null;
};

function createMemorySink(onClose: (bytes: Uint8Array) => void) {
  const chunks: Uint8Array[] = [];
  return {
    write(chunk: Uint8Array) {
      chunks.push(chunk.slice());
    },
    close() {
      const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      onClose(bytes);
    },
    abort() {
      chunks.length = 0;
    },
  };
}

function networkFailure(reason: string): CaptureError {
  return createCaptureError(
    reason === 'permission-denied' ? 'permission-denied' : 'network-request-failed',
    {
      operation: 'resource-download',
    },
  );
}

function isThirdPartyUrl(url: string, pageUrl: string): boolean {
  return new URL(url).origin !== new URL(pageUrl).origin;
}

function shouldSkipResource(
  page: PageInfo,
  job: CaptureJob,
  node: PageInfo['resourceGraph']['nodes'][number],
): boolean {
  if (node.classification.kind !== 'network') return true;
  if (!job.settings.includeScripts && node.inference.resourceType === 'script') return true;
  if (
    !job.settings.includeMedia &&
    (node.inference.resourceType === 'video' || node.inference.resourceType === 'audio')
  ) {
    return true;
  }
  return !job.settings.includeThirdPartyResources && isThirdPartyUrl(node.url, page.finalUrl);
}

function createResourceRecords(page: PageInfo, job: CaptureJob): ResourceRecord[] {
  const primary: ResourceRecord = {
    id: `${job.id}:document`,
    jobId: job.id,
    originalUrl: page.finalUrl,
    referrerUrl: page.finalUrl,
    type: 'document',
    discoverySources: ['dom'],
    mimeType: 'text/html',
    state: 'queued',
  };
  return [
    primary,
    ...page.resourceGraph.nodes.map((node) => ({
      id: `${job.id}:resource:${node.ordinal}`,
      jobId: job.id,
      originalUrl: node.url,
      referrerUrl: page.finalUrl,
      type: node.inference.resourceType,
      discoverySources: [...node.discoverySources],
      ...(node.inference.mimeTypeHint ? { mimeType: node.inference.mimeTypeHint } : {}),
      state: shouldSkipResource(page, job, node) ? ('skipped' as const) : ('queued' as const),
    })),
  ];
}

function createDownloadWorker(
  context: RuntimeCaptureContext,
  job: CaptureJob,
  budget: TaskByteBudget,
): ResourceDownloadWorker {
  return async (resource, _index, signal) => {
    if (resource.id === `${job.id}:document`) {
      const bytes = new TextEncoder().encode(context.page?.serializedDom ?? '');
      context.bodies.set(resource.id, bytes);
      return {
        status: 'saved',
        resource: { ...resource, state: 'saved', byteLength: bytes.byteLength },
      };
    }

    const access = await checkResourceNetworkAccess(resource.originalUrl, (request) =>
      browser.permissions.contains(request),
    );
    if (access.status === 'blocked') {
      return { status: 'failed', error: networkFailure(access.reason) };
    }

    const request = await runRequestWithRetry(
      async ({ signal: attemptSignal }) => {
        const response = await fetch(access.url, createSecureResourceFetchInit(attemptSignal));
        return classifyResourceResponse(access.url, response);
      },
      { signal },
    );
    if (request.status === 'aborted') throw request.reason;
    if (request.status === 'failed') {
      const failure = request.error as ResourceHttpFailure<Response> | unknown;
      if (
        typeof failure === 'object' &&
        failure !== null &&
        'kind' in failure &&
        failure.kind === 'http-status' &&
        'metadata' in failure
      ) {
        const typedFailure = failure as ResourceHttpFailure<Response>;
        return {
          status: 'failed',
          resource: applyResourceResponseMetadata(resource, typedFailure.metadata),
          error: createCaptureError('network-request-failed', {
            operation: 'resource-download',
            httpStatus: typedFailure.metadata.httpStatus,
          }),
        };
      }
      return { status: 'failed', error: networkFailure('network-request-failed') };
    }

    const inspected = request.value;
    const policy = await checkResourceResponseNetworkPolicy(inspected.metadata, (permission) =>
      browser.permissions.contains(permission),
    );
    if (policy.status === 'blocked') {
      return {
        status: 'failed',
        resource: applyResourceResponseMetadata(resource, inspected.metadata),
        error: networkFailure(policy.target.reason),
      };
    }

    const responseResource = applyResourceResponseMetadata(resource, inspected.metadata);
    let savedBody: Uint8Array | null = null;
    const consumed = await consumeResourceBodyWithLimits(inspected.response, {
      budget,
      maxFileSizeBytes: job.settings.maxFileSizeBytes,
      signal,
      sink: createMemorySink((bytes) => {
        savedBody = bytes;
      }),
    });
    if (savedBody === null) throw new Error('Resource body sink did not close.');
    context.bodies.set(resource.id, savedBody);
    return {
      status: 'saved',
      resource: { ...responseResource, state: 'saved', byteLength: consumed.byteLength },
    };
  };
}

async function sendPageInfoRequestWithCorrelation(
  tabId: number,
  tabUrl: string,
  renderWaitMs: CaptureSettings['renderWaitMs'],
  correlationId?: string,
): Promise<PageInfoResponse | null> {
  try {
    const response: unknown = await browser.tabs.sendMessage(
      tabId,
      createPageInfoCollectRequest(tabUrl, renderWaitMs, correlationId),
    );
    return isPageInfoResponse(response) ? response : null;
  } catch {
    return null;
  }
}

async function waitForPageInfoResponse(
  tabId: number,
  tabUrl: string,
  renderWaitMs: CaptureSettings['renderWaitMs'],
  correlationId: string,
): Promise<PageInfoResponse | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await sendPageInfoRequestWithCorrelation(
      tabId,
      tabUrl,
      renderWaitMs,
      correlationId,
    );
    if (response) return response;

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return null;
}

async function injectContentScript(tabId: number): Promise<CaptureError | null> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      // Chrome expects an extension-root-relative path. WXT's generated type uses public URL paths.
      files: [CONTENT_SCRIPT_FILE as unknown as ScriptPublicPath],
    });
    return null;
  } catch (error) {
    console.warn(`${RUNTIME_LOG_PREFIX} Content script injection failed.`, error);
    const browserError = error instanceof Error ? error.message : String(error);
    return toCaptureError(error, 'content-script-injection-failed', {
      operation: 'content-script-injection',
      ...(browserError.trim() ? { browserError } : {}),
    });
  }
}

async function collectPageInfoFromContent(
  tabId: number,
  tabUrl: string,
  renderWaitMs: CaptureSettings['renderWaitMs'],
  correlationId: string,
): Promise<PageInfoResponse> {
  const existingResponse = await sendPageInfoRequestWithCorrelation(
    tabId,
    tabUrl,
    renderWaitMs,
    correlationId,
  );
  if (existingResponse) return existingResponse;

  const injectionError = await injectContentScript(tabId);
  if (injectionError) return createPageInfoError(injectionError, correlationId);

  const injectedResponse = await waitForPageInfoResponse(
    tabId,
    tabUrl,
    renderWaitMs,
    correlationId,
  );
  return (
    injectedResponse ??
    createPageInfoError(
      createCaptureError('content-script-unresponsive', {
        operation: 'content-script-response',
      }),
      correlationId,
    )
  );
}

function subscribeToTabLifecycle(
  tabId: number,
  startUrl: string,
  listener: (event: PageCaptureLifecycleEvent) => void,
): () => void {
  const onUpdated = (updatedTabId: number, changeInfo: { status?: string; url?: string }) => {
    if (
      updatedTabId === tabId &&
      (changeInfo.status === 'loading' ||
        (changeInfo.url !== undefined && changeInfo.url !== startUrl))
    ) {
      listener('navigation');
    }
  };
  const onRemoved = (removedTabId: number) => {
    if (removedTabId === tabId) listener('tab-closed');
  };

  browser.tabs.onUpdated.addListener(onUpdated);
  browser.tabs.onRemoved.addListener(onRemoved);

  return () => {
    browser.tabs.onUpdated.removeListener(onUpdated);
    browser.tabs.onRemoved.removeListener(onRemoved);
  };
}

async function collectPageInfo(
  tabId: number,
  renderWaitMs: CaptureSettings['renderWaitMs'],
  correlationId: string,
): Promise<PageInfoResponse> {
  let tabUrl: string | undefined;
  try {
    tabUrl = (await browser.tabs.get(tabId)).url;
  } catch {
    // A tab that is already absent cannot start a capture session.
  }

  if (!tabUrl) {
    return createPageInfoError(
      createCaptureError('page-unavailable', { operation: 'page-info' }),
      correlationId,
    );
  }

  try {
    const siteAccess = await checkCurrentSiteAccess(tabUrl, (request) =>
      browser.permissions.contains(request),
    );
    if (siteAccess.status !== 'granted') {
      return createPageInfoError(
        createCaptureError(
          siteAccess.status === 'restricted' ? 'page-unavailable' : 'permission-denied',
          { operation: 'page-info' },
        ),
        correlationId,
      );
    }
  } catch {
    return createPageInfoError(
      createCaptureError('permission-denied', { operation: 'page-info' }),
      correlationId,
    );
  }

  const session = await runPageCaptureSession({
    startUrl: tabUrl,
    timeoutMs: getPageCaptureTimeoutMs(renderWaitMs),
    capture: () => collectPageInfoFromContent(tabId, tabUrl, renderWaitMs, correlationId),
    getCurrentUrl: async () => (await browser.tabs.get(tabId)).url ?? null,
    subscribe: (listener) => subscribeToTabLifecycle(tabId, tabUrl, listener),
  });

  return session.ok ? session.value : createPageInfoError(session.error, correlationId);
}

function createRuntimePipelineHandlers(
  context: RuntimeCaptureContext,
): CapturePipelineHandlers<RuntimeCaptureContext> {
  return {
    preparing: async ({ job }) => {
      if (job.mode !== 'current-page') {
        throw new SiteCapsuleError(
          createCaptureError('protocol-invalid-message', {
            operation: 'job-create',
            jobId: job.id,
            field: 'mode',
          }),
        );
      }
      const tab = await browser.tabs.get(job.tabId);
      if (!tab.url || tab.url !== job.startUrl) {
        throw new SiteCapsuleError(
          createCaptureError('page-navigation-changed', {
            operation: 'page-capture',
            jobId: job.id,
            url: job.startUrl,
          }),
        );
      }
    },

    discovering: async ({ job, report }) => {
      const response = await collectPageInfo(
        job.tabId,
        job.settings.renderWaitMs,
        `capture-${job.id}`,
      );
      if (!response.payload.ok) throw new SiteCapsuleError(response.payload.error);
      context.page = response.payload.page;
      context.resources = createResourceRecords(context.page, job);
      await jobRepository.replaceJobResources(job.id, context.resources);
      await report({
        pagesDiscovered: 1,
        pagesCaptured: 1,
        resourcesDiscovered: context.resources.length,
        resourcesSkipped: context.resources.filter((resource) => resource.state === 'skipped')
          .length,
      });
    },

    fetching: async ({ job, report }) => {
      if (!context.page) {
        throw new SiteCapsuleError(
          createCaptureError('unexpected-error', {
            operation: 'resource-download',
            jobId: job.id,
            stage: 'fetching',
          }),
        );
      }
      const queued = context.resources.filter((resource) => resource.state === 'queued');
      const skipped = context.resources.filter((resource) => resource.state === 'skipped');
      const budget = new TaskByteBudget(job.settings.maxTotalSizeBytes);
      const baseWorker = createDownloadWorker(context, job, budget);
      let resourcesSaved = 0;
      let resourcesFailed = 0;
      let bytesWritten = 0;
      let progressWrites = Promise.resolve();
      const worker: ResourceDownloadWorker = async (resource, index, signal) => {
        const result = await baseWorker(resource, index, signal);
        if (result.status === 'saved') {
          resourcesSaved += 1;
          bytesWritten += result.resource.byteLength ?? 0;
        } else {
          resourcesFailed += 1;
        }
        progressWrites = progressWrites.then(async () => {
          await report({
            resourcesSaved,
            resourcesFailed,
            resourcesSkipped: skipped.length,
            bytesWritten,
          });
        });
        await progressWrites;
        return result;
      };

      const result = await runResourceDownloadBatch(
        queued,
        job.settings.maxConcurrentRequests,
        worker,
        { primaryResourceId: `${job.id}:document` },
      );
      await progressWrites;
      await report({
        resourcesSaved: result.counts.saved,
        resourcesFailed: result.counts.failed,
        resourcesSkipped: skipped.length + result.counts.aborted + result.counts.notStarted,
        bytesWritten: result.counts.bytesWritten,
      });
      context.resources = [...result.results.map((item) => item.resource), ...skipped].sort(
        (left, right) => left.id.localeCompare(right.id),
      );
      await jobRepository.replaceJobResources(job.id, context.resources);
      if (result.fatalError) throw new SiteCapsuleError(result.fatalError);
    },

    rewriting: async ({ job }) => {
      if (!context.page) {
        throw new SiteCapsuleError(
          createCaptureError('unexpected-error', {
            operation: 'job-update',
            jobId: job.id,
            stage: 'rewriting',
          }),
        );
      }
      const savedAssets = context.resources.filter(
        (resource) => resource.state === 'saved' && resource.type !== 'document',
      );
      context.mappings = await createResourcePathMappings(
        savedAssets.map((resource) => ({
          url: resource.finalUrl ?? resource.originalUrl,
          resourceType: resource.type,
        })),
      );
      const mappingByUrl = new Map(
        context.mappings.map((mapping) => [mapping.normalizedUrl, mapping]),
      );
      context.resources = context.resources.map((resource) => {
        if (resource.state !== 'saved' || resource.type === 'document') return resource;
        const mapping = mappingByUrl.get(resource.finalUrl ?? resource.originalUrl);
        if (!mapping) return resource;
        const body = context.bodies.get(resource.id);
        if (body && resource.type === 'stylesheet') {
          const rewritten = rewriteCssResource({
            cssText: new TextDecoder().decode(body),
            context: 'stylesheet',
            baseUrl: resource.finalUrl ?? resource.originalUrl,
            sourcePath: mapping.relativePath,
            savedResourceMappings: context.mappings,
          });
          context.bodies.set(resource.id, new TextEncoder().encode(rewritten.cssText));
        }
        return { ...resource, localPath: mapping.relativePath };
      });
      await jobRepository.replaceJobResources(job.id, context.resources);

      const response: unknown = await browser.tabs.sendMessage(
        job.tabId,
        createPageArchiveRewriteRequest({
          html: context.page.serializedDom,
          documentUrl: context.page.finalUrl,
          baseUrl: context.page.baseUrl,
          savedResourceMappings: context.mappings,
        }),
      );
      if (!isPageArchiveRewriteResponse(response)) {
        throw new SiteCapsuleError(
          createCaptureError('protocol-invalid-message', {
            operation: 'page-capture',
            jobId: job.id,
            stage: 'rewriting',
          }),
        );
      }
      if (!response.payload.ok) throw new SiteCapsuleError(response.payload.error);
      context.rewrittenHtml = response.payload.html;
    },

    packaging: ({ job }) => {
      if (!context.rewrittenHtml) {
        throw new SiteCapsuleError(
          createCaptureError('unexpected-error', {
            operation: 'archive-package',
            jobId: job.id,
            stage: 'packaging',
          }),
        );
      }
      const assets = context.resources.flatMap((resource) => {
        const body = context.bodies.get(resource.id);
        return resource.state === 'saved' && resource.localPath && body
          ? [{ path: resource.localPath, bytes: body }]
          : [];
      });
      archiveArtifacts.set(
        job.id,
        createArchiveLayoutZipSync({
          indexHtml: new TextEncoder().encode(context.rewrittenHtml),
          assets,
        }),
      );
    },
  };
}

async function publishJob(job: CaptureJob): Promise<void> {
  await browser.runtime.sendMessage(createCaptureJobUpdatedEvent(job)).catch(() => undefined);
}

async function runCreatedJob(job: CaptureJob): Promise<CaptureJob> {
  const context: RuntimeCaptureContext = {
    page: null,
    resources: [],
    bodies: new Map(),
    mappings: [],
    rewrittenHtml: null,
  };
  await publishJob(job);
  return runCapturePipeline({
    jobId: job.id,
    context,
    repository: jobRepository,
    handlers: createRuntimePipelineHandlers(context),
    onJobUpdated: publishJob,
  });
}

export default defineBackground(() => {
  console.info(`${RUNTIME_LOG_PREFIX} Background service worker initialized.`);

  browser.action.onClicked.addListener((tab) => {
    if (tab.id === undefined) return;

    void browser.sidePanel
      .open({ tabId: tab.id })
      .catch((error) => console.error(`${RUNTIME_LOG_PREFIX} Failed to open side panel.`, error));
  });

  browser.runtime.onMessage.addListener(async (message: unknown) => {
    if (isCaptureJobCreateRequest(message)) {
      try {
        const job = await jobRepository.createJob(message.payload);
        await browser.storage.local.set({ [LAST_CAPTURE_JOB_STORAGE_KEY]: job.id });
        return createCaptureJobResponse(await runCreatedJob(job), message.correlationId);
      } catch (error) {
        return createCaptureJobError(
          toCaptureError(error, 'unexpected-error', { operation: 'job-create' }),
          message.correlationId,
        );
      }
    }

    if (isCaptureJobGetRequest(message)) {
      try {
        const job = await jobRepository.getJob(message.payload.jobId);
        return job
          ? createCaptureJobResponse(job, message.correlationId)
          : createCaptureJobError(
              createCaptureError('job-not-found', {
                operation: 'job-read',
                jobId: message.payload.jobId,
              }),
              message.correlationId,
            );
      } catch (error) {
        return createCaptureJobError(
          toCaptureError(error, 'storage-unavailable', { operation: 'job-read' }),
          message.correlationId,
        );
      }
    }

    if (!isPageInfoRequest(message)) return;

    return collectPageInfo(
      message.payload.tabId,
      message.payload.renderWaitMs,
      message.correlationId,
    );
  });
});
