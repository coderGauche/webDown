import {
  DEFAULT_RENDER_WAIT_MS,
  MAX_RENDER_WAIT_MS,
  SiteCapsuleError,
  createCaptureError,
  toCaptureError,
} from '@sitecapsule/domain';
import { createPageInfoRequest, type PageInfo } from '@sitecapsule/messaging/protocol';
import { isPageInfoResponse } from '@sitecapsule/messaging/validators';
import { createPageAccessRequest } from '@sitecapsule/permissions';
import { EXTENSION_NAME } from '@sitecapsule/shared';
import { useState } from 'react';

const runtimeSurfaces = [
  ['Background', 'Ready'],
  ['Content', 'Runtime'],
  ['Offscreen', 'Standby'],
] as const;

type ReadStatus = 'idle' | 'loading' | 'success' | 'error';

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

export function App() {
  const [status, setStatus] = useState<ReadStatus>('idle');
  const [renderWaitMs, setRenderWaitMs] = useState(DEFAULT_RENDER_WAIT_MS);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readCurrentPage = async () => {
    setStatus('loading');
    setError(null);

    try {
      const accessGranted = await browser.permissions.request(createPageAccessRequest());
      if (!accessGranted) {
        throw new SiteCapsuleError(
          createCaptureError('permission-denied', { operation: 'page-info' }),
        );
      }

      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id === undefined) {
        throw new SiteCapsuleError(
          createCaptureError('page-unavailable', { operation: 'page-info' }),
        );
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

      setPageInfo(response.payload.page);
      setStatus('success');
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
          </dl>
        )}
      </section>
    </main>
  );
}
