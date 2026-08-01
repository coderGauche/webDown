import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const scannerPath = resolve(process.cwd(), 'scripts/audit-chrome-web-store.mjs');
const temporaryDirectories: string[] = [];

async function createPackage(files: Record<string, string>) {
  const packageDirectory = await mkdtemp(join(tmpdir(), 'sitecapsule-store-audit-'));
  temporaryDirectories.push(packageDirectory);
  for (const [filePath, contents] of Object.entries(files)) {
    const absolutePath = join(packageDirectory, filePath);
    await mkdir(resolve(absolutePath, '..'), { recursive: true });
    await writeFile(absolutePath, contents, 'utf8');
  }
  const reportPath = join(packageDirectory, 'audit.json');
  const result = spawnSync(
    process.execPath,
    [scannerPath, '--package-dir', packageDirectory, '--report', reportPath, '--quiet'],
    { encoding: 'utf8' },
  );
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
    result: string;
    summary: { errors: number; reviewItems: number; filesScanned: number };
    findings: Array<{ severity: string; code: string; file: string }>;
  };
  return { result, report };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Chrome Web Store package audit', () => {
  it('passes a local-code MV3 package and records broad optional hosts for review', async () => {
    const { result, report } = await createPackage({
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'Fixture',
        version: '1.0.0',
        permissions: ['activeTab', 'scripting', 'storage'],
        optional_host_permissions: ['http://*/*', 'https://*/*'],
        background: { service_worker: 'background.js' },
      }),
      'background.js': "import './local.js';",
      'local.js': 'export const ready = true;',
      'panel.html': '<!doctype html><script src="panel.js"></script>',
      'panel.js': 'document.body.dataset.ready = "true";',
    });

    expect(result.status).toBe(0);
    expect(report).toMatchObject({ result: 'pass', summary: { errors: 0, reviewItems: 1 } });
    expect(report.findings.map(({ code }) => code)).toEqual([
      'default-extension-csp',
      'broad-optional-host-capability',
    ]);
  });

  it('fails unexpected privileges, remote scripts, unsafe CSP, and string execution', async () => {
    const { result, report } = await createPackage({
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'Unsafe fixture',
        version: '1.0.0',
        permissions: ['debugger'],
        host_permissions: ['<all_urls>'],
        externally_connectable: { matches: ['https://example.test/*'] },
        content_security_policy: {
          extension_pages: "script-src 'self' 'unsafe-eval' https://cdn.example; object-src 'self'",
        },
      }),
      'panel.html': '<script src="https://cdn.example/runtime.js"></script>',
      'runtime.js': [
        'eval("remote")',
        'new Function("return remote")',
        'setTimeout("remote()", 0)',
        'import("https://cdn.example/module.js")',
      ].join(';'),
    });

    expect(result.status).toBe(1);
    expect(report.result).toBe('fail');
    expect(report.summary.errors).toBeGreaterThanOrEqual(9);
    expect(report.findings.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'unexpected-required-permission',
        'required-host-permission',
        'externally-connectable',
        'unsafe-extension-csp',
        'remote-extension-csp-source',
        'remote-script-tag',
        'eval-call',
        'function-constructor',
        'string-timer',
        'remote-dynamic-import',
      ]),
    );
  });
});
