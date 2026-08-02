import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { inflateRawSync } from 'node:zlib';
import { dirname, join, relative, resolve } from 'node:path';
import { buildAudit } from './audit-chrome-web-store.mjs';

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_EOCD_MIN_BYTES = 22;
const ZIP_MAX_COMMENT_BYTES = 0xffff;
const ZIP_UTF8_FLAG = 0x0800;
const forbiddenPackagePathPatterns = [
  /(?:^|\/)\.DS_Store$/i,
  /\.map$/i,
  /^(?:docs?|src|tests?|test-results|node_modules|playwright-report)\//i,
  /^(?:README(?:\.[^/]*)?|package\.json|pnpm-lock\.yaml|tsconfig\.json|wxt\.config\.[^/]+)$/i,
  /(?:^|\/)\.(?:git|wxt)(?:\/|$)/i,
];
const crcTable = createCrcTable();

function parseArguments(argumentsList) {
  const options = { verifyZip: null, reportPath: null, sourceDirectory: null, quiet: false };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--quiet') {
      options.quiet = true;
      continue;
    }
    if (!['--verify-zip', '--report', '--source-dir'].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argumentsList[index + 1];
    if (!value) throw new Error(`Missing value for ${argument}`);
    if (argument === '--verify-zip') options.verifyZip = resolve(value);
    if (argument === '--report') options.reportPath = resolve(value);
    if (argument === '--source-dir') options.sourceDirectory = resolve(value);
    index += 1;
  }
  return options;
}

function createCrcTable() {
  const table = new Uint32Array(256);
  for (let value = 0; value < table.length; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    table[value] = crc >>> 0;
  }
  return table;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function decodeZipName(bytes, flags) {
  if ((flags & ZIP_UTF8_FLAG) !== 0) return new TextDecoder().decode(bytes);
  if (bytes.some((byte) => byte > 0x7f)) {
    throw new Error('ZIP contains a non-ASCII path without the UTF-8 flag.');
  }
  return String.fromCharCode(...bytes);
}

function findEndOfCentralDirectory(view) {
  const minimum = Math.max(0, view.byteLength - ZIP_EOCD_MIN_BYTES - ZIP_MAX_COMMENT_BYTES);
  for (let offset = view.byteLength - ZIP_EOCD_MIN_BYTES; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) !== ZIP_EOCD_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + ZIP_EOCD_MIN_BYTES + commentLength === view.byteLength) return offset;
  }
  throw new Error('ZIP end-of-central-directory record is missing.');
}

function validatePackagePath(path) {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) {
    throw new Error(`ZIP path is unsafe: ${path || '<empty>'}`);
  }
  const segments = path.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`ZIP path escapes the package root: ${path}`);
  }
  if (forbiddenPackagePathPatterns.some((pattern) => pattern.test(path))) {
    throw new Error(`ZIP contains a forbidden development or source file: ${path}`);
  }
}

function extractZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0) {
    throw new Error('Multi-disk ZIP packages are not supported.');
  }
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (centralOffset + centralSize > eocd)
    throw new Error('ZIP central directory is out of bounds.');

  const entries = [];
  const paths = new Set();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== ZIP_CENTRAL_SIGNATURE) {
      throw new Error(`ZIP central entry ${index} has an invalid signature.`);
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const expectedCrc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.byteLength) throw new Error(`ZIP entry ${index} name is out of bounds.`);
    const path = decodeZipName(bytes.subarray(nameStart, nameEnd), flags);
    validatePackagePath(path);
    if (paths.has(path)) throw new Error(`ZIP contains a duplicate path: ${path}`);
    paths.add(path);
    if ((flags & 0x0001) !== 0) throw new Error(`ZIP entry is encrypted: ${path}`);
    if (method !== 0 && method !== 8) throw new Error(`ZIP entry uses unsupported method: ${path}`);
    if (view.getUint32(localOffset, true) !== ZIP_LOCAL_SIGNATURE) {
      throw new Error(`ZIP local header is invalid: ${path}`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.byteLength) throw new Error(`ZIP entry data is out of bounds: ${path}`);
    const compressed = bytes.subarray(dataStart, dataEnd);
    const contents = method === 0 ? compressed.slice() : new Uint8Array(inflateRawSync(compressed));
    if (contents.byteLength !== uncompressedSize) {
      throw new Error(`ZIP entry length does not match the central directory: ${path}`);
    }
    if (crc32(contents) !== expectedCrc) throw new Error(`ZIP CRC32 mismatch: ${path}`);
    entries.push({ path, bytes: contents, directory: path.endsWith('/') });
    offset = nameEnd + extraLength + commentLength;
  }
  if (offset !== centralOffset + centralSize)
    throw new Error('ZIP central directory size mismatch.');
  return entries;
}

