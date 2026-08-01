import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const runnerPath = resolve(process.cwd(), 'scripts/run-regression.mjs');
const temporaryDirectories: string[] = [];

async function runFixturePlan(plan: 'pass' | 'fail') {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'sitecapsule-regression-'));
  temporaryDirectories.push(outputDirectory);
  const result = spawnSync(
    process.execPath,
    [runnerPath, '--fixture-plan', plan, '--output-dir', outputDirectory],
    { encoding: 'utf8' },
  );
  const report = JSON.parse(await readFile(join(outputDirectory, 'latest.json'), 'utf8')) as {
    result: string;
    failedStep: string | null;
    finishedAt: string | null;
    steps: Array<{ id: string; status: string; logPath: string | null }>;
  };
  const markdown = await readFile(join(outputDirectory, 'latest.md'), 'utf8');
  return { result, report, markdown };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('regression runner reporting', () => {
  it('writes successful JSON and Markdown reports with step logs', async () => {
    const { result, report, markdown } = await runFixturePlan('pass');

    expect(result.status).toBe(0);
    expect(report.result).toBe('passed');
    expect(report.failedStep).toBeNull();
    expect(report.finishedAt).not.toBeNull();
    expect(report.steps.map(({ status }) => status)).toEqual(['passed', 'passed', 'passed']);
    expect(report.steps.every(({ logPath }) => typeof logPath === 'string')).toBe(true);
    expect(markdown).toContain('SiteCapsule Regression Report');
    expect(markdown).toContain('Manual Release Review');
  });

  it('stops after the first failure while retaining reports and skipped steps', async () => {
    const { result, report, markdown } = await runFixturePlan('fail');

    expect(result.status).toBe(1);
    expect(report).toMatchObject({ result: 'failed', failedStep: 'fixture-result' });
    expect(report.steps.map(({ status }) => status)).toEqual(['passed', 'failed', 'skipped']);
    expect(report.steps[1]?.logPath).not.toBeNull();
    expect(report.steps[2]?.logPath).toBeNull();
    expect(markdown).toContain('| Fixture controlled result | verification | failed | 7 |');
    expect(markdown).toContain('| Fixture last step | verification | skipped | - |');
  });
});
