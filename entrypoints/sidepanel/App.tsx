import { createPageInfoRequest } from '@sitecapsule/messaging/protocol';
import { isPageInfoResponse } from '@sitecapsule/messaging/validators';
import { EXTENSION_NAME } from '@sitecapsule/shared';
import { useState } from 'react';

const runtimeSurfaces = [
  ['Background', 'Ready'],
  ['Content', 'Runtime'],
  ['Offscreen', 'Standby'],
] as const;

type ReadStatus = 'idle' | 'loading' | 'success' | 'error';

type PageInfo = {
  title: string;
  url: string;
};

export function App() {
  const [status, setStatus] = useState<ReadStatus>('idle');
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readCurrentPage = async () => {
    setStatus('loading');
    setError(null);

    try {
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id === undefined) {
        throw new Error('当前标签页不可用。');
      }

      const response: unknown = await browser.runtime.sendMessage(
        createPageInfoRequest(activeTab.id),
      );
      if (!isPageInfoResponse(response)) {
        throw new Error('扩展未返回有效的页面信息。');
      }
      if (!response.payload.ok) {
        throw new Error(response.payload.error);
      }

      setPageInfo(response.payload.page);
      setStatus('success');
    } catch (requestError) {
      setPageInfo(null);
      setError(requestError instanceof Error ? requestError.message : '读取页面信息失败。');
      setStatus('error');
    }
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

        {status === 'idle' && <p className="helper-text">Ready to inspect the active tab.</p>}
        {status === 'loading' && <p className="helper-text">Requesting page details...</p>}
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
              <dt>URL</dt>
              <dd>{pageInfo.url}</dd>
            </div>
          </dl>
        )}
      </section>
    </main>
  );
}
