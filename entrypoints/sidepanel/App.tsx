import { exportArchiveWithChromeDownloads } from '@sitecapsule/archive';
import {
  DEFAULT_RENDER_WAIT_MS,
  MAX_RENDER_WAIT_MS,
  SiteCapsuleError,
  createCaptureError,
  isPausableJobStatus,
  toCaptureError,
  type CaptureJob,
  type JobStatus,
} from '@sitecapsule/domain';
import {
  createCaptureJobCreateRequest,
  createCaptureJobControlRequest,
  createCaptureJobGetRequest,
  createCaptureJobDeleteRequest,
  createCaptureJobHistoryClearRequest,
  createCaptureJobHistoryListRequest,
  createCaptureJobResultGetRequest,
  createPageInfoRequest,
  type PageInfo,
  type CaptureJobCommand,
  type CaptureJobResult,
  type CaptureJobHistoryItem,
} from '@sitecapsule/messaging/protocol';
import {
  isCaptureJobResultResponse,
  isCaptureJobHistoryResponse,
  isCaptureJobMutationResponse,
  isCaptureJobResponse,
  isCaptureJobUpdatedEvent,
  isPageInfoResponse,
} from '@sitecapsule/messaging/validators';
import {
  checkCurrentSiteAccess,
  createPageAccessRequest,
  createThirdPartyAccessRequest,
  summarizeThirdPartySiteAccess,
  type SiteAccessResult,
  type ThirdPartySiteAccessSummary,
} from '@sitecapsule/permissions';
import { EXTENSION_NAME } from '@sitecapsule/shared';
import {
  applyCurrentPageToArchiveName,
  buildCurrentPageTaskInput,
  DEFAULT_CURRENT_PAGE_CONCURRENCY,
  DEFAULT_CURRENT_PAGE_INCLUDE_MEDIA,
  DEFAULT_CURRENT_PAGE_INCLUDE_THIRD_PARTY_RESOURCES,
  getPendingThirdPartyPermissionPatterns,
  isThirdPartyCaptureReady,
  MAX_CURRENT_PAGE_CONCURRENCY,
  MIN_CURRENT_PAGE_CONCURRENCY,
  createInitialCurrentPageArchiveName,
  editCurrentPageArchiveName,
  validateConcurrencyInput,
  validateCurrentPageArchiveFileName,
  validateRenderWaitInput,
  readCaptureArchiveBytes,
} from '@sitecapsule/ui';
import { useEffect, useState } from 'react';

type ReadStatus = 'idle' | 'loading' | 'success' | 'error';
type ThirdPartyGrantStatus = 'idle' | 'requesting';
type ThirdPartyCheckStatus = 'idle' | 'checking' | 'ready' | 'error';
type CreateStatus = 'idle' | 'creating';
type ControlStatus = 'idle' | CaptureJobCommand;
type ResultStatus = 'idle' | 'loading' | 'ready' | 'error';
type DownloadStatus = 'idle' | 'downloading' | 'started' | 'error';
type HistoryStatus = 'loading' | 'ready' | 'error';

const LAST_CAPTURE_JOB_STORAGE_KEY = 'sitecapsule.lastCaptureJobId';
const PIPELINE_STAGES = [
  { status: 'preparing', label: 'Preparing' },
  { status: 'discovering', label: 'Discovering' },
  { status: 'fetching', label: 'Downloading' },
  { status: 'rewriting', label: 'Rewriting' },
  { status: 'packaging', label: 'Packaging' },
] as const;

function isActiveJob(status: JobStatus): boolean {
  return !['completed', 'cancelled', 'failed'].includes(status);
}

function stageDisplayState(
  job: CaptureJob,
  stage: (typeof PIPELINE_STAGES)[number]['status'],
): 'complete' | 'active' | 'pending' {
  if (job.status === 'completed') return 'complete';
  const effectiveStatus =
    job.status === 'paused'
      ? job.resumeStatus
      : job.status === 'retrying'
        ? 'preparing'
        : job.status;
  const currentIndex = PIPELINE_STAGES.findIndex((item) => item.status === effectiveStatus);
  const stageIndex = PIPELINE_STAGES.findIndex((item) => item.status === stage);
  if (currentIndex < 0) return 'pending';
  if (stageIndex < currentIndex) return 'complete';
  return stageIndex === currentIndex ? 'active' : 'pending';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown permission error.';
}

