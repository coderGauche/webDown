import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultPackageDirectory = resolve(process.cwd(), '.output/chrome-mv3');
const defaultReportPath = resolve(process.cwd(), 'test-results/audits/chrome-web-store-risk.json');
const allowedPermissions = new Set([
  'activeTab',
  'downloads',
  'offscreen',
  'scripting',
  'sidePanel',
  'storage',
]);
const allowedOptionalHostPermissions = new Set(['http://*/*', 'https://*/*']);
const textExtensions = new Set(['.css', '.htm', '.html', '.js', '.json', '.mjs']);
const policyReferences = [
  'https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements',
  'https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code',
  'https://developer.chrome.com/docs/webstore/program-policies/user-data-faq#minimum_permission',
  'https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy',
];

function parseArguments(argumentsList) {
  const options = {
    packageDirectory: defaultPackageDirectory,
    reportPath: defaultReportPath,
    quiet: false,
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--quiet') {
      options.quiet = true;
      continue;
    }
    if (argument !== '--package-dir' && argument !== '--report') {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argumentsList[index + 1];
    if (!value) throw new Error(`Missing value for ${argument}`);
    if (argument === '--package-dir') options.packageDirectory = resolve(value);
    if (argument === '--report') options.reportPath = resolve(value);
    index += 1;
  }
  return options;
}

function extensionOf(filePath) {
  const dotIndex = filePath.lastIndexOf('.');
  return dotIndex >= 0 ? filePath.slice(dotIndex).toLowerCase() : '';
}

async function collectPackageFiles(rootDirectory, directory = rootDirectory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = resolve(directory, entry.name);
    const packagePath = relative(rootDirectory, absolutePath).replaceAll('\\', '/');
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) {
      files.push({ absolutePath, packagePath, symbolicLink: true, size: metadata.size });
    } else if (entry.isDirectory()) {
      files.push(...(await collectPackageFiles(rootDirectory, absolutePath)));
    } else if (entry.isFile()) {
      files.push({ absolutePath, packagePath, symbolicLink: false, size: metadata.size });
    }
  }
  return files;
}

function createFinding(severity, code, file, message) {
  return { severity, code, file, message };
}

