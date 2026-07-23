import {
  JOB_STATUSES,
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
    expect(() => transitionJobState({ status: 'idle' }, 'fetching')).toThrow(
      'Invalid capture job transition: idle -> fetching',
    );
    expect(() =>
      transitionJobState({ status: 'paused', resumeStatus: 'fetching' }, 'rewriting'),
    ).toThrow('Invalid capture job transition: paused -> rewriting');
    expect(() => transitionJobState({ status: 'completed' }, 'preparing')).toThrow(
      'Invalid capture job transition: completed -> preparing',
    );
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
