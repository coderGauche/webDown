// @vitest-environment happy-dom

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  auditArchiveOfflineIntegritySync,
  createZipArchiveSync,
  type ZipArchiveEntry,
} from '@sitecapsule/archive';
import { beforeAll, describe, expect, it } from 'vitest';

const encoder = new TextEncoder();
const brokenFixturePath = resolve(
  process.cwd(),
  'tests/fixtures/archive-integrity-broken/index.html',
);

beforeAll(() => {
  const settings = (
    window as unknown as {
      happyDOM: {
        settings: {
          disableCSSFileLoading: boolean;
          disableIframePageLoading: boolean;
          disableJavaScriptFileLoading: boolean;
          handleDisabledFileLoadingAsSuccess: boolean;
        };
      };
    }
  ).happyDOM.settings;
  settings.disableCSSFileLoading = true;
  settings.disableIframePageLoading = true;
  settings.disableJavaScriptFileLoading = true;
  settings.handleDisabledFileLoadingAsSuccess = true;
});

function entry(path: string, contents: string): ZipArchiveEntry {
  return { path, bytes: encoder.encode(contents) };
}

function archive(entries: readonly ZipArchiveEntry[]): Uint8Array {
  return createZipArchiveSync(entries);
}

async function brokenArchive(): Promise<{ bytes: Uint8Array; htmlBytes: number }> {
  const source = await readFile(brokenFixturePath, 'utf8');
  const largeDom = Array.from(
    { length: 1_500 },
    (_, index) =>
      `<section data-fixture-row="${index}"><h2>Rendered row ${index}</h2><p>Final DOM content retained for archive integrity regression.</p></section>`,
  ).join('');
  const html = source.replace(
    '<main id="large-dom-placeholder"></main>',
    `<main>${largeDom}</main>`,
  );
  return {
    htmlBytes: encoder.encode(html).byteLength,
    bytes: archive([
      entry('index.html', html),
      entry('assets/origins/https/dns-fonts.cdn.test/default/fonts/main.woff2', 'fixture-font'),
    ]),
  };
}

function completeArchive(): Uint8Array {
  const stylesheetPath = 'assets/origins/https/dns-cdn.test/default/css/site.css';
  const heroPath = 'assets/origins/https/dns-cdn.test/default/images/hero.png';
  const backgroundPath = 'assets/origins/https/dns-cdn.test/default/images/background.png';
  return archive([
    entry(
      'index.html',
      `<!doctype html><html><head>
        <link rel="stylesheet" href="${stylesheetPath}">
        <style>.hero { background: url(${backgroundPath}); }</style>
      </head><body>
        <a href="https://page.example.test/about">About</a>
        <img src="${heroPath}" srcset="${heroPath} 1x" alt="Hero">
      </body></html>`,
    ),
    entry(stylesheetPath, '.card { background-image: url(../images/background.png); }'),
    entry(heroPath, 'fixture-hero'),
    entry(backgroundPath, 'fixture-background'),
  ]);
}