function inspectManifest(manifest, findings) {
  if (manifest.manifest_version !== 3) {
    findings.push(
      createFinding('error', 'manifest-version', 'manifest.json', 'Manifest V3 is required.'),
    );
  }

  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  for (const permission of permissions) {
    if (!allowedPermissions.has(permission)) {
      findings.push(
        createFinding(
          'error',
          'unexpected-required-permission',
          'manifest.json',
          `Required permission is outside the reviewed allowlist: ${permission}`,
        ),
      );
    }
  }

  const optionalPermissions = Array.isArray(manifest.optional_permissions)
    ? manifest.optional_permissions
    : [];
  for (const permission of optionalPermissions) {
    findings.push(
      createFinding(
        'error',
        'unexpected-optional-permission',
        'manifest.json',
        `Optional API permission requires review: ${permission}`,
      ),
    );
  }

  const requiredHosts = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
  for (const pattern of requiredHosts) {
    findings.push(
      createFinding(
        'error',
        'required-host-permission',
        'manifest.json',
        `Production builds must request hosts at runtime, not installation: ${pattern}`,
      ),
    );
  }

  const optionalHosts = Array.isArray(manifest.optional_host_permissions)
    ? manifest.optional_host_permissions
    : [];
  for (const pattern of optionalHosts) {
    if (!allowedOptionalHostPermissions.has(pattern)) {
      findings.push(
        createFinding(
          'error',
          'unexpected-optional-host',
          'manifest.json',
          `Optional host pattern is outside the reviewed allowlist: ${pattern}`,
        ),
      );
    }
  }
  if (optionalHosts.some((pattern) => allowedOptionalHostPermissions.has(pattern))) {
    findings.push(
      createFinding(
        'review',
        'broad-optional-host-capability',
        'manifest.json',
        'Store disclosure must explain that broad optional capability is requested as exact hosts only after user action.',
      ),
    );
  }

  if (manifest.externally_connectable !== undefined) {
    findings.push(
      createFinding(
        'error',
        'externally-connectable',
        'manifest.json',
        'Unexpected externally_connectable entry expands the message attack surface.',
      ),
    );
  }
  if (manifest.sandbox !== undefined) {
    findings.push(
      createFinding(
        'review',
        'sandboxed-pages',
        'manifest.json',
        'Sandboxed pages require manual review for remote logic and data exchange.',
      ),
    );
  }

  const csp = manifest.content_security_policy;
  if (csp === undefined) {
    findings.push(
      createFinding(
        'info',
        'default-extension-csp',
        'manifest.json',
        "Chrome's Manifest V3 default CSP restricts extension scripts and objects to 'self'.",
      ),
    );
  } else {
    const extensionPolicy = typeof csp === 'string' ? csp : csp?.extension_pages;
    if (typeof extensionPolicy !== 'string') {
      findings.push(
        createFinding(
          'error',
          'invalid-extension-csp',
          'manifest.json',
          'Extension CSP is malformed.',
        ),
      );
    } else {
      if (/['"]unsafe-(?:eval|inline)['"]/i.test(extensionPolicy)) {
        findings.push(
          createFinding(
            'error',
            'unsafe-extension-csp',
            'manifest.json',
            'Extension CSP permits unsafe inline or string evaluation.',
          ),
        );
      }
      if (/\b(?:https?:|wss?:|\*)/i.test(extensionPolicy)) {
        findings.push(
          createFinding(
            'error',
            'remote-extension-csp-source',
            'manifest.json',
            'Extension CSP contains a remote or wildcard source.',
          ),
        );
      }
    }
  }
}

function inspectTextFile(packagePath, contents, findings) {
  const isHtml = /\.html?$/i.test(packagePath);
  const isJavaScript = /\.(?:m?js)$/i.test(packagePath);
  if (isHtml) {
    if (/<script\b[^>]*\bsrc\s*=\s*['"]\s*(?:https?:)?\/\//i.test(contents)) {
      findings.push(
        createFinding('error', 'remote-script-tag', packagePath, 'HTML loads a remote script.'),
      );
    }
    const executableInlineScript =
      /<script\b(?![^>]*\btype\s*=\s*['"](?:application\/(?:ld\+)?json)['"])[^>]*>\s*[^<\s]/i;
    if (executableInlineScript.test(contents)) {
      findings.push(
        createFinding(
          'error',
          'inline-script',
          packagePath,
          'HTML contains executable inline script.',
        ),
      );
    }
    if (/<iframe\b[^>]*\bsrc\s*=\s*['"]\s*(?:https?:)?\/\//i.test(contents)) {
      findings.push(
        createFinding(
          'review',
          'remote-frame',
          packagePath,
          'HTML embeds a remote frame that requires data-use and behavior review.',
        ),
      );
    }
  }
  if (!isJavaScript) return;

  const executablePatterns = [
    ['eval-call', /(?:^|[^\w$.])eval\s*\(/m, 'JavaScript calls eval().'],
    ['function-constructor', /\bnew\s+Function\s*\(/m, 'JavaScript uses the Function constructor.'],
    [
      'string-timer',
      /\bset(?:Timeout|Interval)\s*\(\s*['"`]/m,
      'JavaScript passes a string to a timer.',
    ],
    [
      'remote-import-scripts',
      /\bimportScripts\s*\(\s*['"`]\s*(?:https?:)?\/\//m,
      'JavaScript imports a remote worker script.',
    ],
    [
      'remote-dynamic-import',
      /\bimport\s*\(\s*['"`]\s*(?:https?:)?\/\//m,
      'JavaScript dynamically imports a remote module.',
    ],
  ];
  for (const [code, pattern, message] of executablePatterns) {
    if (pattern.test(contents)) findings.push(createFinding('error', code, packagePath, message));
  }
  if (
    /\bWebAssembly\.(?:compile|instantiate|compileStreaming|instantiateStreaming)\s*\(/m.test(
      contents,
    )
  ) {
    findings.push(
      createFinding(
        'review',
        'webassembly-execution',
        packagePath,
        'WebAssembly execution requires proof that all executable bytes are packaged locally.',
      ),
    );
  }
  if (/\bcreateElement\s*\(\s*['"`]script['"`]\s*\)/m.test(contents)) {
    findings.push(
      createFinding(
        'review',
        'dynamic-script-element',
        packagePath,
        'Dynamic script creation requires proof that its source is packaged locally.',
      ),
    );
  }
}

async function buildAudit(packageDirectory) {
  const files = await collectPackageFiles(packageDirectory);
  const findings = [];
  for (const file of files) {
    if (file.symbolicLink) {
      findings.push(
        createFinding(
          'error',
          'package-symlink',
          file.packagePath,
          'Package contains a symbolic link.',
        ),
      );
    }
  }

  const manifestFile = files.find((file) => file.packagePath === 'manifest.json');
  let manifest = null;
  if (!manifestFile) {
    findings.push(
      createFinding('error', 'missing-manifest', 'manifest.json', 'Manifest is missing.'),
    );
  } else {
    try {
      manifest = JSON.parse(await readFile(manifestFile.absolutePath, 'utf8'));
      inspectManifest(manifest, findings);
    } catch {
      findings.push(
        createFinding(
          'error',
          'invalid-manifest-json',
          'manifest.json',
          'Manifest is not valid JSON.',
        ),
      );
    }
  }

  const fileInventory = [];
  for (const file of files) {
    if (file.symbolicLink) continue;
    const bytes = await readFile(file.absolutePath);
    fileInventory.push({
      path: file.packagePath,
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    if (textExtensions.has(extensionOf(file.packagePath))) {
      inspectTextFile(file.packagePath, bytes.toString('utf8'), findings);
    }
    if (/\.wasm$/i.test(file.packagePath)) {
      findings.push(
        createFinding(
          'review',
          'packaged-webassembly',
          file.packagePath,
          'Packaged WebAssembly requires reviewer-facing justification and local-code verification.',
        ),
      );
    }
  }

  const orderedFindings = findings.sort(
    (left, right) =>
      left.severity.localeCompare(right.severity) ||
      left.code.localeCompare(right.code) ||
      left.file.localeCompare(right.file),
  );
  const count = (severity) => orderedFindings.filter((item) => item.severity === severity).length;
  return {
    schemaVersion: 1,
    result: count('error') === 0 ? 'pass' : 'fail',
    packageDirectory,
    policyReferences,
    summary: {
      filesScanned: fileInventory.length,
      bytesScanned: fileInventory.reduce((total, file) => total + file.byteLength, 0),
      errors: count('error'),
      reviewItems: count('review'),
      informationalItems: count('info'),
    },
    manifest: manifest
      ? {
          manifestVersion: manifest.manifest_version ?? null,
          permissions: Array.isArray(manifest.permissions) ? manifest.permissions : [],
          hostPermissions: Array.isArray(manifest.host_permissions)
            ? manifest.host_permissions
            : [],
          optionalHostPermissions: Array.isArray(manifest.optional_host_permissions)
            ? manifest.optional_host_permissions
            : [],
          usesDefaultExtensionCsp: manifest.content_security_policy === undefined,
          externallyConnectable: manifest.externally_connectable !== undefined,
          sandboxedPages: manifest.sandbox !== undefined,
        }
      : null,
    findings: orderedFindings,
    files: fileInventory,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  let audit;
  try {
    audit = await buildAudit(options.packageDirectory);
  } catch (error) {
    audit = {
      schemaVersion: 1,
      result: 'fail',
      packageDirectory: options.packageDirectory,
      policyReferences,
      summary: {
        filesScanned: 0,
        bytesScanned: 0,
        errors: 1,
        reviewItems: 0,
        informationalItems: 0,
      },
      manifest: null,
      findings: [
        createFinding(
          'error',
          'package-read-failed',
          '.',
          error instanceof Error ? error.message : 'Extension package could not be read.',
        ),
      ],
      files: [],
    };
  }
  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  if (!options.quiet) {
    console.log(
      `Chrome Web Store audit: ${audit.result} (${audit.summary.errors} errors, ${audit.summary.reviewItems} review items, ${audit.summary.filesScanned} files)`,
    );
    console.log(`Report: ${options.reportPath}`);
  }
  if (audit.result !== 'pass') process.exitCode = 1;
}

const isDirectExecution = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (isDirectExecution) await main();

export { buildAudit };
