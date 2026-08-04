import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

const runnerPath = resolve(process.cwd(), 'scripts/build-release-candidate.mjs');
const temporaryDirectories: string[] = [];

function manifest() {
  return JSON.stringify({
    manifest_version: 3,
    name: 'SiteCapsule',
    version: '0.1.0',
    permissions: ['activeTab'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
  });
}

async function verifyFixture(files: Record<string, string>, mutate?: (bytes: Uint8Array) => void) {
  const directory = await mkdtemp(join(tmpdir(), 'sitecapsule-release-candidate-'));
  temporaryDirectories.push(directory);
  const sourceDirectory = join(directory, 'source');
  await mkdir(sourceDirectory);
  for (const [path, contents] of Object.entries(files)) {
    const absolutePath = join(sourceDirectory, path);
    await mkdir(resolve(absolutePath, '..'), { recursive: true });
    await writeFile(absolutePath, contents);
  }
  const archiveBytes = zipSync(
    Object.fromEntries(
      Object.entries(files).map(([path, contents]) => [path, new TextEncoder().encode(contents)]),
    ),
    { level: 0 },
  );
  mutate?.(archiveBytes);
  const zipPath = join(directory, 'candidate.zip');
  const reportPath = join(directory, 'report.json');
  await writeFile(zipPath, archiveBytes);
  const result = spawnSync(
    process.execPath,
    [
      runnerPath,
      '--verify-zip',
      zipPath,
      '--source-dir',
      sourceDirectory,
      '--report',
      reportPath,
      '--quiet',
    ],
    { encoding: 'utf8' },
  );
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as Record<string, unknown>;
  return { result, report };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('release candidate ZIP verification', () => {
  it('verifies Manifest V3, safe inventory, decompression, CRC, and build-directory equality', async () => {
    const { result, report } = await verifyFixture({
      'manifest.json': manifest(),
      'background.js': 'export const ready = true;',
      'icon-16.png': 'fixture-image',
    });

    expect(result.status).toBe(0);
    expect(report).toMatchObject({
      result: 'pass',
      fileCount: 3,
      checks: {
        centralDirectory: 'passed',
        decompression: 'passed',
        crc32: 'passed',
        safePaths: 'passed',
        forbiddenFiles: 'passed',
        sourceDirectoryMatch: 'passed',
        manifest: 'passed',
      },
      manifest: { manifestVersion: 3, hostPermissions: [] },
    });
    expect(report.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects source maps and install-time host permissions', async () => {
    const sourceMap = await verifyFixture({
      'manifest.json': manifest(),
      'background.js.map': '{}',
    });
    expect(sourceMap.result.status).toBe(1);
    expect(sourceMap.report.error).toContain('forbidden development or source file');

    const requiredHost = await verifyFixture({
      'manifest.json': JSON.stringify({
        ...JSON.parse(manifest()),
        host_permissions: ['https://*/*'],
      }),
    });
    expect(requiredHost.result.status).toBe(1);
    expect(requiredHost.report.error).toContain('install-time host_permissions');
  });

  it('rejects bytes changed after the ZIP CRC was written', async () => {
    const marker = new TextEncoder().encode('fixture-image');
    const { result, report } = await verifyFixture(
      { 'manifest.json': manifest(), 'icon-16.png': 'fixture-image' },
      (bytes) => {
        let markerOffset = -1;
        for (let index = 0; index <= bytes.length - marker.length; index += 1) {
          if (marker.every((byte, markerIndex) => bytes[index + markerIndex] === byte)) {
            markerOffset = index;
            break;
          }
        }
        if (markerOffset < 0) throw new Error('Fixture marker not found.');
        bytes[markerOffset] = bytes[markerOffset]! ^ 0xff;
      },
    );
    expect(result.status).toBe(1);
    expect(report.error).toContain('CRC32 mismatch');
  });

  it('records a loadable candidate that passed metrics but still awaits final approval', async () => {
    const report = JSON.parse(
      await readFile(
        resolve(
          process.cwd(),
          'docs/releases/sitecapsule-0.1.0-engineering-candidate-570ec01.zip.json',
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(report).toMatchObject({
      artifactStatus: 'engineering-candidate',
      publicReleaseApproved: false,
      blockingAssessment: null,
      metricAssessment: {
        id: 'm10-mvp-metrics-2026-08-04',
        decision: 'ready',
        blockingDeviationIds: [],
      },
      approvalPending: ['M10-T6', 'M10-T7'],
      artifact: {
        fileCount: 13,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      checks: {
        loadability: {
          chromiumVersion: expect.any(String),
          serviceWorker: 'passed',
          sidePanel: 'passed',
        },
      },
    });
  });
});
