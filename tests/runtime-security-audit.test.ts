import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { CaptureSettings } from '@sitecapsule/domain';
import {
  BACKGROUND_RUNTIME_REQUEST_TYPES,
  CONTENT_RUNTIME_REQUEST_TYPES,
  isBackgroundRuntimeRequest,
  isContentRuntimeRequest,
  isTrustedBackgroundSender,
  isTrustedSidePanelSender,
} from '@sitecapsule/messaging/runtime-policy';
import {
  MESSAGE_PROTOCOL_VERSION,
  MESSAGE_TYPES,
  createCaptureArchiveChunkGetRequest,
  createCaptureJobControlRequest,
  createCaptureJobCreateRequest,
  createCaptureJobDeleteRequest,
  createCaptureJobGetRequest,
  createCaptureJobHistoryClearRequest,
  createCaptureJobHistoryListRequest,
  createCaptureJobResultGetRequest,
  createPageArchiveRewriteRequest,
  createPageInfoCollectRequest,
  createPageInfoRequest,
} from '@sitecapsule/messaging/protocol';
import {
  checkResourceResponseNetworkPolicy,
  inspectResourceNetworkTarget,
  type ResourceResponseMetadata,
} from '@sitecapsule/download';
import { afterAll, describe, expect, it } from 'vitest';

const runtimeId = 'abcdefghijklmnopabcdefghijklmnop';
const auditPath = resolve(process.cwd(), 'test-results/vitest/runtime-security-audit.json');
const audit: Record<string, unknown> = {};

const settings: CaptureSettings = {
  archiveFileName: 'security-audit.zip',
  renderWaitMs: 0,
  maxConcurrentRequests: 4,
  includeMedia: false,
  includeScripts: true,
  includeThirdPartyResources: false,
  autoScroll: false,
  maxDepth: 0,
  maxPages: 1,
  allowedUrlPatterns: [],
  blockedUrlPatterns: [],
  maxFileSizeBytes: null,
  maxTotalSizeBytes: null,
};

const backgroundRequests = [
  createPageInfoRequest(1, 0, 'page-info'),
  createCaptureJobCreateRequest(
    {
      tabId: 1,
      startUrl: 'https://public.example/page',
      mode: 'current-page',
      profile: 'standard',
      settings,
    },
    'job-create',
  ),
  createCaptureJobControlRequest('job-1', 'pause', 'job-control'),
  createCaptureJobGetRequest('job-1', 'job-get'),
  createCaptureJobHistoryListRequest(20, 'history-list'),
  createCaptureJobDeleteRequest('job-1', 'job-delete'),
  createCaptureJobHistoryClearRequest('history-clear'),
  createCaptureJobResultGetRequest('job-1', 'result-get'),
  createCaptureArchiveChunkGetRequest('job-1', 0, 'chunk-get'),
];

const contentRequests = [
  createPageInfoCollectRequest('https://public.example/page', 0, 'page-collect'),
  createPageArchiveRewriteRequest(
    {
      html: '<!doctype html><title>Audit</title>',
      documentUrl: 'https://public.example/page',
      baseUrl: 'https://public.example/',
      savedResourceMappings: [],
      enableOfflineRuntime: true,
    },
    'page-rewrite',
  ),
];

afterAll(async () => {
  await mkdir(dirname(auditPath), { recursive: true });
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
});

