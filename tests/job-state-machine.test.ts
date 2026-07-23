import {
  JOB_STATUSES,
  SiteCapsuleError,
  canTransitionJobState,
  isJobStatus,
  isPausableJobStatus,
  isTerminalJobStatus,
  transitionJobState,
  type JobState,
  type JobStatus,
} from '@sitecapsule/domain';
import { describe, expect, it } from 'vitest';

function followTransitions(initial: JobState, statuses: JobStatus[]): JobState {
  return statuses.reduce(transitionJobState, initial);
}

const EXPECTED_TRANSITIONS = {
  idle: ['preparing'],
  preparing: ['discovering', 'paused', 'cancelling', 'failed'],
  discovering: ['fetching', 'paused', 'cancelling', 'failed'],
  fetching: ['rewriting', 'paused', 'cancelling', 'failed'],
  rewriting: ['packaging', 'paused', 'cancelling', 'failed'],
  packaging: ['completed', 'paused', 'cancelling', 'failed'],
  completed: [],
  paused: ['fetching', 'cancelling'],
  cancelling: ['cancelled'],
  cancelled: [],
  failed: ['retrying'],
  retrying: ['preparing', 'paused', 'cancelling', 'failed'],
} as const satisfies Record<JobStatus, readonly JobStatus[]>;

function createState(status: JobStatus): JobState {
  return status === 'paused' ? { status, resumeStatus: 'fetching' } : { status };
}

describe('capture job state machine', () => {
  it('runs the complete successful pipeline in order', () => {
    const completed = followTransitions({ status: 'idle' }, [
      'preparing',
      'discovering',
      'fetching',
      'rewriting',
      'packaging',
      'completed',
    ]);

    expect(completed).toEqual({ status: 'completed' });
    expect(isTerminalJobStatus(completed.status)).toBe(true);
  });

  it('pauses and resumes only the interrupted execution phase', () => {
    const paused = transitionJobState({ status: 'fetching' }, 'paused');

    expect(paused).toEqual({ status: 'paused', resumeStatus: 'fetching' });
    expect(canTransitionJobState(paused, 'fetching')).toBe(true);
    expect(canTransitionJobState(paused, 'rewriting')).toBe(false);
    expect(transitionJobState(paused, 'fetching')).toEqual({ status: 'fetching' });
  });

  it('supports cancellation from running and paused jobs', () => {
    const runningCancellation = followTransitions({ status: 'discovering' }, [
      'cancelling',
      'cancelled',
    ]);
    const pausedCancellation = followTransitions({ status: 'paused', resumeStatus: 'packaging' }, [
      'cancelling',
      'cancelled',
    ]);

    expect(runningCancellation).toEqual({ status: 'cancelled' });
    expect(pausedCancellation).toEqual({ status: 'cancelled' });
  });

  it('restarts a failed job from preparing after retrying', () => {
    const restarted = followTransitions({ status: 'rewriting' }, [
      'failed',
      'retrying',
      'preparing',
    ]);

    expect(restarted).toEqual({ status: 'preparing' });
  });

  it('rejects skipped phases, invalid resumes, and terminal transitions', () => {
    const invalidTransitions = [
      [{ status: 'idle' }, 'fetching'],
      [{ status: 'paused', resumeStatus: 'fetching' }, 'rewriting'],
      [{ status: 'completed' }, 'preparing'],
    ] as const;

    for (const [current, nextStatus] of invalidTransitions) {
      try {
        transitionJobState(current, nextStatus);
        throw new Error('Expected transition to fail.');
      } catch (error) {
        expect(error).toBeInstanceOf(SiteCapsuleError);
        expect((error as SiteCapsuleError).details).toMatchObject({
          code: 'invalid-job-transition',
          retryable: false,
          context: {
            operation: 'job-transition',
            stage: current.status,
            targetStage: nextStatus,
          },
        });
      }
    }
  });

  it('keeps the transition guard and reducer aligned for every status pair', () => {
    for (const currentStatus of JOB_STATUSES) {
      const current = createState(currentStatus);

      for (const nextStatus of JOB_STATUSES) {
        const expected = (EXPECTED_TRANSITIONS[currentStatus] as readonly JobStatus[]).includes(
          nextStatus,
        );

        expect(canTransitionJobState(current, nextStatus)).toBe(expected);

        if (expected) {
          const next = transitionJobState(current, nextStatus);
          expect(next.status).toBe(nextStatus);
          if (next.status === 'paused') {
            expect(next.resumeStatus).toBe(current.status);
          }
        } else {
          expect(() => transitionJobState(current, nextStatus)).toThrowError(SiteCapsuleError);
          try {
            transitionJobState(current, nextStatus);
          } catch (error) {
            expect((error as SiteCapsuleError).details.code).toBe('invalid-job-transition');
          }
        }
      }
    }
  });

  it('keeps runtime status checks aligned with the domain vocabulary', () => {
    for (const status of JOB_STATUSES) {
      expect(isJobStatus(status)).toBe(true);
    }

    expect(isJobStatus('unknown')).toBe(false);
    expect(isPausableJobStatus('retrying')).toBe(true);
    expect(isPausableJobStatus('failed')).toBe(false);
    expect(isTerminalJobStatus('failed')).toBe(false);
    expect(isTerminalJobStatus('cancelled')).toBe(true);
  });
});
