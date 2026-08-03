import { exportArchiveWithChromeDownloads } from '@sitecapsule/archive';
import {
  DEFAULT_RENDER_WAIT_MS,
  MAX_RENDER_WAIT_MS,
  SiteCapsuleError,
  createCaptureError,
  isPausableJobStatus,
  toCaptureError,
  type CaptureJob,
  type CaptureError,
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
  getFirstInvalidArchiveFocusTarget,
  getPostActionFocusTarget,
  isThirdPartyCaptureReady,
  MAX_CURRENT_PAGE_CONCURRENCY,
  MIN_CURRENT_PAGE_CONCURRENCY,
  createInitialCurrentPageArchiveName,
  editCurrentPageArchiveName,
  validateConcurrencyInput,
  validateCurrentPageArchiveFileName,
  validateRenderWaitInput,
  readCaptureArchiveBytes,
  UI_LOCALE_STORAGE_KEY,
  localizeCaptureError,
  resolveUiLocale,
  translate,
  type UiLocale,
  type UiMessageKey,
} from '@sitecapsule/ui';
import { useEffect, useState } from 'react';

type ReadStatus = 'idle' | 'loading' | 'success' | 'error';
type ThirdPartyGrantStatus = 'idle' | 'requesting';
type ThirdPartyCheckStatus = 'idle' | 'checking' | 'ready' | 'error';
type CreateStatus = 'idle' | 'creating';
type ControlStatus = 'idle' | CaptureJobCommand;
type ResultStatus = 'idle' | 'loading' | 'ready' | 'error';
type ArchivePreparationStatus = 'idle' | 'preparing' | 'ready' | 'error';
type DownloadStatus = 'idle' | 'downloading' | 'started' | 'error';
type HistoryStatus = 'loading' | 'ready' | 'error';

const LAST_CAPTURE_JOB_STORAGE_KEY = 'sitecapsule.lastCaptureJobId';
const PIPELINE_STAGES = [
  { status: 'preparing', label: 'preparing' },
  { status: 'discovering', label: 'discovering' },
  { status: 'fetching', label: 'downloading' },
  { status: 'rewriting', label: 'rewriting' },
  { status: 'packaging', label: 'packaging' },
] as const;

function focusPanelTarget(targetId: string): void {
  requestAnimationFrame(() => {
    document.getElementById(targetId)?.focus({ preventScroll: false });
  });
}

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

function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
}

