import {
  JOB_STATUSES,
  PAUSABLE_JOB_STATUSES,
  type JobState,
  type JobStatus,
  type PausableJobStatus,
} from './capture';
import { SiteCapsuleError, createCaptureError } from './errors';

export const TERMINAL_JOB_STATUSES = [
  'completed',
  'cancelled',
] as const satisfies readonly JobStatus[];

const JOB_STATUS_TRANSITIONS = {
  idle: ['preparing'],
  preparing: ['discovering', 'paused', 'cancelling', 'failed'],
  discovering: ['fetching', 'paused', 'cancelling', 'failed'],
  fetching: ['rewriting', 'paused', 'cancelling', 'failed'],
  rewriting: ['packaging', 'paused', 'cancelling', 'failed'],
  packaging: ['completed', 'paused', 'cancelling', 'failed'],
  completed: [],
  paused: [],
  cancelling: ['cancelled'],
  cancelled: [],
  failed: ['retrying'],
  retrying: ['preparing', 'paused', 'cancelling', 'failed'],
} as const satisfies Record<JobStatus, readonly JobStatus[]>;

export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === 'string' && (JOB_STATUSES as readonly string[]).includes(value);
}

export function isPausableJobStatus(status: JobStatus): status is PausableJobStatus {
  return (PAUSABLE_JOB_STATUSES as readonly JobStatus[]).includes(status);
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return (TERMINAL_JOB_STATUSES as readonly JobStatus[]).includes(status);
}

export function canTransitionJobState(current: JobState, nextStatus: JobStatus): boolean {
  if (current.status === 'paused') {
    return nextStatus === current.resumeStatus || nextStatus === 'cancelling';
  }

  return (JOB_STATUS_TRANSITIONS[current.status] as readonly JobStatus[]).includes(nextStatus);
}

export function transitionJobState(current: JobState, nextStatus: JobStatus): JobState {
  if (!canTransitionJobState(current, nextStatus)) {
    throw new SiteCapsuleError(
      createCaptureError('invalid-job-transition', {
        operation: 'job-transition',
        stage: current.status,
        targetStage: nextStatus,
      }),
    );
  }

  if (nextStatus === 'paused') {
    if (!isPausableJobStatus(current.status)) {
      throw new SiteCapsuleError(
        createCaptureError('invalid-job-transition', {
          operation: 'job-transition',
          stage: current.status,
          targetStage: nextStatus,
        }),
      );
    }

    return {
      status: 'paused',
      resumeStatus: current.status,
    };
  }

  return { status: nextStatus };
}