async function collectFiles(rootDirectory, directory = rootDirectory) {
  const directoryEntries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of directoryEntries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(rootDirectory, absolutePath)));
    if (entry.isFile()) {
      files.push({
        path: relative(rootDirectory, absolutePath).replaceAll('\\', '/'),
        bytes: new Uint8Array(await readFile(absolutePath)),
      });
    }
  }
  return files;
}

function inspectManifest(manifestBytes) {
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  if (manifest.manifest_version !== 3) throw new Error('Release candidate must use Manifest V3.');
  if (manifest.name !== 'SiteCapsule') throw new Error('Release candidate name is unexpected.');
  if (manifest.host_permissions !== undefined) {
    throw new Error('Release candidate must not contain install-time host_permissions.');
  }
  const optionalHosts = manifest.optional_host_permissions ?? [];
  if (JSON.stringify(optionalHosts) !== JSON.stringify(['http://*/*', 'https://*/*'])) {
    throw new Error('Release candidate optional host permissions are unexpected.');
  }
  return {
    manifestVersion: manifest.manifest_version,
    name: manifest.name,
    version: manifest.version,
    permissions: manifest.permissions ?? [],
    optionalHostPermissions: optionalHosts,
    hostPermissions: [],
  };
}

async function verifyReleaseZip(zipPath, sourceDirectory = null) {
  const archiveBytes = new Uint8Array(await readFile(zipPath));
  const entries = extractZipEntries(archiveBytes);
  const files = entries.filter(({ directory }) => !directory);
  const manifestEntry = files.find(({ path }) => path === 'manifest.json');
  if (!manifestEntry) throw new Error('Release candidate is missing manifest.json.');
  const manifest = inspectManifest(manifestEntry.bytes);

  if (sourceDirectory) {
    const sourceFiles = await collectFiles(sourceDirectory);
    const sourceByPath = new Map(sourceFiles.map((file) => [file.path, file]));
    const zipByPath = new Map(files.map((file) => [file.path, file]));
    if (
      JSON.stringify([...sourceByPath.keys()].sort()) !==
      JSON.stringify([...zipByPath.keys()].sort())
    ) {
      throw new Error('ZIP file list does not exactly match the production build directory.');
    }
    for (const [path, source] of sourceByPath) {
      if (sha256(source.bytes) !== sha256(zipByPath.get(path).bytes)) {
        throw new Error(`ZIP file content differs from the production build: ${path}`);
      }
    }
  }

  return {
    bytes: archiveBytes.byteLength,
    sha256: sha256(archiveBytes),
    entryCount: entries.length,
    fileCount: files.length,
    manifest,
    files: files.map((file) => ({
      path: file.path,
      bytes: file.bytes.byteLength,
      sha256: sha256(file.bytes),
    })),
    checks: {
      centralDirectory: 'passed',
      decompression: 'passed',
      crc32: 'passed',
      safePaths: 'passed',
      forbiddenFiles: 'passed',
      sourceDirectoryMatch: sourceDirectory ? 'passed' : 'not-run',
      manifest: 'passed',
    },
  };
}

