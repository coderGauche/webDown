import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const defaultOutputDirectory = resolve(process.cwd(), 'test-results/regression');

function parseArguments(argumentsList) {
  const options = { outputDirectory: defaultOutputDirectory, fixturePlan: null };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument !== '--output-dir' && argument !== '--fixture-plan') {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argumentsList[index + 1];
    if (!value) throw new Error(`Missing value for ${argument}`);
    if (argument === '--output-dir') options.outputDirectory = resolve(value);
    if (argument === '--fixture-plan') {
      if (value !== 'pass' && value !== 'fail') {
        throw new Error(`Unsupported fixture plan: ${value}`);
      }
      options.fixturePlan = value;
    }
    index += 1;
  }
  return options;
}

function commandDisplay(command, args) {
  return [command, ...args].join(' ');
}

function defaultPlan() {
  return [
    { id: 'format-check', label: 'Prettier format check', command: 'pnpm', args: ['format:check'] },
    { id: 'lint', label: 'ESLint', command: 'pnpm', args: ['lint'] },
    { id: 'typecheck', label: 'TypeScript type check', command: 'pnpm', args: ['typecheck'] },
    {
      id: 'unit-tests',
      label: 'Vitest unit and integration tests',
      command: 'pnpm',
      args: ['test'],
    },
    { id: 'production-build', label: 'Production MV3 build', command: 'pnpm', args: ['build'] },
    {
      id: 'store-audit',
      label: 'Chrome Web Store risk audit',
      command: 'pnpm',
      args: ['audit:store'],
    },
    { id: 'extension-e2e', label: 'Playwright extension E2E', command: 'pnpm', args: ['test:e2e'] },
  ];
}

function fixturePlan(outcome) {
  const success = { command: process.execPath, args: ['-e', 'process.exit(0)'] };
  const failure = { command: process.execPath, args: ['-e', 'process.exit(7)'] };
  return [
    { id: 'fixture-first', label: 'Fixture first step', ...success },
    {
      id: 'fixture-result',
      label: 'Fixture controlled result',
      ...(outcome === 'pass' ? success : failure),
    },
    { id: 'fixture-last', label: 'Fixture last step', ...success },
  ];
}

function cleanupPlan() {
  return [
    {
      id: 'restore-production-build',
      label: 'Restore production MV3 build',
      command: 'pnpm',
      args: ['build'],
      phase: 'cleanup',
    },
    {
      id: 'verify-restored-package',
      label: 'Audit restored production package',
      command: 'pnpm',
      args: ['audit:store'],
      phase: 'cleanup',
    },
  ];
}