describe('downloaded ZIP offline integrity audit', () => {
  it('fails a large final-DOM shell with external, missing local, and extension references', async () => {
    const fixture = await brokenArchive();
    const report = auditArchiveOfflineIntegritySync({ archiveBytes: fixture.bytes });

    expect(fixture.htmlBytes).toBeGreaterThan(100_000);
    expect(report.status).toBe('fail');
    expect(report.entryCounts).toMatchObject({
      total: 2,
      documents: 1,
      assets: 1,
      stylesheets: 0,
      metadata: 0,
    });
    expect(report.referenceCounts).toEqual({
      'local-present': 1,
      'local-missing': 4,
      'external-network': 5,
      'extension-protocol': 1,
      embedded: 0,
      fragment: 0,
      'unsupported-protocol': 0,
      invalid: 0,
    });
    expect(report.uniqueExternalNetworkUrls).toBe(5);
    expect(report.navigationReferencesIgnored).toBe(2);
    expect(report.missingLocalReferences.map(({ targetPath }) => targetPath).sort()).toEqual(
      [
        'assets/origins/https/dns-images.cdn.test/default/images/missing-small.webp',
        'assets/origins/https/dns-images.cdn.test/default/images/missing-mask.svg',
        'assets/origins/https/dns-page.example.test/default/js/missing-local.js',
        'assets/origins/https/dns-images.cdn.test/default/images/missing-bg.webp',
      ].sort(),
    );
    expect(report.extensionProtocolReferences).toEqual([
      expect.objectContaining({
        channel: 'html-attribute',
        tagName: 'script',
        protocol: 'chrome-extension:',
      }),
    ]);
    expect(
      report.externalNetworkReferences.some(
        ({ originalValue }) => originalValue === 'https://page.example.test/about',
      ),
    ).toBe(false);
  });

  it('passes when every resource reference resolves inside the ZIP', () => {
    const report = auditArchiveOfflineIntegritySync({ archiveBytes: completeArchive() });

    expect(report.status).toBe('pass');
    expect(report.entryCounts).toMatchObject({
      total: 4,
      documents: 1,
      stylesheets: 1,
      assets: 3,
    });
    expect(report.referenceCounts).toEqual({
      'local-present': 5,
      'local-missing': 0,
      'external-network': 0,
      'extension-protocol': 0,
      embedded: 0,
      fragment: 0,
      'unsupported-protocol': 0,
      invalid: 0,
    });
    expect(report.navigationReferencesIgnored).toBe(1);
  });

  it('rejects root-relative paths even when a similarly named ZIP entry exists', () => {
    const report = auditArchiveOfflineIntegritySync({
      archiveBytes: archive([
        entry('index.html', '<img src="/assets/images/root.png"><a href="/about">About</a>'),
        entry('assets/images/root.png', 'image'),
      ]),
    });

    expect(report.status).toBe('fail');
    expect(report.missingLocalReferences).toEqual([
      expect.objectContaining({
        originalValue: '/assets/images/root.png',
        targetPath: 'assets/images/root.png',
      }),
    ]);
    expect(report.navigationReferencesIgnored).toBe(1);
  });

  it('reports blob and invalid CSS while allowing data, fragments, and about:blank', () => {
    const report = auditArchiveOfflineIntegritySync({
      archiveBytes: archive([
        entry(
          'index.html',
          `<!doctype html><style>.ok { background:url(data:image/png;base64,AAAA) } .bad { background:url(blob:https://page.example.test/id) }</style>
           <img src="data:image/png;base64,BBBB"><embed src="about:blank"><svg><use href="#icon"></use></svg>`,
        ),
        entry(
          'assets/origins/https/dns-page.example.test/default/css/broken.css',
          '.broken { background: url("") }',
        ),
      ]),
    });

    expect(report.status).toBe('fail');
    expect(report.referenceCounts.embedded).toBe(3);
    expect(report.referenceCounts.fragment).toBe(1);
    expect(report.referenceCounts['unsupported-protocol']).toBe(1);
    expect(report.referenceCounts.invalid).toBe(1);
    expect(report.unsupportedProtocolReferences[0]).toMatchObject({ protocol: 'blob:' });
    expect(report.invalidReferences[0]).toMatchObject({
      channel: 'stylesheet-css',
      originalValue: '',
    });
  });

  it('requires valid ZIP bytes and an archive entry point', () => {
    expect(() => auditArchiveOfflineIntegritySync(null as never)).toThrow('requires ZIP bytes');
    expect(() => auditArchiveOfflineIntegritySync({ archiveBytes: new Uint8Array([1]) })).toThrow(
      'Failed to decode ZIP archive',
    );
    expect(() =>
      auditArchiveOfflineIntegritySync({ archiveBytes: archive([entry('asset.txt', 'x')]) }),
    ).toThrow('requires index.html');
  });
});