function formatByteLength(value: number, locale: UiLocale): string {
  if (value < 1_024) return `${value.toLocaleString(locale)} B`;
  if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)} KB`;
  if (value < 1_024 * 1_024 * 1_024) return `${(value / (1_024 * 1_024)).toFixed(1)} MB`;
  return `${(value / (1_024 * 1_024 * 1_024)).toFixed(1)} GB`;
}

type Translator = (key: UiMessageKey, values?: Record<string, string | number>) => string;

function summarizeSiteAccess(access: SiteAccessResult | null, t: Translator): string {
  if (!access) return t('notChecked');
  if (access.status === 'restricted') {
    return `${t('restricted')}${access.protocol ? ` · ${access.protocol}` : ''}`;
  }
  return `${t(access.status === 'granted' ? 'granted' : 'notGranted')} · ${access.permissionPattern}`;
}

function summarizeRegions(pageInfo: PageInfo, t: Translator): string {
  const counts = pageInfo.regionDiagnostics.regions.reduce(
    (summary, region) => {
      if (region.kind === 'iframe') summary.iframes += 1;
      if (region.kind === 'shadow-root') summary.shadowRoots += 1;
      if (region.access === 'inaccessible') summary.inaccessible += 1;
      return summary;
    },
    { iframes: 0, shadowRoots: 0, inaccessible: 0 },
  );

  return t('regionCounts', {
    iframes: counts.iframes,
    shadows: counts.shadowRoots,
    inaccessible: counts.inaccessible,
  });
}

function countMergedEvidence(pageInfo: PageInfo): number {
  return pageInfo.mergedResources.reduce((total, resource) => total + resource.evidence.length, 0);
}

function summarizeResourceProtocols(pageInfo: PageInfo, t: Translator): string {
  const counts = { network: 0, data: 0, blob: 0, unsupported: 0 };
  for (const node of pageInfo.resourceGraph.nodes) counts[node.classification.kind] += 1;
  return t('protocolCounts', counts);
}

function summarizeResourceMetadata(pageInfo: PageInfo, t: Translator): string {
  let typed = 0;
  let mimeHints = 0;
  let conflicts = 0;
  for (const node of pageInfo.resourceGraph.nodes) {
    if (node.inference.resourceTypeConfidence !== 'unknown') typed += 1;
    if (node.inference.mimeTypeHint !== null) mimeHints += 1;
    if (node.inference.hasConflict) conflicts += 1;
  }
  const unknown = pageInfo.resourceGraph.nodes.length - typed;
  return t('metadataCounts', { typed, unknown, mime: mimeHints, conflicts });
}

function jobStatusLabel(status: JobStatus, t: Translator): string {
  const keys: Record<JobStatus, UiMessageKey> = {
    idle: 'statusIdle',
    preparing: 'preparing',
    discovering: 'discovering',
    fetching: 'downloading',
    rewriting: 'rewriting',
    packaging: 'packaging',
    completed: 'statusCompleted',
    failed: 'statusFailed',
    cancelling: 'statusCancelling',
    cancelled: 'statusCancelled',
    paused: 'paused',
    retrying: 'statusRetrying',
  };
  return t(keys[status]);
}

export function App() {
  const [locale, setLocale] = useState<UiLocale>(() =>
    resolveUiLocale(browser.i18n.getUILanguage()),
  );
  const t: Translator = (key, values) => translate(locale, key, values);
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
  const [error, setError] = useState<CaptureError | null>(null);
  const [siteAccess, setSiteAccess] = useState<SiteAccessResult | null>(null);
  const [thirdPartyAccess, setThirdPartyAccess] = useState<ThirdPartySiteAccessSummary[]>([]);
  const [selectedThirdParties, setSelectedThirdParties] = useState<string[]>([]);
  const [thirdPartyGrantStatus, setThirdPartyGrantStatus] = useState<ThirdPartyGrantStatus>('idle');
  const [thirdPartyCheckStatus, setThirdPartyCheckStatus] = useState<ThirdPartyCheckStatus>('idle');
  const [thirdPartyError, setThirdPartyError] = useState<{
    key: 'permissionNotGranted' | 'permissionCheckError' | 'permissionGrantError';
    detail: string | null;
  } | null>(null);
  const [captureJob, setCaptureJob] = useState<CaptureJob | null>(null);
  const [createStatus, setCreateStatus] = useState<CreateStatus>('idle');
  const [createError, setCreateError] = useState<CaptureError | null>(null);
  const [controlStatus, setControlStatus] = useState<ControlStatus>('idle');
  const [controlError, setControlError] = useState<CaptureError | null>(null);
  const [resultStatus, setResultStatus] = useState<ResultStatus>('idle');
  const [captureResult, setCaptureResult] = useState<CaptureJobResult | null>(null);
  const [resultError, setResultError] = useState<CaptureError | null>(null);
  const [archivePreparationStatus, setArchivePreparationStatus] =
    useState<ArchivePreparationStatus>('idle');
  const [preparedArchive, setPreparedArchive] = useState<{
    jobId: string;
    bytes: Uint8Array;
  } | null>(null);
  const [archivePreparationAttempt, setArchivePreparationAttempt] = useState(0);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>('idle');
  const [downloadFileName, setDownloadFileName] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<CaptureError | null>(null);
  const [historyItems, setHistoryItems] = useState<CaptureJobHistoryItem[]>([]);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>('loading');
  const [historyError, setHistoryError] = useState<CaptureError | null>(null);
  const [historyMutation, setHistoryMutation] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState({ sequence: 0, text: '' });
  const announce = (text: string) => {
    setAnnouncement((current) => ({ sequence: current.sequence + 1, text }));
  };
  const pendingThirdPartyPatterns = getPendingThirdPartyPermissionPatterns(thirdPartyAccess);
  const pendingThirdPartyCount = pendingThirdPartyPatterns.length;
  const criticalThirdPartyCount = thirdPartyAccess.filter(
    ({ defaultSelected }) => defaultSelected,
  ).length;
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
    ? t('settingsReady')
    : status !== 'success'
      ? t('readToSetup')
      : !archiveNameValidation.valid || !renderWaitValidation.valid || !concurrencyValidation.valid
        ? t('fixSettings')
        : includeThirdPartyResources && thirdPartyCheckStatus === 'error'
          ? t('thirdPartyCheckFailed')
          : includeThirdPartyResources && pendingThirdPartyCount > 0
            ? t('grantHostCount', { count: pendingThirdPartyCount })
            : t('checkingSettings');

  const thirdPartyOptionStatus =
    status !== 'success'
      ? t('accessAfterRead')
      : thirdPartyCheckStatus === 'checking'
        ? t('checkingHostAccess')
        : thirdPartyCheckStatus === 'error'
          ? t('hostAccessFailed')
          : criticalThirdPartyCount === 0
            ? t('noThirdPartyHosts')
            : !includeThirdPartyResources
              ? t('hostsFoundOff', { count: criticalThirdPartyCount })
              : pendingThirdPartyCount > 0
                ? t('hostsNeedAccess', { count: pendingThirdPartyCount })
                : t('hostsReady', { count: criticalThirdPartyCount });

  const captureErrorText = (captureError: CaptureError): string => {
    const localized = localizeCaptureError(captureError, locale);
    return [localized.message, localized.suggestion, localized.context?.browserError]
      .filter((value): value is string => Boolean(value))
      .join(' ');
  };

  const archiveNameError = !archiveName.value.trim()
    ? t('zipNameEmpty')
    : !archiveName.value.trim().toLowerCase().endsWith('.zip')
      ? t('zipNameExtension')
      : t('zipNamePortable');
  const renderWaitError = !renderWaitInput.trim()
    ? t('renderWaitEmpty')
    : !/^\d+$/.test(renderWaitInput.trim())
      ? t('renderWaitWhole')
      : t('renderWaitRange', { max: MAX_RENDER_WAIT_MS });
  const concurrencyError = !concurrencyInput.trim()
    ? t('concurrencyEmpty')
    : !/^\d+$/.test(concurrencyInput.trim())
      ? t('concurrencyWhole')
      : t('concurrencyRange', {
          min: MIN_CURRENT_PAGE_CONCURRENCY,
          max: MAX_CURRENT_PAGE_CONCURRENCY,
        });

  useEffect(() => {
    void browser.storage.local
      .get(UI_LOCALE_STORAGE_KEY)
      .then((stored) => {
        const saved = stored[UI_LOCALE_STORAGE_KEY];
        if (saved === 'en' || saved === 'zh-CN') setLocale(saved);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const changeLocale = (nextLocale: UiLocale) => {
    setLocale(nextLocale);
    void browser.storage.local.set({ [UI_LOCALE_STORAGE_KEY]: nextLocale });
  };

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

  async function refreshHistory(shouldAnnounce = false): Promise<void> {
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
      if (shouldAnnounce) announce(t('historyRefreshedAnnouncement'));
    } catch (requestError) {
      const captureError = toCaptureError(requestError, 'storage-unavailable', {
        operation: 'job-list',
      });
      setHistoryError(captureError);
      setHistoryStatus('error');
      if (shouldAnnounce) announce(t('operationFailedAnnouncement'));
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
      setDownloadFileName(null);
      setDownloadError(null);
      return () => {
        disposed = true;
      };
    }

    setResultStatus('loading');
    setResultError(null);
    setDownloadStatus('idle');
    setDownloadFileName(null);
    setDownloadError(null);
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
        setResultError(captureError);
        setResultStatus('error');
      });

    return () => {
      disposed = true;
    };
  }, [captureJob?.id, captureJob?.status, captureJob?.updatedAt]);

  useEffect(() => {
    let disposed = false;
    setPreparedArchive(null);

    if (
      !captureResult?.archiveAvailable ||
      captureResult.archiveByteLength === null ||
      captureResult.status !== 'completed'
    ) {
      setArchivePreparationStatus('idle');
      return () => {
        disposed = true;
      };
    }

    setArchivePreparationStatus('preparing');
    setDownloadStatus('idle');
    setDownloadFileName(null);
    setDownloadError(null);
    void readCaptureArchiveBytes(captureResult.jobId, captureResult.archiveByteLength, (request) =>
      browser.runtime.sendMessage(request),
    )
      .then((bytes) => {
        if (disposed) return;
        setPreparedArchive({ jobId: captureResult.jobId, bytes });
        setArchivePreparationStatus('ready');
      })
      .catch((requestError: unknown) => {
        if (disposed) return;
        const captureError = toCaptureError(requestError, 'archive-download-failed', {
          operation: 'archive-download',
          jobId: captureResult.jobId,
        });
        setArchivePreparationStatus('error');
        setDownloadStatus('error');
        setDownloadError(captureError);
      });

    return () => {
      disposed = true;
    };
  }, [
    captureResult?.jobId,
    captureResult?.status,
    captureResult?.archiveAvailable,
    captureResult?.archiveByteLength,
    archivePreparationAttempt,
  ]);

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
      announce(t('pageReadyAnnouncement'));
      focusPanelTarget('archive-file-name');

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
        setThirdPartyError({
          key: 'permissionCheckError',
          detail: errorMessage(permissionError),
        });
        setThirdPartyCheckStatus('error');
      }
    } catch (requestError) {
      const captureError = toCaptureError(requestError, 'unexpected-error', {
        operation: 'page-info',
      });
      setPageInfo(null);
      setCurrentTabId(null);
      setThirdPartyCheckStatus('idle');
      setError(captureError);
      setStatus('error');
      announce(t('operationFailedAnnouncement'));
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
        setThirdPartyError({ key: 'permissionNotGranted', detail: null });
        return;
      }

      const refreshed = await summarizeThirdPartySiteAccess(
        pageInfo.resourceGraph,
        (permissionRequest) => browser.permissions.contains(permissionRequest),
      );
      setThirdPartyAccess(refreshed);
      setSelectedThirdParties(getPendingThirdPartyPermissionPatterns(refreshed));
      setThirdPartyCheckStatus('ready');
    } catch (permissionError) {
      setThirdPartyError({
        key: 'permissionGrantError',
        detail: errorMessage(permissionError),
      });
    } finally {
      setThirdPartyGrantStatus('idle');
    }
  };

  const startCapture = async () => {
    if (!currentPageTask) {
      const target = getFirstInvalidArchiveFocusTarget({
        archiveFileName: archiveNameValidation.valid,
        renderWait: renderWaitValidation.valid,
        concurrency: concurrencyValidation.valid,
      });
      if (target) {
        announce(t('focusFixAnnouncement'));
        focusPanelTarget(target);
      }
      return;
    }
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
      announce(
        t('taskStatusAnnouncement', { status: jobStatusLabel(response.payload.job.status, t) }),
      );
      focusPanelTarget(getPostActionFocusTarget('capture-updated'));
    } catch (requestError) {
      const captureError = toCaptureError(requestError, 'unexpected-error', {
        operation: 'job-create',
      });
      setCreateError(captureError);
      announce(t('operationFailedAnnouncement'));
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
      announce(
        t('taskStatusAnnouncement', { status: jobStatusLabel(response.payload.job.status, t) }),
      );
      focusPanelTarget('capture-progress');
    } catch (requestError) {
      const captureError = toCaptureError(requestError, 'unexpected-error', {
        operation: 'job-transition',
        jobId: captureJob.id,
      });
      setControlError(captureError);
      announce(t('operationFailedAnnouncement'));
    } finally {
      setControlStatus('idle');
    }
  };

  const downloadArchive = async () => {
    if (captureResult?.archiveAvailable && archivePreparationStatus === 'error') {
      setArchivePreparationAttempt((current) => current + 1);
      return;
    }
    if (
      !captureResult?.archiveAvailable ||
      archivePreparationStatus !== 'ready' ||
      preparedArchive?.jobId !== captureResult.jobId ||
      downloadStatus === 'downloading'
    ) {
      return;
    }
    setDownloadStatus('downloading');
    setDownloadFileName(null);
    setDownloadError(null);
    try {
      const downloaded = await exportArchiveWithChromeDownloads({
        archiveBytes: preparedArchive.bytes,
        fileName: captureResult.fileName,
        saveAs: true,
      });
      setDownloadStatus('started');
      setDownloadFileName(downloaded.fileName);
      announce(t('downloadReadyAnnouncement'));
    } catch (requestError) {
      const captureError = toCaptureError(requestError, 'archive-download-failed', {
        operation: 'archive-download',
        jobId: captureResult.jobId,
      });
      setDownloadStatus('error');
      setDownloadError(captureError);
      announce(t('operationFailedAnnouncement'));
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
      announce(
        t('historyOpenedAnnouncement', {
          value: response.payload.job.settings.archiveFileName,
        }),
      );
      focusPanelTarget(
        ['completed', 'failed', 'cancelled'].includes(response.payload.job.status)
          ? getPostActionFocusTarget('history-opened')
          : getPostActionFocusTarget('capture-updated'),
      );
    } catch (requestError) {
      const captureError = toCaptureError(requestError, 'unexpected-error', {
        operation: 'job-read',
      });
      setHistoryError(captureError);
      announce(t('operationFailedAnnouncement'));
    } finally {
      setHistoryMutation(null);
    }
  };

  const deleteHistoryJob = async (item: CaptureJobHistoryItem) => {
    if (!window.confirm(t('confirmDelete', { value: item.fileName }))) return;
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
      announce(t('historyDeletedAnnouncement', { value: item.fileName }));
      focusPanelTarget(getPostActionFocusTarget('history-mutated'));
    } catch (requestError) {
      const captureError = toCaptureError(requestError, 'unexpected-error', {
        operation: 'job-cleanup',
      });
      setHistoryError(captureError);
      announce(t('operationFailedAnnouncement'));
    } finally {
      setHistoryMutation(null);
    }
  };

  const clearHistory = async () => {
    if (!window.confirm(t('confirmClear', { count: historyItems.length }))) return;
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
      announce(t('historyClearedAnnouncement'));
      focusPanelTarget(getPostActionFocusTarget('history-mutated'));
    } catch (requestError) {
      const captureError = toCaptureError(requestError, 'unexpected-error', {
        operation: 'job-cleanup',
      });
      setHistoryError(captureError);
      announce(t('operationFailedAnnouncement'));
    } finally {
      setHistoryMutation(null);
    }
  };

  return (
    <main className="app-shell" lang={locale}>
      <p
        key={announcement.sequence}
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement.text}
      </p>
      <header className="app-header">
        <div>
          <p className="eyebrow">{EXTENSION_NAME}</p>
          <h1>{t('newArchive')}</h1>
        </div>
        <div className="header-controls">
          <label className="language-control">
            <span>{t('language')}</span>
            <select
              value={locale}
              onChange={(event) => changeLocale(event.currentTarget.value as UiLocale)}
            >
              <option value="en">{t('english')}</option>
              <option value="zh-CN">{t('chinese')}</option>
            </select>
          </label>
          <span className="status-badge">{t('currentPage')}</span>
        </div>
      </header>

      <section className="inspect-section" aria-labelledby="inspect-title">
        <div className="section-heading">
          <h2 id="inspect-title">{t('page')}</h2>
          <button
            className="primary-action"
            type="button"
            onClick={readCurrentPage}
            disabled={status === 'loading' || !renderWaitValidation.valid}
          >
            {status === 'loading'
              ? t('reading')
              : status === 'success'
                ? t('refreshPage')
                : t('useCurrentPage')}
          </button>
        </div>

        {status === 'idle' && <p className="helper-text">{t('chooseTab')}</p>}
        {status === 'loading' && (
          <p className="helper-text">
            {t('waitingToRead', {
              count: renderWaitValidation.valid ? renderWaitValidation.value : 0,
            })}
          </p>
        )}
        {status === 'error' && (
          <p className="error-text" role="alert">
            {error && captureErrorText(error)}
          </p>
        )}

        <form
          className="task-settings"
          data-task-ready={currentPageTask !== null}
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="setting-row mode-setting">
            <span>{t('captureMode')}</span>
            <strong>{t('currentPage')}</strong>
          </div>

          {pageInfo && (
            <dl className="page-summary">
              <div>
                <dt>{t('title')}</dt>
                <dd>{pageInfo.title || t('untitledPage')}</dd>
              </div>
              <div>
                <dt>{t('pageUrl')}</dt>
                <dd>{pageInfo.finalUrl}</dd>
              </div>
            </dl>
          )}

          <div className="file-name-setting">
            <label htmlFor="archive-file-name">{t('zipFileName')}</label>
            <input
              id="archive-file-name"
              name="archiveFileName"
              type="text"
              value={archiveName.value}
              aria-invalid={!archiveNameValidation.valid}
              aria-describedby="archive-file-name-feedback"
              aria-errormessage={
                archiveNameValidation.valid ? undefined : 'archive-file-name-feedback'
              }
              spellCheck="false"
              autoComplete="off"
              onChange={(event) =>
                setArchiveName(editCurrentPageArchiveName(event.currentTarget.value))
              }
            />
            <div id="archive-file-name-feedback" className="field-feedback" aria-live="polite">
              {archiveNameValidation.valid ? (
                <span className="valid-text">{t('validZipName')}</span>
              ) : (
                <>
                  <span className="error-text">{archiveNameError}</span>
                  {archiveNameValidation.suggestion && (
                    <button
                      className="suggestion-action"
                      type="button"
                      onClick={() => {
                        setArchiveName(
                          editCurrentPageArchiveName(archiveNameValidation.suggestion ?? ''),
                        );
                        focusPanelTarget('archive-file-name');
                      }}
                    >
                      {t('useSuggestion', { value: archiveNameValidation.suggestion })}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <fieldset className="capture-options">
            <legend>{t('captureOptions')}</legend>

            <div className="numeric-setting">
              <div className="numeric-setting-row">
                <label htmlFor="render-wait">{t('renderWait')}</label>
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
                    aria-errormessage={
                      renderWaitValidation.valid ? undefined : 'render-wait-feedback'
                    }
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
                  : renderWaitError}
              </p>
            </div>

            <div className="numeric-setting">
              <div className="numeric-setting-row">
                <label htmlFor="capture-concurrency">{t('concurrentDownloads')}</label>
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
                  aria-errormessage={
                    concurrencyValidation.valid ? undefined : 'capture-concurrency-feedback'
                  }
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
                  : concurrencyError}
              </p>
            </div>

            <label className="toggle-setting">
              <span>
                <strong>{t('mediaFiles')}</strong>
                <small>{t('videoAudio')}</small>
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
                <strong>{t('thirdPartyResources')}</strong>
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
            id="task-readiness"
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
            aria-describedby="task-readiness"
            disabled={
              status !== 'success' ||
              !thirdPartyReady ||
              createStatus === 'creating' ||
              (captureJob !== null && isActiveJob(captureJob.status))
            }
          >
            {captureJob && isActiveJob(captureJob.status)
              ? t('archiving')
              : createStatus === 'creating'
                ? t('starting')
                : t('createArchive')}
          </button>

          {createError && (
            <p className="error-text" role="alert">
              {captureErrorText(createError)}
            </p>
          )}
        </form>

        {captureJob && (
          <section className="capture-progress" aria-labelledby="capture-progress">
            <div className="progress-heading">
              <div>
                <h3 id="capture-progress" tabIndex={-1}>
                  {t('archiveProgress')}
                </h3>
                <p>{captureJob.settings.archiveFileName}</p>
              </div>
              <span
                className={`job-state ${captureJob.status}`}
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {jobStatusLabel(captureJob.status, t)}
              </span>
            </div>
            <ol className="progress-stages" aria-label={t('archiveStages')}>
              {PIPELINE_STAGES.map((stage) => {
                const displayState = stageDisplayState(captureJob, stage.status);
                return (
                  <li key={stage.status} className={displayState}>
                    <span className="stage-marker" aria-hidden="true" />
                    <span>{t(stage.label)}</span>
                    <small>
                      {displayState === 'complete'
                        ? t('done')
                        : displayState === 'active'
                          ? captureJob.status === 'paused'
                            ? t('paused')
                            : t('inProgress')
                          : t('waiting')}
                    </small>
                  </li>
                );
              })}
            </ol>
            <dl className="progress-counters">
              <div>
                <dt>{t('resources')}</dt>
                <dd>
                  {t('resourceCounts', {
                    saved: captureJob.counters.resourcesSaved.toLocaleString(locale),
                    failed: captureJob.counters.resourcesFailed.toLocaleString(locale),
                    skipped: captureJob.counters.resourcesSkipped.toLocaleString(locale),
                  })}
                </dd>
              </div>
              <div>
                <dt>{t('downloaded')}</dt>
                <dd>
                  {t('byteCount', {
                    count: captureJob.counters.bytesWritten.toLocaleString(locale),
                  })}
                </dd>
              </div>
            </dl>
            {(isPausableJobStatus(captureJob.status) ||
              captureJob.status === 'paused' ||
              captureJob.status === 'failed') && (
              <div className="job-controls" aria-label={t('archiveControls')}>
                {isPausableJobStatus(captureJob.status) && (
                  <button
                    type="button"
                    className="job-control-action"
                    onClick={() => controlCapture('pause')}
                    disabled={controlStatus !== 'idle'}
                  >
                    {controlStatus === 'pause' ? t('pausing') : t('pause')}
                  </button>
                )}
                {captureJob.status === 'paused' && (
                  <button
                    type="button"
                    className="job-control-action primary"
                    onClick={() => controlCapture('resume')}
                    disabled={controlStatus !== 'idle'}
                  >
                    {controlStatus === 'resume' ? t('resuming') : t('resume')}
                  </button>
                )}
                {captureJob.status === 'failed' && (
                  <button
                    type="button"
                    className="job-control-action primary"
                    onClick={() => controlCapture('retry')}
                    disabled={controlStatus !== 'idle'}
                  >
                    {controlStatus === 'retry' ? t('retrying') : t('retry')}
                  </button>
                )}
                {(isPausableJobStatus(captureJob.status) || captureJob.status === 'paused') && (
                  <button
                    type="button"
                    className="job-control-action danger"
                    onClick={() => controlCapture('cancel')}
                    disabled={controlStatus !== 'idle'}
                  >
                    {controlStatus === 'cancel' ? t('cancelling') : t('cancel')}
                  </button>
                )}
              </div>
            )}
            {controlError && (
              <p className="error-text control-error" role="alert">
                {captureErrorText(controlError)}
              </p>
            )}
          </section>
        )}

        {captureJob && ['completed', 'failed', 'cancelled'].includes(captureJob.status) && (
          <section className="capture-result" aria-labelledby="capture-result">
            <div className="result-heading">
              <div>
                <p className="result-eyebrow">{t('taskResult')}</p>
                <h2 id="capture-result" tabIndex={-1}>
                  {captureJob.status === 'completed'
                    ? captureJob.counters.resourcesFailed > 0
                      ? t('readyIssues')
                      : t('archiveReady')
                    : captureJob.status === 'failed'
                      ? t('archiveFailed')
                      : t('archiveCancelled')}
                </h2>
              </div>
              {resultStatus === 'loading' && (
                <span className="result-loading" role="status">
                  {t('loading')}
                </span>
              )}
            </div>

            {resultStatus === 'error' && (
              <p className="error-text result-message" role="alert">
                {resultError && captureErrorText(resultError)}
              </p>
            )}

            {resultStatus === 'ready' && captureResult && (
              <>
                <dl className="result-summary">
                  <div>
                    <dt>{t('zipFile')}</dt>
                    <dd>{captureResult.fileName}</dd>
                  </div>
                  <div>
                    <dt>{t('zipSize')}</dt>
                    <dd>
                      {captureResult.archiveByteLength === null
                        ? t('unavailable')
                        : formatByteLength(captureResult.archiveByteLength, locale)}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('resources')}</dt>
                    <dd>
                      {t('resourceCounts', {
                        saved: captureResult.counters.resourcesSaved.toLocaleString(locale),
                        failed: captureResult.counters.resourcesFailed.toLocaleString(locale),
                        skipped: captureResult.counters.resourcesSkipped.toLocaleString(locale),
                      })}
                    </dd>
                  </div>
                </dl>

                {captureResult.status === 'completed' && (
                  <div className="result-download">
                    <button
                      type="button"
                      className="download-action"
                      onClick={downloadArchive}
                      disabled={
                        !captureResult.archiveAvailable ||
                        archivePreparationStatus === 'idle' ||
                        archivePreparationStatus === 'preparing' ||
                        downloadStatus === 'downloading'
                      }
                    >
                      {archivePreparationStatus === 'preparing' || downloadStatus === 'downloading'
                        ? t('preparingDownload')
                        : archivePreparationStatus === 'error'
                          ? t('retry')
                          : t('downloadZip')}
                    </button>
                    {!captureResult.archiveAvailable && (
                      <p className="result-note">{t('zipSessionGone')}</p>
                    )}
                    {(downloadFileName || downloadError) && (
                      <p
                        className={downloadStatus === 'error' ? 'error-text' : 'success-text'}
                        role="status"
                      >
                        {downloadError
                          ? captureErrorText(downloadError)
                          : t('downloadStarted', { value: downloadFileName ?? '' })}
                      </p>
                    )}
                  </div>
                )}

                {captureResult.status === 'failed' && (
                  <div className="task-failure" role="alert">
                    <strong>
                      {captureResult.error
                        ? localizeCaptureError(captureResult.error, locale).message
                        : t('archiveIncomplete')}
                    </strong>
                    <p>
                      {captureResult.error
                        ? localizeCaptureError(captureResult.error, locale).suggestion
                        : t('reviewFailures')}
                    </p>
                    <span>
                      {captureResult.error?.retryable ? t('retryAvailable') : t('createNewTask')}
                      {captureResult.error?.context?.stage
                        ? ` · ${jobStatusLabel(captureResult.error.context.stage, t)}`
                        : ''}
                    </span>
                  </div>
                )}

                {captureResult.status === 'cancelled' && (
                  <p className="result-note">{t('cancelledNoZip')}</p>
                )}

                {captureResult.failures.length > 0 && (
                  <details className="failure-details" open={captureResult.status === 'failed'}>
                    <summary>
                      {t('resourceFailures', {
                        count: captureResult.failures.length,
                        suffix:
                          captureResult.omittedFailureCount > 0
                            ? t('failuresMore', { count: captureResult.omittedFailureCount })
                            : '',
                      })}
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
                          <p>{localizeCaptureError(failure.error, locale).message}</p>
                          <small>
                            {failure.affectsPrimaryVisual
                              ? t('mainPageImpact')
                              : t('secondaryResource')}
                            {failure.error.context?.stage
                              ? ` · ${jobStatusLabel(failure.error.context.stage, t)}`
                              : ''}
                          </small>
                          {failure.error.suggestion && (
                            <p>{localizeCaptureError(failure.error, locale).suggestion}</p>
                          )}
                        </article>
                      ))}
                    </div>
                  </details>
                )}
              </>
            )}
          </section>
        )}

        <section className="task-history" aria-labelledby="task-history">
          <div className="history-heading">
            <div>
              <p className="result-eyebrow">{t('localTasks')}</p>
              <h2 id="task-history" tabIndex={-1}>
                {t('taskHistory')}
              </h2>
            </div>
            <div className="history-heading-actions">
              <button
                type="button"
                className="history-action"
                onClick={() => void refreshHistory(true)}
                disabled={historyStatus === 'loading' || historyMutation !== null}
              >
                {t('refresh')}
              </button>
              <button
                type="button"
                className="history-action danger"
                onClick={() => void clearHistory()}
                disabled={historyItems.length === 0 || historyMutation !== null}
              >
                {historyMutation === 'clear' ? t('clearing') : t('clearHistory')}
              </button>
            </div>
          </div>

          {historyStatus === 'loading' && historyItems.length === 0 && (
            <p className="history-empty" role="status">
              {t('loadingHistory')}
            </p>
          )}
          {historyStatus === 'ready' && historyItems.length === 0 && (
            <p className="history-empty">{t('noHistory')}</p>
          )}
          {historyError && (
            <p className="error-text history-error" role="alert">
              {captureErrorText(historyError)}
            </p>
          )}
          {historyItems.length > 0 && (
            <ul className="history-list">
              {historyItems.map((item) => (
                <li key={item.jobId}>
                  <div className="history-item-heading">
                    <strong>{item.fileName}</strong>
                    <span className={`job-state ${item.status}`}>
                      {jobStatusLabel(item.status, t)}
                    </span>
                  </div>
                  <p>{new Date(item.updatedAt).toLocaleString(locale)}</p>
                  <p>
                    {t('resourceCounts', {
                      saved: item.counters.resourcesSaved.toLocaleString(locale),
                      failed: item.counters.resourcesFailed.toLocaleString(locale),
                      skipped: item.counters.resourcesSkipped.toLocaleString(locale),
                    })}{' '}
                    · {item.archiveAvailable ? t('zipAvailable') : t('metadataOnly')}
                  </p>
                  <div className="history-item-actions">
                    <button
                      type="button"
                      className="history-action"
                      onClick={() => void openHistoryJob(item.jobId)}
                      disabled={historyMutation !== null}
                    >
                      {historyMutation === `open:${item.jobId}` ? t('opening') : t('open')}
                    </button>
                    <button
                      type="button"
                      className="history-action danger"
                      onClick={() => void deleteHistoryJob(item)}
                      disabled={historyMutation !== null}
                    >
                      {historyMutation === `delete:${item.jobId}` ? t('deleting') : t('delete')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="capture-setting access-setting">
          <span>{t('currentSiteAccess')}</span>
          <span className="access-value">{summarizeSiteAccess(siteAccess, t)}</span>
        </div>

        {status === 'success' && pageInfo && (
          <>
            <details className="diagnostics">
              <summary>{t('captureDiagnostics')}</summary>
              <dl className="page-info">
                <div>
                  <dt>{t('tabUrl')}</dt>
                  <dd>{pageInfo.tabUrl}</dd>
                </div>
                <div>
                  <dt>{t('baseUrl')}</dt>
                  <dd>{pageInfo.baseUrl}</dd>
                </div>
                <div>
                  <dt>{t('domSnapshot')}</dt>
                  <dd>
                    {t('chars', { count: pageInfo.serializedDom.length.toLocaleString(locale) })}
                  </dd>
                </div>
                <div>
                  <dt>{t('domCleanup')}</dt>
                  <dd>
                    {t('cleanupCounts', {
                      total: pageInfo.cleanupReport.removedElements.toLocaleString(locale),
                      extension:
                        pageInfo.cleanupReport.reasonCounts['extension-injection'].toLocaleString(
                          locale,
                        ),
                      tracking:
                        pageInfo.cleanupReport.reasonCounts['tracking-runtime'].toLocaleString(
                          locale,
                        ),
                      payment:
                        pageInfo.cleanupReport.reasonCounts['payment-runtime'].toLocaleString(
                          locale,
                        ),
                      iframes:
                        pageInfo.cleanupReport.reasonCounts['nonportable-iframe'].toLocaleString(
                          locale,
                        ),
                    })}
                  </dd>
                </div>
                <div>
                  <dt>{t('specialRegions')}</dt>
                  <dd>{summarizeRegions(pageInfo, t)}</dd>
                </div>
                <div>
                  <dt>{t('runtimeResources')}</dt>
                  <dd>
                    {t('timingEntries', {
                      count: pageInfo.performanceResources.length.toLocaleString(locale),
                    })}
                  </dd>
                </div>
                <div>
                  <dt>{t('domResources')}</dt>
                  <dd>
                    {t('attributeCandidates', {
                      count: pageInfo.domResources.length.toLocaleString(locale),
                    })}
                  </dd>
                </div>
                <div>
                  <dt>{t('embeddedSources')}</dt>
                  <dd>
                    {t('cssSvg', {
                      css: pageInfo.cssSources.length.toLocaleString(locale),
                      svg: pageInfo.svgResources.length.toLocaleString(locale),
                    })}
                  </dd>
                </div>
                <div>
                  <dt>{t('cssReferences')}</dt>
                  <dd>
                    {t('astCandidates', {
                      count: pageInfo.cssResources.length.toLocaleString(locale),
                    })}
                  </dd>
                </div>
                <div>
                  <dt>{t('unifiedResources')}</dt>
                  <dd>
                    {t('normalizedDiscoveries', {
                      urls: pageInfo.mergedResources.length.toLocaleString(locale),
                      discoveries: countMergedEvidence(pageInfo).toLocaleString(locale),
                    })}
                  </dd>
                </div>
                <div>
                  <dt>{t('resourceGraph')}</dt>
                  <dd>
                    {t('graphCounts', {
                      nodes: pageInfo.resourceGraph.nodes.length.toLocaleString(locale),
                      edges: pageInfo.resourceGraph.edges.length.toLocaleString(locale),
                    })}
                  </dd>
                </div>
                <div>
                  <dt>{t('resourceProtocols')}</dt>
                  <dd>{summarizeResourceProtocols(pageInfo, t)}</dd>
                </div>
                <div>
                  <dt>{t('resourceMetadata')}</dt>
                  <dd>{summarizeResourceMetadata(pageInfo, t)}</dd>
                </div>
              </dl>
            </details>

            {includeThirdPartyResources && (
              <section className="third-party-section" aria-labelledby="third-party-title">
                <div className="third-party-heading">
                  <div>
                    <h3 id="third-party-title">{t('thirdPartyAccess')}</h3>
                    <p>{t('hostsUsed')}</p>
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
                      {thirdPartyGrantStatus === 'requesting' ? t('granting') : t('grantSelected')}
                    </button>
                  ) : (
                    <span className="access-summary">
                      {criticalThirdPartyCount > 0 ? t('allGranted') : t('noneRequired')}
                    </span>
                  )}
                </div>

                {thirdPartyAccess.length === 0 ? (
                  <p className="helper-text">{t('noNetworkHosts')}</p>
                ) : (
                  <ul className="third-party-list">
                    {thirdPartyAccess.map((access) => (
                      <li key={access.permissionPattern}>
                        <label>
                          <input
                            type="checkbox"
                            checked={
                              access.defaultSelected &&
                              (access.status === 'granted' ||
                                selectedThirdParties.includes(access.permissionPattern))
                            }
                            disabled={
                              !access.defaultSelected ||
                              access.status === 'granted' ||
                              thirdPartyGrantStatus === 'requesting'
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
                              {t('accessDetails', {
                                resources: access.resourceCount.toLocaleString(locale),
                                discoveries: access.provenanceCount.toLocaleString(locale),
                                critical: access.criticalResourceCount.toLocaleString(locale),
                                excluded: access.excludedResourceCount.toLocaleString(locale),
                                sources: access.discoverySources.join(', '),
                                types: access.resourceTypes.join(', '),
                              })}
                            </span>
                          </span>
                          <span
                            className={`access-state ${access.defaultSelected ? access.status : 'runtime-excluded'}`}
                          >
                            {!access.defaultSelected
                              ? t('runtimeExcluded')
                              : access.status === 'granted'
                                ? t('granted')
                                : t('pending')}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}

                {thirdPartyError && (
                  <p className="error-text" role="alert">
                    {t(thirdPartyError.key)}
                    {thirdPartyError.detail ? ` ${thirdPartyError.detail}` : ''}
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
