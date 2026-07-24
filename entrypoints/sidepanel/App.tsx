import {
  DEFAULT_RENDER_WAIT_MS,
  MAX_RENDER_WAIT_MS,
  SiteCapsuleError,
  createCaptureError,
  toCaptureError,
} from '@sitecapsule/domain';
import { createPageInfoRequest, type PageInfo } from '@sitecapsule/messaging/protocol';
import { isPageInfoResponse } from '@sitecapsule/messaging/validators';
import {
  checkCurrentSiteAccess,
  createPageAccessRequest,
  createThirdPartyAccessRequest,
  summarizeThirdPartySiteAccess,
  type SiteAccessResult,
  type ThirdPartySiteAccessSummary,
} from '@sitecapsule/permissions';
import { EXTENSION_NAME } from '@sitecapsule/shared';
import { useState } from 'react';

const runtimeSurfaces = [
  ['Background', 'Ready'],
  ['Content', 'Runtime'],
  ['Offscreen', 'Standby'],
] as const;

type ReadStatus = 'idle' | 'loading' | 'success' | 'error';
type ThirdPartyGrantStatus = 'idle' | 'requesting';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown permission error.';
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
  const [renderWaitMs, setRenderWaitMs] = useState(DEFAULT_RENDER_WAIT_MS);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [siteAccess, setSiteAccess] = useState<SiteAccessResult | null>(null);
  const [thirdPartyAccess, setThirdPartyAccess] = useState<ThirdPartySiteAccessSummary[]>([]);
  const [selectedThirdParties, setSelectedThirdParties] = useState<string[]>([]);
  const [thirdPartyGrantStatus, setThirdPartyGrantStatus] = useState<ThirdPartyGrantStatus>('idle');
  const [thirdPartyError, setThirdPartyError] = useState<string | null>(null);
  const pendingThirdPartyCount = thirdPartyAccess.filter(
    (access) => access.status === 'not-granted',
  ).length;

  const readCurrentPage = async () => {
    setStatus('loading');
    setError(null);
    setThirdPartyAccess([]);
    setSelectedThirdParties([]);
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
      setStatus('success');

      try {
        setThirdPartyAccess(
          await summarizeThirdPartySiteAccess(capturedPage.resourceGraph, (request) =>
            browser.permissions.contains(request),
          ),
        );
      } catch (permissionError) {
        setThirdPartyError(`Unable to check third-party access. ${errorMessage(permissionError)}`);
      }
    } catch (requestError) {
      const captureError = toCaptureError(requestError, 'unexpected-error', {
        operation: 'page-info',
      });
      setPageInfo(null);
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
    } catch (permissionError) {
      setThirdPartyError(`Unable to grant third-party access. ${errorMessage(permissionError)}`);
    } finally {
      setThirdPartyGrantStatus('idle');
    }
  };

  const updateRenderWait = (value: number) => {
    if (!Number.isFinite(value)) {
      setRenderWaitMs(DEFAULT_RENDER_WAIT_MS);
      return;
    }

    setRenderWaitMs(Math.min(MAX_RENDER_WAIT_MS, Math.max(0, Math.round(value))));
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">{EXTENSION_NAME}</p>
          <h1>Archive workspace</h1>
        </div>
        <span className="status-badge">Foundation</span>
      </header>

      <section className="runtime-section" aria-labelledby="runtime-title">
        <div className="section-heading">
          <h2 id="runtime-title">Runtime surfaces</h2>
          <span>v0.1.0</span>
        </div>
        <dl className="runtime-list">
          {runtimeSurfaces.map(([name, status]) => (
            <div className="runtime-row" key={name}>
              <dt>{name}</dt>
              <dd>{status}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="inspect-section" aria-labelledby="inspect-title">
        <div className="section-heading">
          <h2 id="inspect-title">Current page</h2>
          <button
            className="primary-action"
            type="button"
            onClick={readCurrentPage}
            disabled={status === 'loading'}
          >
            {status === 'loading' ? 'Reading...' : 'Read page'}
          </button>
        </div>

        <div className="capture-setting">
          <label htmlFor="render-wait">Render wait</label>
          <div className="duration-input">
            <input
              id="render-wait"
              type="number"
              min="0"
              max={MAX_RENDER_WAIT_MS}
              step="100"
              value={renderWaitMs}
              onChange={(event) => updateRenderWait(event.currentTarget.valueAsNumber)}
              disabled={status === 'loading'}
            />
            <span>ms</span>
          </div>
        </div>

        <div className="capture-setting access-setting">
          <span>Current site access</span>
          <span className="access-value">{summarizeSiteAccess(siteAccess)}</span>
        </div>

        {status === 'idle' && <p className="helper-text">Ready to inspect the active tab.</p>}
        {status === 'loading' && (
          <p className="helper-text">Waiting {renderWaitMs} ms before reading...</p>
        )}
        {status === 'error' && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {status === 'success' && pageInfo && (
          <>
            <dl className="page-info">
              <div>
                <dt>Title</dt>
                <dd>{pageInfo.title || 'Untitled page'}</dd>
              </div>
              <div>
                <dt>Tab URL</dt>
                <dd>{pageInfo.tabUrl}</dd>
              </div>
              <div>
                <dt>Base URL</dt>
                <dd>{pageInfo.baseUrl}</dd>
              </div>
              <div>
                <dt>Final URL</dt>
                <dd>{pageInfo.finalUrl}</dd>
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

            <section className="third-party-section" aria-labelledby="third-party-title">
              <div className="third-party-heading">
                <div>
                  <h3 id="third-party-title">Third-party access</h3>
                  <p>Optional network hosts discovered on this page.</p>
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
                            toggleThirdParty(access.permissionPattern, event.currentTarget.checked)
                          }
                        />
                        <span className="third-party-details">
                          <span className="third-party-pattern">{access.permissionPattern}</span>
                          <span>
                            {access.resourceCount.toLocaleString()} resources ·{' '}
                            {access.provenanceCount.toLocaleString()} discoveries ·{' '}
                            {access.discoverySources.join(', ')} · {access.resourceTypes.join(', ')}
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
          </>
        )}
      </section>
    </main>
  );
}