async function smokeLoadCandidate(zipPath) {
  const [{ chromium }, archiveBytes] = await Promise.all([
    import('@playwright/test'),
    readFile(zipPath),
  ]);
  const entries = extractZipEntries(new Uint8Array(archiveBytes));
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'sitecapsule-release-load-'));
  const extensionPath = join(temporaryRoot, 'extension');
  const profilePath = join(temporaryRoot, 'profile');
  let context;

  try {
    await mkdir(extensionPath);
    for (const entry of entries) {
      const outputPath = join(extensionPath, entry.path);
      if (entry.directory) {
        await mkdir(outputPath, { recursive: true });
      } else {
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, entry.bytes);
      }
    }

    context = await chromium.launchPersistentContext(profilePath, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent('serviceworker', { timeout: 15_000 });
    const extensionId = new URL(serviceWorker.url()).host;
    const panel = await context.newPage();
    const response = await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    if (!response?.ok()) throw new Error('Release candidate side panel did not load successfully.');
    await panel.getByText('SiteCapsule', { exact: true }).first().waitFor({ timeout: 15_000 });

    return {
      chromiumVersion: context.browser()?.version() ?? 'unknown',
      serviceWorker: 'passed',
      sidePanel: 'passed',
    };
  } finally {
    await context?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(' ')} failed (${signal ?? code}).`));
    });
  });
}

async function gitOutput(args) {
  let output = '';
  await new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (output += chunk));
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolvePromise() : reject(new Error('git failed.')),
    );
  });
  return output.trim();
}

async function createCandidate(options) {
  const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
  const buildEnvironment = { ...process.env };
  delete buildEnvironment.SITECAPSULE_E2E;
  delete buildEnvironment.SITECAPSULE_PUBLIC_ACCEPTANCE;
  await run('pnpm', ['exec', 'wxt', 'zip'], { env: buildEnvironment });

  const sourceZip = resolve(`.output/${packageJson.name}-${packageJson.version}-chrome.zip`);
  const sourceDirectory = resolve('.output/chrome-mv3');
  const commit = await gitOutput(['rev-parse', 'HEAD']);
  const shortCommit = commit.slice(0, 7);
  const artifactName = `${packageJson.name}-${packageJson.version}-engineering-candidate-${shortCommit}.zip`;
  const artifactPath = resolve('dist', artifactName);
  const verification = await verifyReleaseZip(sourceZip, sourceDirectory);
  const storeAudit = await buildAudit(sourceDirectory);
  if (storeAudit.result !== 'pass') throw new Error('Chrome Web Store package audit failed.');

  await mkdir(dirname(artifactPath), { recursive: true });
  await copyFile(sourceZip, artifactPath);
  const artifactStat = await stat(artifactPath);
  if (artifactStat.size !== verification.bytes) throw new Error('Copied candidate size changed.');
  const loadability = await smokeLoadCandidate(artifactPath);

  const report = {
    schemaVersion: 1,
    artifactStatus: 'engineering-candidate-blocked',
    publicReleaseApproved: false,
    blockingAssessment: 'docs/testing/mvp-metric-assessment-2026-08-02.md',
    generatedAt: new Date().toISOString(),
    sourceCommit: commit,
    artifact: {
      name: artifactName,
      localPath: relative(process.cwd(), artifactPath).replaceAll('\\', '/'),
      bytes: verification.bytes,
      sha256: verification.sha256,
      entryCount: verification.entryCount,
      fileCount: verification.fileCount,
    },
    manifest: verification.manifest,
    checks: {
      ...verification.checks,
      chromeWebStoreAudit: storeAudit.result,
      chromeWebStoreErrors: storeAudit.summary.errors,
      chromeWebStoreReviewItems: storeAudit.summary.reviewItems,
      sourceMapsPresent: verification.files.some(({ path }) => path.endsWith('.map')),
      loadability,
    },
    files: verification.files,
  };
  const reportPath = options.reportPath ?? resolve('docs/releases', `${artifactName}.json`);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (!options.quiet) {
    console.log(`Engineering candidate: ${artifactPath}`);
    console.log(`SHA-256: ${verification.sha256}`);
    console.log(`Record: ${reportPath}`);
    console.log('Public release approved: no (M10-T3 blockers remain)');
  }
  return report;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const reportPath =
    options.reportPath ??
    (options.verifyZip ? resolve('test-results/release-candidate-verification.json') : null);
  try {
    if (options.verifyZip) {
      const verification = await verifyReleaseZip(options.verifyZip, options.sourceDirectory);
      if (reportPath) {
        await mkdir(dirname(reportPath), { recursive: true });
        await writeFile(
          reportPath,
          `${JSON.stringify({ result: 'pass', ...verification }, null, 2)}\n`,
        );
      }
      if (!options.quiet)
        console.log(`Release ZIP verification: pass (${verification.fileCount} files)`);
    } else {
      await createCandidate({ ...options, reportPath });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (reportPath) {
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(
        reportPath,
        `${JSON.stringify({ result: 'fail', error: message }, null, 2)}\n`,
      );
    }
    console.error(`Release candidate failed: ${message}`);
    process.exitCode = 1;
  }
}

await main();