function gitValue(args) {
  const result = spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function createRunId(now = new Date()) {
  return now.toISOString().replaceAll(':', '').replaceAll('.', '-');
}

function createMarkdownReport(report) {
  const stepRows = report.steps.map(
    (step) =>
      `| ${step.label} | ${step.phase} | ${step.status} | ${step.exitCode ?? '-'} | ${step.durationMs ?? '-'} | \`${step.logPath ?? '-'}\` |`,
  );
  return `# SiteCapsule Regression Report

## Run Summary

| Field | Value |
| --- | --- |
| Run ID | \`${report.runId}\` |
| Result | **${report.result.toUpperCase()}** |
| Started | ${report.startedAt} |
| Finished | ${report.finishedAt ?? 'In progress'} |
| Git commit | \`${report.git.commit ?? 'unavailable'}\` |
| Worktree dirty at start | ${report.git.dirty ? 'yes' : 'no'} |
| Failed step | ${report.failedStep ?? 'none'} |

## Automated Checks

| Check | Phase | Status | Exit | Duration ms | Log |
| --- | --- | --- | ---: | ---: | --- |
${stepRows.join('\n')}

## Generated Evidence

- Machine report: \`${report.machineReportPath}\`
- Chrome Web Store audit: \`test-results/audits/chrome-web-store-risk.json\`
- Playwright artifacts: \`test-results/playwright/\`
- Vitest security audit: \`test-results/vitest/runtime-security-audit.json\`
- Large-task audit: \`test-results/vitest/large-task-limit-audit.json\`

## Manual Release Review

- Reviewer: ____________________
- Review date: ____________________
- Target version/commit: ____________________
- [ ] Chrome Web Store review items have written explanations.
- [ ] Privacy disclosure matches local webpage-content processing.
- [ ] A clean Chrome profile can load the production package.
- [ ] Known limitations and deviations are recorded.
- Notes: ____________________
`;
}

async function writeReports(report, outputDirectory, runDirectory) {
  const machineContents = `${JSON.stringify(report, null, 2)}\n`;
  const markdownContents = createMarkdownReport(report);
  await Promise.all([
    writeFile(join(runDirectory, 'report.json'), machineContents, 'utf8'),
    writeFile(join(runDirectory, 'report.md'), markdownContents, 'utf8'),
    writeFile(join(outputDirectory, 'latest.json'), machineContents, 'utf8'),
    writeFile(join(outputDirectory, 'latest.md'), markdownContents, 'utf8'),
  ]);
}

async function runStep(step, index, runDirectory, runId) {
  const logName = `${String(index + 1).padStart(2, '0')}-${step.id}.log`;
  const logAbsolutePath = join(runDirectory, logName);
  const logPath = relative(process.cwd(), logAbsolutePath).replaceAll('\\', '/');
  const log = createWriteStream(logAbsolutePath, { flags: 'w' });
  const started = performance.now();
  let outputTail = '';
  const childEnvironment = { ...process.env, NO_COLOR: '1' };
  delete childEnvironment.FORCE_COLOR;

  const exitCode = await new Promise((resolveExitCode) => {
    const child = spawn(step.command, step.args, {
      cwd: process.cwd(),
      env: childEnvironment,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const record = (chunk) => {
      log.write(chunk);
      outputTail = `${outputTail}${chunk.toString('utf8')}`.slice(-16_000);
    };
    child.stdout.on('data', record);
    child.stderr.on('data', record);
    child.on('error', (error) => {
      record(Buffer.from(`\nRunner failed to start command: ${error.message}\n`));
      resolveExitCode(127);
    });
    child.on('close', (code) => resolveExitCode(code ?? 1));
  });
  await new Promise((resolveClose) => log.end(resolveClose));
  const durationMs = Math.round(performance.now() - started);
  const status = exitCode === 0 ? 'passed' : 'failed';
  console.log(`${status === 'passed' ? 'PASS' : 'FAIL'} ${step.label} (${durationMs} ms)`);
  if (status === 'failed') console.error(outputTail);
  return {
    id: step.id,
    label: step.label,
    phase: step.phase ?? 'verification',
    command: commandDisplay(step.command, step.args),
    status,
    exitCode,
    durationMs,
    logPath,
    runId,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const runId = createRunId();
  const runDirectory = join(options.outputDirectory, runId);
  await mkdir(runDirectory, { recursive: true });
  const plan = options.fixturePlan ? fixturePlan(options.fixturePlan) : defaultPlan();
  const report = {
    schemaVersion: 1,
    runId,
    result: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    failedStep: null,
    git: {
      commit: gitValue(['rev-parse', '--short', 'HEAD']),
      branch: gitValue(['branch', '--show-current']),
      dirty: (gitValue(['status', '--porcelain']) ?? '') !== '',
    },
    environment: { node: process.version, platform: process.platform, architecture: process.arch },
    machineReportPath: relative(process.cwd(), join(runDirectory, 'report.json')).replaceAll(
      '\\',
      '/',
    ),
    steps: [],
  };
  await writeReports(report, options.outputDirectory, runDirectory);

  let e2eStarted = false;
  for (let index = 0; index < plan.length; index += 1) {
    const step = plan[index];
    if (step.id === 'extension-e2e') e2eStarted = true;
    const result = await runStep(step, report.steps.length, runDirectory, runId);
    report.steps.push(result);
    if (result.status === 'failed') {
      report.failedStep = result.id;
      for (const skipped of plan.slice(index + 1)) {
        report.steps.push({
          id: skipped.id,
          label: skipped.label,
          phase: skipped.phase ?? 'verification',
          command: commandDisplay(skipped.command, skipped.args),
          status: 'skipped',
          exitCode: null,
          durationMs: null,
          logPath: null,
          runId,
        });
      }
      break;
    }
    await writeReports(report, options.outputDirectory, runDirectory);
  }

  if (!options.fixturePlan && e2eStarted) {
    for (const step of cleanupPlan()) {
      const result = await runStep(step, report.steps.length, runDirectory, runId);
      report.steps.push(result);
      if (result.status === 'failed' && report.failedStep === null) report.failedStep = result.id;
    }
  }

  report.result = report.failedStep === null ? 'passed' : 'failed';
  report.finishedAt = new Date().toISOString();
  await writeReports(report, options.outputDirectory, runDirectory);
  console.log(`Regression ${report.result}: ${join(options.outputDirectory, 'latest.md')}`);
  if (report.result !== 'passed') process.exitCode = 1;
}

await main();
