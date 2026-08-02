import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const productionManifestPath = resolve('.output/chrome-mv3/manifest.json');

function run(command, args, environment = process.env) {
  return new Promise((resolveExitCode) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: environment,
      shell: false,
      stdio: 'inherit',
    });
    child.on('error', () => resolveExitCode(127));
    child.on('close', (code) => resolveExitCode(code ?? 1));
  });
}

async function assertProductionManifestRestored() {
  const manifest = JSON.parse(await readFile(productionManifestPath, 'utf8'));
  if ('host_permissions' in manifest) {
    throw new Error('Public acceptance host permissions remain in the production manifest.');
  }
}

async function main() {
  const acceptanceEnvironment = {
    ...process.env,
    SITECAPSULE_PUBLIC_ACCEPTANCE: '1',
  };
  let result = await run('pnpm', ['build'], acceptanceEnvironment);
  if (result === 0) {
    result = await run(
      'pnpm',
      ['exec', 'playwright', 'test', 'tests/e2e/public-acceptance.spec.ts'],
      acceptanceEnvironment,
    );
  }

  const restoreResult = await run('pnpm', ['build']);
  if (restoreResult !== 0) process.exitCode = restoreResult;
  else {
    try {
      await assertProductionManifestRestored();
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  }
  if (result !== 0) process.exitCode = result;
}

await main();