describe('M9 runtime message and URL security audit', () => {
  it('assigns every request to exactly one trusted runtime context', () => {
    const allRequestTypes = [...BACKGROUND_RUNTIME_REQUEST_TYPES, ...CONTENT_RUNTIME_REQUEST_TYPES];
    expect(new Set(allRequestTypes).size).toBe(allRequestTypes.length);
    expect(backgroundRequests.map((message) => message.type)).toEqual([
      ...BACKGROUND_RUNTIME_REQUEST_TYPES,
    ]);
    expect(contentRequests.map((message) => message.type)).toEqual([
      ...CONTENT_RUNTIME_REQUEST_TYPES,
    ]);

    for (const message of backgroundRequests) {
      expect(isBackgroundRuntimeRequest(message)).toBe(true);
      expect(isContentRuntimeRequest(message)).toBe(false);
    }
    for (const message of contentRequests) {
      expect(isContentRuntimeRequest(message)).toBe(true);
      expect(isBackgroundRuntimeRequest(message)).toBe(false);
    }
    for (const type of Object.values(MESSAGE_TYPES).filter(
      (type) => !allRequestTypes.includes(type as (typeof allRequestTypes)[number]),
    )) {
      const nonRequest = {
        protocolVersion: MESSAGE_PROTOCOL_VERSION,
        correlationId: 'not-a-request',
        type,
        payload: {},
      };
      expect(isBackgroundRuntimeRequest(nonRequest)).toBe(false);
      expect(isContentRuntimeRequest(nonRequest)).toBe(false);
    }

    const malformed = {
      ...backgroundRequests[0],
      protocolVersion: MESSAGE_PROTOCOL_VERSION - 1,
    };
    expect(isBackgroundRuntimeRequest(malformed)).toBe(false);
    expect(isBackgroundRuntimeRequest({ ...backgroundRequests[0], unexpected: true })).toBe(false);

    audit.messageRouting = {
      protocolVersion: MESSAGE_PROTOCOL_VERSION,
      backgroundRequestTypes: BACKGROUND_RUNTIME_REQUEST_TYPES,
      contentRequestTypes: CONTENT_RUNTIME_REQUEST_TYPES,
      requestTypeCount: allRequestTypes.length,
      disjoint: true,
      rejectsNonRequests: true,
      rejectsWrongVersion: true,
      rejectsExtraEnvelopeFields: true,
    };
  });

  it('rejects external, content-tab, alternate-path, query, hash, and malformed senders', () => {
    const trustedSidePanel = {
      id: runtimeId,
      url: `chrome-extension://${runtimeId}/sidepanel.html`,
    };
    const trustedBackground = {
      id: runtimeId,
      url: `chrome-extension://${runtimeId}/background.js`,
    };
    expect(isTrustedSidePanelSender(trustedSidePanel, runtimeId)).toBe(true);
    expect(isTrustedSidePanelSender({ ...trustedSidePanel, tab: { id: 7 } }, runtimeId)).toBe(true);
    expect(isTrustedBackgroundSender(trustedBackground, runtimeId)).toBe(true);
    expect(isTrustedBackgroundSender({ id: runtimeId }, runtimeId)).toBe(true);

    const rejected = [
      {},
      { id: 'external-extension', url: trustedSidePanel.url },
      { id: runtimeId, url: 'https://public.example/sidepanel.html' },
      { id: runtimeId, url: `chrome-extension://${runtimeId}/offscreen.html` },
      { id: runtimeId, url: `${trustedSidePanel.url}?command=delete` },
      { id: runtimeId, url: `${trustedSidePanel.url}#command` },
      { id: runtimeId, url: 'https://public.example/page', tab: { id: 7 } },
      { id: runtimeId, url: 'not a url' },
    ];
    for (const sender of rejected) {
      expect(isTrustedSidePanelSender(sender, runtimeId)).toBe(false);
    }
    expect(isTrustedBackgroundSender(trustedSidePanel, runtimeId)).toBe(false);
    expect(isTrustedSidePanelSender(trustedBackground, runtimeId)).toBe(false);

    audit.senderPolicy = {
      trustedSources: ['sidepanel.html -> background', 'background.js -> content'],
      rejectedSenderCases: rejected.length + 2,
      requiresOwnExtensionId: true,
      rejectsContentTabSendersByNonExtensionUrl: true,
      allowsExtensionPagesHostedInTabs: true,
      requiresExactPathWithoutQueryOrHash: true,
      allowsUrlOmittedByServiceWorkerSender: true,
    };
  });

  it('blocks malicious initial and redirect URLs before body consumption', async () => {
    const initialCases = [
      ['javascript:alert(1)', 'unsupported-protocol', null],
      ['data:text/plain,secret', 'unsupported-protocol', null],
      ['blob:https://public.example/id', 'unsupported-protocol', null],
      ['file:///etc/passwd', 'unsupported-protocol', null],
      ['https://user:pass@public.example/private', 'embedded-credentials', null],
      ['http://127.0.0.1/admin', 'local-network', 'loopback'],
      ['http://[::1]/admin', 'local-network', 'loopback'],
      ['http://[::ffff:127.0.0.1]/admin', 'local-network', 'loopback'],
      ['http://192.168.1.20/admin', 'local-network', 'private'],
      ['https://service.internal/admin', 'local-network', 'local-hostname'],
      ['https://printer/admin', 'local-network', 'single-label-hostname'],
    ] as const;
    for (const [url, reason, localNetworkKind] of initialCases) {
      expect(inspectResourceNetworkTarget(url)).toMatchObject({
        status: 'blocked',
        reason,
        localNetworkKind,
      });
    }

    const permissionChecks: string[][] = [];
    const contains = async ({ origins }: { origins: string[] }) => {
      permissionChecks.push(origins);
      return origins[0] === 'https://public.example/*';
    };
    const metadata: ResourceResponseMetadata = {
      originalUrl: 'https://public.example/start',
      finalUrl: 'http://127.0.0.1/admin',
      redirected: true,
      redirectTrace: {
        complete: false,
        hops: [
          {
            fromUrl: 'https://public.example/start',
            toUrl: 'http://127.0.0.1/admin',
          },
        ],
      },
      httpStatus: 200,
      ok: true,
      mimeType: 'text/plain',
    };
    await expect(checkResourceResponseNetworkPolicy(metadata, contains)).resolves.toMatchObject({
      status: 'blocked',
      stage: 'final',
      target: { reason: 'local-network', localNetworkKind: 'loopback' },
    });
    expect(permissionChecks).toEqual([['https://public.example/*']]);

    audit.urlPolicy = {
      initialCases: initialCases.map(([url, reason, localNetworkKind]) => ({
        url,
        reason,
        localNetworkKind,
      })),
      redirectCase: {
        originalUrl: metadata.originalUrl,
        finalUrl: metadata.finalUrl,
        blockedStage: 'final',
        reason: 'local-network',
        localNetworkKind: 'loopback',
      },
      permissionChecks,
      bodyConsumptionReached: false,
    };
  });
});