function formatByteLength(value: number): string {
  if (value < 1_024) return `${value.toLocaleString()} B`;
  if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)} KB`;
  if (value < 1_024 * 1_024 * 1_024) return `${(value / (1_024 * 1_024)).toFixed(1)} MB`;
  return `${(value / (1_024 * 1_024 * 1_024)).toFixed(1)} GB`;
}

function summarizeSiteAccess(access: SiteAccessResult | null): string {
  if (!access) return 'Not checked';
  if (access.status === 'restricted') {
    return `Restricted${access.protocol ? ` · ${access.protocol}` : ''}`;
  }
  return `${access.status === 'granted' ? 'Granted' : 'Not granted'} · ${access.permissionPattern}`;
}

function summarizeRegions(pageInfo: PageInfo): string {
  const counts = pageInfo.regionDiagnostics.regions.reduce(
    (summary, region) => {
      if (region.kind === 'iframe') summary.iframes += 1;
      if (region.kind === 'shadow-root') summary.shadowRoots += 1;
      if (region.access === 'inaccessible') summary.inaccessible += 1;
      return summary;
    },
    { iframes: 0, shadowRoots: 0, inaccessible: 0 },
  );

  return `${counts.iframes} iframe / ${counts.shadowRoots} shadow / ${counts.inaccessible} inaccessible`;
}

function countMergedEvidence(pageInfo: PageInfo): number {
  return pageInfo.mergedResources.reduce((total, resource) => total + resource.evidence.length, 0);
}

function summarizeResourceProtocols(pageInfo: PageInfo): string {
  const counts = { network: 0, data: 0, blob: 0, unsupported: 0 };
  for (const node of pageInfo.resourceGraph.nodes) counts[node.classification.kind] += 1;
  return `${counts.network} network / ${counts.data} data / ${counts.blob} blob / ${counts.unsupported} unsupported`;
}

function summarizeResourceMetadata(pageInfo: PageInfo): string {
  let typed = 0;
  let mimeHints = 0;
  let conflicts = 0;
  for (const node of pageInfo.resourceGraph.nodes) {
    if (node.inference.resourceTypeConfidence !== 'unknown') typed += 1;
    if (node.inference.mimeTypeHint !== null) mimeHints += 1;
    if (node.inference.hasConflict) conflicts += 1;
  }
  const unknown = pageInfo.resourceGraph.nodes.length - typed;
  return `${typed} typed / ${unknown} unknown / ${mimeHints} MIME hints / ${conflicts} conflicts`;
}

export function App() {
  const [status, setStatus] = useState<ReadStatus>('idle');
  const [renderWaitInput, setRenderWaitInput] = useState(String(DEFAULT_RENDER_WAIT_MS));
  const [concurrencyInput, setConcurrencyInput] = useState(
    String(DEFAULT_CURRENT_PAGE_CONCURRENCY),
  );
  const [includeMedia, setIncludeMedia] = useState(DEFAULT_CURRENT_PAGE_INCLUDE_MEDIA);
  const [includeThirdPartyResources, setIncludeThirdPartyResources] = useState(
    DEFAULT_CURRENT_PAGE_INCLUDE_THIRD_PARTY_RESOURCES,
  );
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [currentTabId, setCurrentTabId] = useState<number | null>(null);
  const [archiveName, setArchiveName] = useState(createInitialCurrentPageArchiveName);
  const [error, setError] = useState<string | null>(null);
  const [siteAccess, setSiteAccess] = useState<SiteAccessResult | null>(null);
  const [thirdPartyAccess, setThirdPartyAccess] = useState<ThirdPartySiteAccessSummary[]>([]);
  const [selectedThirdParties, setSelectedThirdParties] = useState<string[]>([]);
  const [thirdPartyGrantStatus, setThirdPartyGrantStatus] = useState<ThirdPartyGrantStatus>('idle');
  const [thirdPartyCheckStatus, setThirdPartyCheckStatus] = useState<ThirdPartyCheckStatus>('idle');
  const [thirdPartyError, setThirdPartyError] = useState<string | null>(null);
  const [captureJob, setCaptureJob] = useState<CaptureJob | null>(null);
  const [createStatus, setCreateStatus] = useState<CreateStatus>('idle');
  const [createError, setCreateError] = useState<string | null>(null);
  const [controlStatus, setControlStatus] = useState<ControlStatus>('idle');
  const [controlError, setControlError] = useState<string | null>(null);
  const [resultStatus, setResultStatus] = useState<ResultStatus>('idle');
  const [captureResult, setCaptureResult] = useState<CaptureJobResult | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>('idle');
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<CaptureJobHistoryItem[]>([]);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>('loading');
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyMutation, setHistoryMutation] = useState<string | null>(null);
  const pendingThirdPartyPatterns = getPendingThirdPartyPermissionPatterns(thirdPartyAccess);
  const pendingThirdPartyCount = pendingThirdPartyPatterns.length;
  const archiveNameValidation = validateCurrentPageArchiveFileName(archiveName.value);
  const renderWaitValidation = validateRenderWaitInput(renderWaitInput);
  const concurrencyValidation = validateConcurrencyInput(concurrencyInput);
  const thirdPartyReady =
    !includeThirdPartyResources ||
    (thirdPartyCheckStatus === 'ready' &&
      isThirdPartyCaptureReady(includeThirdPartyResources, thirdPartyAccess));
  const currentPageTask =
    status === 'success' &&
    pageInfo &&
    currentTabId !== null &&
    archiveNameValidation.valid &&
    renderWaitValidation.valid &&
    concurrencyValidation.valid &&
    thirdPartyReady
      ? buildCurrentPageTaskInput({
          tabId: currentTabId,
          pageUrl: pageInfo.finalUrl,
          archiveFileName: archiveNameValidation.fileName,
          renderWaitMs: renderWaitValidation.value,
          maxConcurrentRequests: concurrencyValidation.value,
          includeMedia,
          includeThirdPartyResources,
        })
      : null;
  const taskStatusMessage = currentPageTask
    ? 'Archive settings ready.'
    : status !== 'success'
      ? 'Read the page to finish setup.'
      : !archiveNameValidation.valid || !renderWaitValidation.valid || !concurrencyValidation.valid
        ? 'Fix the highlighted settings.'
        : includeThirdPartyResources && thirdPartyCheckStatus === 'error'
          ? 'Third-party access could not be checked.'
          : includeThirdPartyResources && pendingThirdPartyCount > 0
            ? `Grant access to ${pendingThirdPartyCount} third-party ${pendingThirdPartyCount === 1 ? 'host' : 'hosts'}.`
            : 'Checking archive settings...';

  const thirdPartyOptionStatus =
    status !== 'success'
      ? 'Access is checked after the page is read.'
      : thirdPartyCheckStatus === 'checking'
        ? 'Checking host access...'
        : thirdPartyCheckStatus === 'error'
          ? 'Host access check failed.'
          : thirdPartyAccess.length === 0
            ? 'No third-party hosts found.'
            : !includeThirdPartyResources
              ? `${thirdPartyAccess.length} ${thirdPartyAccess.length === 1 ? 'host' : 'hosts'} found · Off`
              : pendingThirdPartyCount > 0
                ? `${pendingThirdPartyCount} ${pendingThirdPartyCount === 1 ? 'host needs' : 'hosts need'} access.`
                : `${thirdPartyAccess.length} ${thirdPartyAccess.length === 1 ? 'host' : 'hosts'} ready.`;

  useEffect(() => {
    const onMessage = (message: unknown) => {
      if (!isCaptureJobUpdatedEvent(message)) return;
      setCaptureJob(message.payload.job);
      setControlStatus((current) => {
        if (current === 'pause' && message.payload.job.status !== 'paused') return current;
        if (
          current === 'cancel' &&
          message.payload.job.status !== 'cancelling' &&
          message.payload.job.status !== 'cancelled'
        ) {
          return current;
        }
        if (current === 'resume' && message.payload.job.status === 'paused') return current;
        if (current === 'retry' && message.payload.job.status === 'failed') return current;
        return 'idle';
      });
      setControlError(null);
    };
    browser.runtime.onMessage.addListener(onMessage);

    void browser.storage.local
      .get(LAST_CAPTURE_JOB_STORAGE_KEY)
      .then(async (stored) => {
        const jobId = stored[LAST_CAPTURE_JOB_STORAGE_KEY];
        if (typeof jobId !== 'string' || jobId.trim() === '') return;
        const response: unknown = await browser.runtime.sendMessage(
          createCaptureJobGetRequest(jobId),
        );
        if (isCaptureJobResponse(response) && response.payload.ok) {
          setCaptureJob(response.payload.job);
        }
      })
      .catch(() => undefined);

    void refreshHistory();

    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, []);

  async function refreshHistory(): Promise<void> {
    setHistoryStatus('loading');
    setHistoryError(null);
    try {
      const response: unknown = await browser.runtime.sendMessage(
        createCaptureJobHistoryListRequest(),
      );
      if (!isCaptureJobHistoryResponse(response)) {
        throw new SiteCapsuleError(
          createCaptureError('protocol-invalid-message', { operation: 'job-list' }),
        );
      }
      if (!response.payload.ok) throw new SiteCapsuleError(response.payload.error);
      setHistoryItems(response.payload.items);
      setHistoryStatus('ready');
    } catch (requestError) {
      const captureError = toCaptureError(requestError, 'storage-unavailable', {
        operation: 'job-list',
      });
      setHistoryError(`${captureError.message} ${captureError.suggestion}`);
      setHistoryStatus('error');
    }
  }

  async function reloadLastCaptureJob(): Promise<void> {
    const stored = await browser.storage.local.get(LAST_CAPTURE_JOB_STORAGE_KEY);
    const jobId = stored[LAST_CAPTURE_JOB_STORAGE_KEY];
    if (typeof jobId !== 'string' || jobId.trim() === '') {
      setCaptureJob(null);
      return;
    }
    const response: unknown = await browser.runtime.sendMessage(createCaptureJobGetRequest(jobId));
    setCaptureJob(
      isCaptureJobResponse(response) && response.payload.ok ? response.payload.job : null,
    );
  }

  useEffect(() => {
    let disposed = false;
    if (!captureJob || !['completed', 'failed', 'cancelled'].includes(captureJob.status)) {
      setResultStatus('idle');
      setCaptureResult(null);
      setResultError(null);
      setDownloadStatus('idle');
      setDownloadMessage(null);
      return () => {
        disposed = true;
      };
    }

    setResultStatus('loading');
    setResultError(null);
    setDownloadStatus('idle');
    setDownloadMessage(null);
    void browser.runtime
      .sendMessage(createCaptureJobResultGetRequest(captureJob.id))
      .then((response: unknown) => {
        if (disposed) return;
        if (!isCaptureJobResultResponse(response)) {
          throw new SiteCapsuleError(
            createCaptureError('protocol-invalid-message', { operation: 'job-read' }),
          );
        }
        if (!response.payload.ok) throw new SiteCapsuleError(response.payload.error);
        setCaptureResult(response.payload.result);
        setResultStatus('ready');
        void refreshHistory();
      })
      .catch((requestError: unknown) => {
        if (disposed) return;
        const captureError = toCaptureError(requestError, 'unexpected-error', {
          operation: 'job-read',
          jobId: captureJob.id,
        });
        setResultError(`${captureError.message} ${captureError.suggestion}`);
        setResultStatus('error');
      });

    return () => {
      disposed = true;
    };
  }, [captureJob?.id, captureJob?.status, captureJob?.updatedAt]);

  const readCurrentPage = async () => {
    if (!renderWaitValidation.valid) return;
    const renderWaitMs = renderWaitValidation.value;
    setStatus('loading');
    setError(null);
    setThirdPartyAccess([]);
    setSelectedThirdParties([]);
    setThirdPartyCheckStatus('checking');
    setThirdPartyError(null);

    try {
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id === undefined || !activeTab.url) {
        throw new SiteCapsuleError(
          createCaptureError('page-unavailable', { operation: 'page-info' }),
        );
      }

      let access = await checkCurrentSiteAccess(activeTab.url, (request) =>
        browser.permissions.contains(request),
      );
      setSiteAccess(access);
      if (access.status === 'restricted') {
        throw new SiteCapsuleError(
          createCaptureError('page-unavailable', { operation: 'page-info' }),
        );
      }
      if (access.status === 'not-granted') {
        const accessGranted = await browser.permissions.request(createPageAccessRequest(access));
        if (!accessGranted) {
          throw new SiteCapsuleError(
            createCaptureError('permission-denied', { operation: 'page-info' }),
          );
        }
        access = { ...access, status: 'granted' };
        setSiteAccess(access);
      }

      const response: unknown = await browser.runtime.sendMessage(
        createPageInfoRequest(activeTab.id, renderWaitMs),
      );
      if (!isPageInfoResponse(response)) {
        throw new SiteCapsuleError(
          createCaptureError('protocol-invalid-message', { operation: 'page-info' }),
        );
      }
      if (!response.payload.ok) {
        throw new SiteCapsuleError(response.payload.error);
      }

      const capturedPage = response.payload.page;
      setPageInfo(capturedPage);
      setCurrentTabId(activeTab.id);
      setArchiveName((current) => applyCurrentPageToArchiveName(current, capturedPage.finalUrl));
      setStatus('success');

      try {
        const accessSummary = await summarizeThirdPartySiteAccess(
          capturedPage.resourceGraph,
          (request) => browser.permissions.contains(request),
        );
        setThirdPartyAccess(accessSummary);
        setSelectedThirdParties(
          includeThirdPartyResources ? getPendingThirdPartyPermissionPatterns(accessSummary) : [],
        );
        setThirdPartyCheckStatus('ready');
      } catch (permissionError) {
        setThirdPartyError(`Unable to check third-party access. ${errorMessage(permissionError)}`);
        setThirdPartyCheckStatus('error');
      }
    } catch (requestError) {
      const captureError = toCaptureError(requestError, 'unexpected-error', {
        operation: 'page-info',
      });
      setPageInfo(null);
      setCurrentTabId(null);
      setThirdPartyCheckStatus('idle');
      setError(
        [captureError.message, captureError.context?.browserError]
          .filter((message): message is string => Boolean(message))
          .join(' '),
      );
      setStatus('error');
    }
  };

  const toggleThirdParty = (permissionPattern: string, selected: boolean) => {
    setSelectedThirdParties((current) =>
      selected
        ? Array.from(new Set([...current, permissionPattern]))
        : current.filter((pattern) => pattern !== permissionPattern),
    );
  };

  const updateThirdPartySetting = (enabled: boolean) => {
    setIncludeThirdPartyResources(enabled);
    setThirdPartyError(null);
    setSelectedThirdParties(enabled ? pendingThirdPartyPatterns : []);
  };

  const grantSelectedThirdParties = async () => {
    const request = createThirdPartyAccessRequest(thirdPartyAccess, selectedThirdParties);
    if (!request || !pageInfo) return;

    setThirdPartyGrantStatus('requesting');
    setThirdPartyError(null);
    try {
      const granted = await browser.permissions.request(request);
      if (!granted) {
        setThirdPartyError('Third-party access was not granted.');
        return;
      }

      const refreshed = await summarizeThirdPartySiteAccess(
        pageInfo.resourceGraph,
        (permissionRequest) => browser.permissions.contains(permissionRequest),
      );
      setThirdPartyAccess(refreshed);
      setSelectedThirdParties([]);
      setThirdPartyCheckStatus('ready');
    } catch (permissionError) {
      setThirdPartyError(`Unable to grant third-party access. ${errorMessage(permissionError)}`);
    } finally {
      setThirdPartyGrantStatus('idle');
    }
  };

  const startCapture = async () => {
    if (!currentPageTask) return;
    setCreateStatus('creating');
    setCreateError(null);
    try {
      const response: unknown = await browser.runtime.sendMessage(
        createCaptureJobCreateRequest(currentPageTask),
      );
      if (!isCaptureJobResponse(response)) {
        throw new SiteCapsuleError(
          createCaptureError('protocol-invalid-message', { operation: 'job-create' }),
        );
      }
      if (!response.payload.ok) throw new SiteCapsuleError(response.payload.error);
      setCaptureJob(response.payload.job);
    } catch (requestError) {
      const captureError = toCaptureError(requestError, 'unexpected-error', {
        operation: 'job-create',
      });
      setCreateError(`${captureError.message} ${captureError.suggestion}`);
    } finally {
      setCreateStatus('idle');
    }
  };

  const controlCapture = async (command: CaptureJobCommand) => {
    if (!captureJob || controlStatus !== 'idle') return;
    setControlStatus(command);
    setControlError(null);
    try {
      const response: unknown = await browser.runtime.sendMessage(
        createCaptureJobControlRequest(captureJob.id, command),
      );
      if (!isCaptureJobResponse(response)) {
        throw new SiteCapsuleError(
          createCaptureError('protocol-invalid-message', { operation: 'job-transition' }),
        );
      }
      if (!response.payload.ok) throw new SiteCapsuleError(response.payload.error);
      setCaptureJob(response.payload.job);
    } catch (requestError) {
      const captureError = toCaptureError(requestError, 'unexpected-error', {
        operation: 'job-transition',
        jobId: captureJob.id,
      });
      setControlError(`${captureError.message} ${captureError.suggestion}`);
    } finally {
      setControlStatus('idle');
    }
  };

  const downloadArchive = async () => {
    if (
      !captureResult?.archiveAvailable ||
      captureResult.archiveByteLength === null ||
      downloadStatus === 'downloading'
    ) {
      return;
    }
    setDownloadStatus('downloading');
    setDownloadMessage(null);
    try {
      const archiveBytes = await readCaptureArchiveBytes(
        captureResult.jobId,
        captureResult.archiveByteLength,
        (request) => browser.runtime.sendMessage(request),
      );
      const downloaded = await exportArchiveWithChromeDownloads({
        archiveBytes,
        fileName: captureResult.fileName,
        saveAs: true,
      });
      setDownloadStatus('started');
      setDownloadMessage(`Download started · ${downloaded.fileName}`);
    } catch (requestError) {
      const captureError = toCaptureError(requestError, 'archive-download-failed', {
        operation: 'archive-download',
        jobId: captureResult.jobId,
      });
      setDownloadStatus('error');
      setDownloadMessage(`${captureError.message} ${captureError.suggestion}`);
    }
  };

  const openHistoryJob = async (jobId: string) => {
    setHistoryMutation(`open:${jobId}`);
    setHistoryError(null);
    try {
      const response: unknown = await browser.runtime.sendMessage(
        createCaptureJobGetRequest(jobId),
      );
      if (!isCaptureJobResponse(response)) {
        throw new SiteCapsuleError(
          createCaptureError('protocol-invalid-message', { operation: 'job-read' }),
        );
      }
      if (!response.payload.ok) throw new SiteCapsuleError(response.payload.error);
      setCaptureJob(response.payload.job);
    } catch (requestError) {
      const captureError = toCaptureError(requestError, 'unexpected-error', {
        operation: 'job-read',
      });
      setHistoryError(`${captureError.message} ${captureError.suggestion}`);
    } finally {
      setHistoryMutation(null);
    }
  };

  const deleteHistoryJob = async (item: CaptureJobHistoryItem) => {
    if (!window.confirm(`Delete "${item.fileName}" and its saved task data?`)) return;
    setHistoryMutation(`delete:${item.jobId}`);
    setHistoryError(null);
    try {
      const response: unknown = await browser.runtime.sendMessage(
        createCaptureJobDeleteRequest(item.jobId),
      );
      if (!isCaptureJobMutationResponse(response)) {
        throw new SiteCapsuleError(
          createCaptureError('protocol-invalid-message', { operation: 'job-cleanup' }),
        );
      }
      if (!response.payload.ok) throw new SiteCapsuleError(response.payload.error);
      await Promise.all([refreshHistory(), reloadLastCaptureJob()]);
    } catch (requestError) {
      const captureError = toCaptureError(requestError, 'unexpected-error', {
        operation: 'job-cleanup',
      });
      setHistoryError(`${captureError.message} ${captureError.suggestion}`);
    } finally {
      setHistoryMutation(null);
    }
  };

  const clearHistory = async () => {
    if (
      !window.confirm(
        `Delete all ${historyItems.length} saved history tasks? Active tasks are kept.`,
      )
    )
      return;
    setHistoryMutation('clear');
    setHistoryError(null);
    try {
      const response: unknown = await browser.runtime.sendMessage(
        createCaptureJobHistoryClearRequest(),
      );
      if (!isCaptureJobMutationResponse(response)) {
        throw new SiteCapsuleError(
          createCaptureError('protocol-invalid-message', { operation: 'job-cleanup' }),
        );
      }
      if (!response.payload.ok) throw new SiteCapsuleError(response.payload.error);
      await Promise.all([refreshHistory(), reloadLastCaptureJob()]);
    } catch (requestError) {
      const captureError = toCaptureError(requestError, 'unexpected-error', {
        operation: 'job-cleanup',
      });
      setHistoryError(`${captureError.message} ${captureError.suggestion}`);
    } finally {
      setHistoryMutation(null);
    }
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">{EXTENSION_NAME}</p>
          <h1>New archive</h1>
        </div>
        <span className="status-badge">Current page</span>
      </header>

      <section className="inspect-section" aria-labelledby="inspect-title">
        <div className="section-heading">
          <h2 id="inspect-title">Page</h2>
          <button
            className="primary-action"
            type="button"
            onClick={readCurrentPage}
            disabled={status === 'loading' || !renderWaitValidation.valid}
          >
            {status === 'loading'
              ? 'Reading...'
              : status === 'success'
                ? 'Refresh page'
                : 'Use current page'}
          </button>
        </div>

        {status === 'idle' && <p className="helper-text">Choose the active browser tab.</p>}
        {status === 'loading' && (
          <p className="helper-text">
            Waiting {renderWaitValidation.valid ? renderWaitValidation.value : 0} ms before
            reading...
          </p>
        )}
        {status === 'error' && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}

        <form
          className="task-settings"
          data-task-ready={currentPageTask !== null}
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="setting-row mode-setting">
            <span>Capture mode</span>
            <strong>Current page</strong>
          </div>

          {pageInfo && (
            <dl className="page-summary">
              <div>
                <dt>Title</dt>
                <dd>{pageInfo.title || 'Untitled page'}</dd>
              </div>
              <div>
                <dt>Page URL</dt>
                <dd>{pageInfo.finalUrl}</dd>
              </div>
            </dl>
          )}

          <div className="file-name-setting">
            <label htmlFor="archive-file-name">ZIP file name</label>
            <input
              id="archive-file-name"
              name="archiveFileName"
              type="text"
              value={archiveName.value}
              aria-invalid={!archiveNameValidation.valid}
              aria-describedby="archive-file-name-feedback"
              spellCheck="false"
              autoComplete="off"
              onChange={(event) =>
                setArchiveName(editCurrentPageArchiveName(event.currentTarget.value))
              }
            />
            <div id="archive-file-name-feedback" className="field-feedback" aria-live="polite">
              {archiveNameValidation.valid ? (
                <span className="valid-text">Valid ZIP file name.</span>
              ) : (
                <>
                  <span className="error-text">{archiveNameValidation.message}</span>
                  {archiveNameValidation.suggestion && (
                    <button
                      className="suggestion-action"
                      type="button"
                      onClick={() =>
                        setArchiveName(
                          editCurrentPageArchiveName(archiveNameValidation.suggestion ?? ''),
                        )
                      }
                    >
                      Use {archiveNameValidation.suggestion}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <fieldset className="capture-options">
            <legend>Capture options</legend>

            <div className="numeric-setting">
              <div className="numeric-setting-row">
                <label htmlFor="render-wait">Render wait</label>
                <div className="number-with-unit">
                  <input
                    id="render-wait"
                    name="renderWaitMs"
                    type="number"
                    min="0"
                    max={MAX_RENDER_WAIT_MS}
                    step="100"
                    value={renderWaitInput}
                    aria-invalid={!renderWaitValidation.valid}
                    aria-describedby="render-wait-feedback"
                    onChange={(event) => setRenderWaitInput(event.currentTarget.value)}
                    disabled={status === 'loading'}
                  />
                  <span>ms</span>
                </div>
              </div>
              <p
                id="render-wait-feedback"
                className={renderWaitValidation.valid ? 'setting-hint' : 'setting-error'}
              >
                {renderWaitValidation.valid
                  ? `0-${MAX_RENDER_WAIT_MS.toLocaleString()} ms`
                  : renderWaitValidation.message}
              </p>
            </div>

            <div className="numeric-setting">
              <div className="numeric-setting-row">
                <label htmlFor="capture-concurrency">Concurrent downloads</label>
                <input
                  id="capture-concurrency"
                  name="maxConcurrentRequests"
                  className="compact-number-input"
                  type="number"
                  min={MIN_CURRENT_PAGE_CONCURRENCY}
                  max={MAX_CURRENT_PAGE_CONCURRENCY}
                  step="1"
                  value={concurrencyInput}
                  aria-invalid={!concurrencyValidation.valid}
                  aria-describedby="capture-concurrency-feedback"
                  onChange={(event) => setConcurrencyInput(event.currentTarget.value)}
                  disabled={status === 'loading'}
                />
              </div>
              <p
                id="capture-concurrency-feedback"
                className={concurrencyValidation.valid ? 'setting-hint' : 'setting-error'}
              >
                {concurrencyValidation.valid
                  ? `${MIN_CURRENT_PAGE_CONCURRENCY}-${MAX_CURRENT_PAGE_CONCURRENCY}`
                  : concurrencyValidation.message}
              </p>
            </div>

            <label className="toggle-setting">
              <span>
                <strong>Media files</strong>
                <small>Video and audio</small>
              </span>
              <span className="switch-control">
                <input
                  type="checkbox"
                  role="switch"
                  name="includeMedia"
                  checked={includeMedia}
                  onChange={(event) => setIncludeMedia(event.currentTarget.checked)}
                  disabled={status === 'loading'}
                />
                <span aria-hidden="true" />
              </span>
            </label>

            <label className="toggle-setting third-party-toggle">
              <span>
                <strong>Third-party resources</strong>
                <small>{thirdPartyOptionStatus}</small>
              </span>
              <span className="switch-control">
                <input
                  type="checkbox"
                  role="switch"
                  name="includeThirdPartyResources"
                  checked={includeThirdPartyResources}
                  onChange={(event) => updateThirdPartySetting(event.currentTarget.checked)}
                  disabled={status === 'loading'}
                />
                <span aria-hidden="true" />
              </span>
            </label>
          </fieldset>

          <p
            className={`task-readiness ${currentPageTask ? 'ready' : ''}`}
            role="status"
            aria-live="polite"
          >
            {taskStatusMessage}
          </p>

          <button
            className="start-capture-action"
            type="button"
            onClick={startCapture}
            disabled={
              currentPageTask === null ||
              createStatus === 'creating' ||
              (captureJob !== null && isActiveJob(captureJob.status))
            }
          >
            {captureJob && isActiveJob(captureJob.status)
              ? 'Archiving...'
              : createStatus === 'creating'
                ? 'Starting...'
                : 'Create archive'}
          </button>

          {createError && (
            <p className="error-text" role="alert">
              {createError}
            </p>
          )}
        </form>

        {captureJob && (
          <section className="capture-progress" aria-labelledby="capture-progress-title">
            <div className="progress-heading">
              <div>
                <h3 id="capture-progress-title">Archive progress</h3>
                <p>{captureJob.settings.archiveFileName}</p>
              </div>
              <span className={`job-state ${captureJob.status}`}>{captureJob.status}</span>
            </div>
            <ol className="progress-stages">
              {PIPELINE_STAGES.map((stage) => {
                const displayState = stageDisplayState(captureJob, stage.status);
                return (
                  <li key={stage.status} className={displayState}>
                    <span className="stage-marker" aria-hidden="true" />
                    <span>{stage.label}</span>
                    <small>
                      {displayState === 'complete'
                        ? 'Done'
                        : displayState === 'active'
                          ? captureJob.status === 'paused'
                            ? 'Paused'
                            : 'In progress'
                          : 'Waiting'}
                    </small>
                  </li>
                );
              })}
            </ol>
            <dl className="progress-counters">
              <div>
                <dt>Resources</dt>
                <dd>
                  {captureJob.counters.resourcesSaved.toLocaleString()} saved ·{' '}
                  {captureJob.counters.resourcesFailed.toLocaleString()} failed ·{' '}
                  {captureJob.counters.resourcesSkipped.toLocaleString()} skipped
                </dd>
              </div>
              <div>
                <dt>Downloaded</dt>
                <dd>{captureJob.counters.bytesWritten.toLocaleString()} bytes</dd>
              </div>
            </dl>
            {(isPausableJobStatus(captureJob.status) ||
              captureJob.status === 'paused' ||
              captureJob.status === 'failed') && (
              <div className="job-controls" aria-label="Archive controls">
                {isPausableJobStatus(captureJob.status) && (
                  <button
                    type="button"
                    className="job-control-action"
                    onClick={() => controlCapture('pause')}
                    disabled={controlStatus !== 'idle'}
                  >
                    {controlStatus === 'pause' ? 'Pausing...' : 'Pause'}
                  </button>
                )}
                {captureJob.status === 'paused' && (
                  <button
                    type="button"
                    className="job-control-action primary"
                    onClick={() => controlCapture('resume')}
                    disabled={controlStatus !== 'idle'}
                  >
                    {controlStatus === 'resume' ? 'Resuming...' : 'Resume'}
                  </button>
                )}
                {captureJob.status === 'failed' && (
                  <button
                    type="button"
                    className="job-control-action primary"
                    onClick={() => controlCapture('retry')}
                    disabled={controlStatus !== 'idle'}
                  >
                    {controlStatus === 'retry' ? 'Retrying...' : 'Retry'}
                  </button>
                )}
                {(isPausableJobStatus(captureJob.status) || captureJob.status === 'paused') && (
                  <button
                    type="button"
                    className="job-control-action danger"
                    onClick={() => controlCapture('cancel')}
                    disabled={controlStatus !== 'idle'}
                  >
                    {controlStatus === 'cancel' ? 'Cancelling...' : 'Cancel'}
                  </button>
                )}
              </div>
            )}
            {controlError && (
              <p className="error-text control-error" role="alert">
                {controlError}
              </p>
            )}
          </section>
        )}

        {captureJob && ['completed', 'failed', 'cancelled'].includes(captureJob.status) && (
          <section className="capture-result" aria-labelledby="capture-result-title">
            <div className="result-heading">
              <div>
                <p className="result-eyebrow">Task result</p>
                <h2 id="capture-result-title">
                  {captureJob.status === 'completed'
                    ? captureJob.counters.resourcesFailed > 0
                      ? 'Archive ready with issues'
                      : 'Archive ready'
                    : captureJob.status === 'failed'
                      ? 'Archive failed'
                      : 'Archive cancelled'}
                </h2>
              </div>
              {resultStatus === 'loading' && <span className="result-loading">Loading...</span>}
            </div>

            {resultStatus === 'error' && (
              <p className="error-text result-message" role="alert">
                {resultError}
              </p>
            )}

            {resultStatus === 'ready' && captureResult && (
              <>
                <dl className="result-summary">
                  <div>
                    <dt>ZIP file</dt>
                    <dd>{captureResult.fileName}</dd>
                  </div>
                  <div>
                    <dt>ZIP size</dt>
                    <dd>
                      {captureResult.archiveByteLength === null
                        ? 'Unavailable'
                        : formatByteLength(captureResult.archiveByteLength)}
                    </dd>
                  </div>
                  <div>
                    <dt>Resources</dt>
                    <dd>
                      {captureResult.counters.resourcesSaved.toLocaleString()} saved ·{' '}
                      {captureResult.counters.resourcesFailed.toLocaleString()} failed ·{' '}
                      {captureResult.counters.resourcesSkipped.toLocaleString()} skipped
                    </dd>
                  </div>
                </dl>

                {captureResult.status === 'completed' && (
                  <div className="result-download">
                    <button
                      type="button"
                      className="download-action"
                      onClick={downloadArchive}
                      disabled={!captureResult.archiveAvailable || downloadStatus === 'downloading'}
                    >
                      {downloadStatus === 'downloading' ? 'Preparing download...' : 'Download ZIP'}
                    </button>
                    {!captureResult.archiveAvailable && (
                      <p className="result-note">
                        The ZIP is no longer in this browser session. Run the archive again to
                        download it.
                      </p>
                    )}
                    {downloadMessage && (
                      <p
                        className={downloadStatus === 'error' ? 'error-text' : 'success-text'}
                        role="status"
                      >
                        {downloadMessage}
                      </p>
                    )}
                  </div>
                )}

                {captureResult.status === 'failed' && (
                  <div className="task-failure" role="alert">
                    <strong>
                      {captureResult.error?.message ?? 'The archive could not be completed.'}
                    </strong>
                    <p>
                      {captureResult.error?.suggestion ??
                        'Review the resource failures below, then retry the task.'}
                    </p>
                    <span>
                      {captureResult.error?.retryable ? 'Retry available' : 'Create a new task'}
                      {captureResult.error?.context?.stage
                        ? ` · ${captureResult.error.context.stage}`
                        : ''}
                    </span>
                  </div>
                )}

                {captureResult.status === 'cancelled' && (
                  <p className="result-note">No ZIP was produced for this cancelled task.</p>
                )}

                {captureResult.failures.length > 0 && (
                  <details className="failure-details" open={captureResult.status === 'failed'}>
                    <summary>
                      Resource failures ({captureResult.failures.length}
                      {captureResult.omittedFailureCount > 0
                        ? ` shown, ${captureResult.omittedFailureCount} more`
                        : ''}
                      )
                    </summary>
                    <div className="failure-list">
                      {captureResult.failures.map((failure, index) => (
                        <article
                          className="failure-item"
                          key={`${failure.url}-${failure.resourceType}-${index}`}
                        >
                          <div className="failure-title">
                            <strong>{failure.resourceType}</strong>
                            <span>
                              {failure.httpStatus
                                ? `HTTP ${failure.httpStatus}`
                                : failure.error.code}
                            </span>
                          </div>
                          <p className="failure-url">{failure.url}</p>
                          <p>{failure.error.message}</p>
                          <small>
                            {failure.affectsPrimaryVisual
                              ? 'May affect the main page'
                              : 'Secondary resource'}
                            {failure.error.context?.stage
                              ? ` · ${failure.error.context.stage}`
                              : ''}
                          </small>
                          {failure.error.suggestion && <p>{failure.error.suggestion}</p>}
                        </article>
                      ))}
                    </div>
                  </details>
                )}
              </>
            )}
          </section>
        )}

        <section className="task-history" aria-labelledby="task-history-title">
          <div className="history-heading">
            <div>
              <p className="result-eyebrow">Local tasks</p>
              <h2 id="task-history-title">Task history</h2>
            </div>
            <div className="history-heading-actions">
              <button
                type="button"
                className="history-action"
                onClick={() => void refreshHistory()}
                disabled={historyStatus === 'loading' || historyMutation !== null}
              >
                Refresh
              </button>
              <button
                type="button"
                className="history-action danger"
                onClick={() => void clearHistory()}
                disabled={historyItems.length === 0 || historyMutation !== null}
              >
                {historyMutation === 'clear' ? 'Clearing...' : 'Clear history'}
              </button>
            </div>
          </div>

          {historyStatus === 'loading' && historyItems.length === 0 && (
            <p className="history-empty">Loading local history...</p>
          )}
          {historyStatus === 'ready' && historyItems.length === 0 && (
            <p className="history-empty">No completed, failed, or cancelled tasks yet.</p>
          )}
          {historyError && (
            <p className="error-text history-error" role="alert">
              {historyError}
            </p>
          )}
          {historyItems.length > 0 && (
            <ul className="history-list">
              {historyItems.map((item) => (
                <li key={item.jobId}>
                  <div className="history-item-heading">
                    <strong>{item.fileName}</strong>
                    <span className={`job-state ${item.status}`}>{item.status}</span>
                  </div>
                  <p>{new Date(item.updatedAt).toLocaleString()}</p>
                  <p>
                    {item.counters.resourcesSaved.toLocaleString()} saved ·{' '}
                    {item.counters.resourcesFailed.toLocaleString()} failed ·{' '}
                    {item.archiveAvailable ? 'ZIP available' : 'metadata only'}
                  </p>
                  <div className="history-item-actions">
                    <button
                      type="button"
                      className="history-action"
                      onClick={() => void openHistoryJob(item.jobId)}
                      disabled={historyMutation !== null}
                    >
                      {historyMutation === `open:${item.jobId}` ? 'Opening...' : 'Open'}
                    </button>
                    <button
                      type="button"
                      className="history-action danger"
                      onClick={() => void deleteHistoryJob(item)}
                      disabled={historyMutation !== null}
                    >
                      {historyMutation === `delete:${item.jobId}` ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="capture-setting access-setting">
          <span>Current site access</span>
          <span className="access-value">{summarizeSiteAccess(siteAccess)}</span>
        </div>

        {status === 'success' && pageInfo && (
          <>
            <details className="diagnostics">
              <summary>Capture diagnostics</summary>
              <dl className="page-info">
                <div>
                  <dt>Tab URL</dt>
                  <dd>{pageInfo.tabUrl}</dd>
                </div>
                <div>
                  <dt>Base URL</dt>
                  <dd>{pageInfo.baseUrl}</dd>
                </div>
                <div>
                  <dt>DOM snapshot</dt>
                  <dd>{pageInfo.serializedDom.length.toLocaleString()} chars</dd>
                </div>
                <div>
                  <dt>Special regions</dt>
                  <dd>{summarizeRegions(pageInfo)}</dd>
                </div>
                <div>
                  <dt>Runtime resources</dt>
                  <dd>{pageInfo.performanceResources.length.toLocaleString()} timing entries</dd>
                </div>
                <div>
                  <dt>DOM resources</dt>
                  <dd>{pageInfo.domResources.length.toLocaleString()} attribute candidates</dd>
                </div>
                <div>
                  <dt>Embedded sources</dt>
                  <dd>
                    {pageInfo.cssSources.length.toLocaleString()} CSS /{' '}
                    {pageInfo.svgResources.length.toLocaleString()} SVG
                  </dd>
                </div>
                <div>
                  <dt>CSS references</dt>
                  <dd>{pageInfo.cssResources.length.toLocaleString()} AST candidates</dd>
                </div>
                <div>
                  <dt>Unified resources</dt>
                  <dd>
                    {pageInfo.mergedResources.length.toLocaleString()} normalized URLs /{' '}
                    {countMergedEvidence(pageInfo).toLocaleString()} discoveries
                  </dd>
                </div>
                <div>
                  <dt>Resource graph</dt>
                  <dd>
                    {pageInfo.resourceGraph.nodes.length.toLocaleString()} nodes /{' '}
                    {pageInfo.resourceGraph.edges.length.toLocaleString()} provenance edges
                  </dd>
                </div>
                <div>
                  <dt>Resource protocols</dt>
                  <dd>{summarizeResourceProtocols(pageInfo)}</dd>
                </div>
                <div>
                  <dt>Resource metadata</dt>
                  <dd>{summarizeResourceMetadata(pageInfo)}</dd>
                </div>
              </dl>
            </details>

            {includeThirdPartyResources && (
              <section className="third-party-section" aria-labelledby="third-party-title">
                <div className="third-party-heading">
                  <div>
                    <h3 id="third-party-title">Third-party access</h3>
                    <p>Hosts used by this page.</p>
                  </div>
                  {pendingThirdPartyCount > 0 ? (
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={grantSelectedThirdParties}
                      disabled={
                        selectedThirdParties.length === 0 || thirdPartyGrantStatus === 'requesting'
                      }
                    >
                      {thirdPartyGrantStatus === 'requesting' ? 'Granting...' : 'Grant selected'}
                    </button>
                  ) : (
                    <span className="access-summary">
                      {thirdPartyAccess.length > 0 ? 'All granted' : 'None required'}
                    </span>
                  )}
                </div>

                {thirdPartyAccess.length === 0 ? (
                  <p className="helper-text">No third-party network hosts discovered.</p>
                ) : (
                  <ul className="third-party-list">
                    {thirdPartyAccess.map((access) => (
                      <li key={access.permissionPattern}>
                        <label>
                          <input
                            type="checkbox"
                            checked={
                              access.status === 'granted' ||
                              selectedThirdParties.includes(access.permissionPattern)
                            }
                            disabled={
                              access.status === 'granted' || thirdPartyGrantStatus === 'requesting'
                            }
                            onChange={(event) =>
                              toggleThirdParty(
                                access.permissionPattern,
                                event.currentTarget.checked,
                              )
                            }
                          />
                          <span className="third-party-details">
                            <span className="third-party-pattern">{access.permissionPattern}</span>
                            <span>
                              {access.resourceCount.toLocaleString()} resources ·{' '}
                              {access.provenanceCount.toLocaleString()} discoveries ·{' '}
                              {access.discoverySources.join(', ')} ·{' '}
                              {access.resourceTypes.join(', ')}
                            </span>
                          </span>
                          <span className={`access-state ${access.status}`}>
                            {access.status === 'granted' ? 'Granted' : 'Pending'}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}

                {thirdPartyError && (
                  <p className="error-text" role="alert">
                    {thirdPartyError}
                  </p>
                )}
              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}
