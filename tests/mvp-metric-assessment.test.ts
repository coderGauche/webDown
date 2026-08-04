import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type MetricStatus = 'passed' | 'failed' | 'not-measured';

interface MetricAssessment {
  id: string;
  target: { operator: '>=' | '<=' | '='; value: number; unit: string };
  status: MetricStatus;
  measurement: { numerator: number; denominator: number; value: number } | null;
  severity: 'P0' | 'P1';
  evidence: string[];
  deviation: string | null;
  releaseImpact: string;
  followUp: string;
}

interface MvpAssessment {
  schemaVersion: number;
  assessmentId: string;
  assessedAt: string;
  publicAcceptance: {
    fixedCases: number;
    reachableCases: number;
    externalUnavailableCases: number;
    successfulArchives: number;
  };
  releaseDecision: 'ready' | 'blocked';
  blockingDeviationIds: string[];
  metrics: MetricAssessment[];
}

const assessment = JSON.parse(
  readFileSync(new URL('./baselines/mvp-metrics.json', import.meta.url), 'utf8'),
) as MvpAssessment;

const REQUIRED_METRICS = [
  'basic-site-archive-success-rate',
  'marketing-page-primary-visual-completeness',
  'broken-local-resource-request-rate',
  'single-resource-failure-explainability',
  'cancel-response-time',
  'archive-report-generation-rate',
  'captured-content-uploaded-to-product-server',
] as const;

function targetSatisfied(metric: MetricAssessment): boolean {
  if (!metric.measurement) return false;
  if (metric.target.operator === '>=') return metric.measurement.value >= metric.target.value;
  if (metric.target.operator === '<=') return metric.measurement.value <= metric.target.value;
  return metric.measurement.value === metric.target.value;
}

describe('M10 MVP metric assessment', () => {
  it('covers every PRD metric exactly once with evidence and an explicit disposition', () => {
    expect(assessment.schemaVersion).toBe(1);
    expect(assessment.assessmentId).toBe('m10-mvp-metrics-2026-08-04');
    expect(assessment.assessedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(assessment.metrics.map(({ id }) => id).sort()).toEqual([...REQUIRED_METRICS].sort());

    for (const metric of assessment.metrics) {
      expect(metric.evidence.length).toBeGreaterThan(0);
      expect(metric.releaseImpact.trim()).not.toBe('');
      expect(metric.followUp.trim()).not.toBe('');
      if (metric.status === 'passed') {
        expect(metric.deviation).toBeNull();
      } else {
        expect(metric.deviation?.trim()).toBeTruthy();
      }
    }
  });

  it('uses the complete reachable fixed set as the archive-rate denominator', () => {
    const run = assessment.publicAcceptance;
    expect(run.reachableCases + run.externalUnavailableCases).toBe(run.fixedCases);

    const archiveRate = assessment.metrics.find(
      ({ id }) => id === 'basic-site-archive-success-rate',
    )!;
    expect(archiveRate.measurement).toMatchObject({
      numerator: run.successfulArchives,
      denominator: run.reachableCases,
    });
    expect(archiveRate.measurement!.value).toBeCloseTo(
      (run.successfulArchives / run.reachableCases) * 100,
      2,
    );
  });

  it('never treats missing measurements as passing and derives readiness from failed P0 metrics', () => {
    for (const metric of assessment.metrics) {
      if (metric.status === 'passed') expect(targetSatisfied(metric)).toBe(true);
      if (metric.status === 'failed') expect(targetSatisfied(metric)).toBe(false);
      if (metric.status === 'not-measured') expect(metric.measurement).toBeNull();
    }

    const failedP0 = assessment.metrics
      .filter(({ severity, status }) => severity === 'P0' && status === 'failed')
      .map(({ id }) => id)
      .sort();
    expect(assessment.blockingDeviationIds.sort()).toEqual(failedP0);
    expect(assessment.releaseDecision).toBe(failedP0.length === 0 ? 'ready' : 'blocked');
  });
});
