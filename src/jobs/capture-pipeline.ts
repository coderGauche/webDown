import {
  SiteCapsuleError,
  createCaptureError,
  toSiteCapsuleError,
  type CaptureError,
  type CaptureJob,
  type JobCounters,
  type JobStatus,
} from '@sitecapsule/domain';
import { getQueueInterruptionKind } from '@sitecapsule/download';

export const CAPTURE_PIPELINE_STAGES = [
  'preparing',
  'discovering',
  'fetching',
  'rewriting',
  'packaging',
] as const;

export type CapturePipelineStage = (typeof CAPTURE_PIPELINE_STAGES)[number];

export type CapturePipelineRepository = {
  getJob(jobId: string): Promise<CaptureJob | undefined>;
  updateJob(
    jobId: string,
    update: {
      status?: JobStatus;
      counters?: Partial<JobCounters>;
      error?: CaptureError | null;
    },
  ): Promise<CaptureJob | undefined>;
};

export type CapturePipelineStageContext<TContext> = {
  job: CaptureJob;
  context: TContext;
  signal: AbortSignal;
  report: (counters: Partial<JobCounters>) => Promise<CaptureJob>;
};

export type CapturePipelineHandlers<TContext> = Record<
  CapturePipelineStage,
  (input: CapturePipelineStageContext<TContext>) => void | Promise<void>
>;

export type CapturePipelineOptions<TContext> = {
  jobId: string;
  context: TContext;
  repository: CapturePipelineRepository;
  handlers: CapturePipelineHandlers<TContext>;
  signal?: AbortSignal;
  onJobUpdated?: (job: CaptureJob) => void | Promise<void>;
};

const NEVER_ABORTED_SIGNAL = new AbortController().signal;

async function requireJob(value: CaptureJob | undefined, jobId: string): Promise<CaptureJob> {
  if (value) return value;
  throw new SiteCapsuleError(createCaptureError('job-not-found', { operation: 'job-read', jobId }));
}

export async function runCapturePipeline<TContext>(
  options: CapturePipelineOptions<TContext>,
): Promise<CaptureJob> {
  let job = await requireJob(await options.repository.getJob(options.jobId), options.jobId);
  const signal = options.signal ?? NEVER_ABORTED_SIGNAL;

  const publish = async (next: CaptureJob | undefined) => {
    job = await requireJob(next, options.jobId);
    await options.onJobUpdated?.(job);
    return job;
  };

  const handleInterruption = async (): Promise<CaptureJob | null> => {
    const kind = getQueueInterruptionKind(signal);
    if (kind === null) return null;
    if (kind === 'pause') {
      return publish(await options.repository.updateJob(options.jobId, { status: 'paused' }));
    }
    await publish(await options.repository.updateJob(options.jobId, { status: 'cancelling' }));
    return publish(await options.repository.updateJob(options.jobId, { status: 'cancelled' }));
  };

  const resumeStatus = job.status === 'paused' ? job.resumeStatus : null;
  const firstStage =
    resumeStatus !== null
      ? resumeStatus === 'retrying'
        ? 'preparing'
        : resumeStatus
      : job.status === 'idle' || job.status === 'retrying'
        ? 'preparing'
        : null;
  if (firstStage === null) {
    throw new SiteCapsuleError(
      createCaptureError('invalid-job-transition', {
        operation: 'job-transition',
        jobId: options.jobId,
        stage: job.status,
        targetStage: 'preparing',
      }),
    );
  }
  const stages = CAPTURE_PIPELINE_STAGES.slice(CAPTURE_PIPELINE_STAGES.indexOf(firstStage));

  try {
    if (resumeStatus !== null) {
      await publish(await options.repository.updateJob(options.jobId, { status: resumeStatus }));
    }
    for (const stage of stages) {
      const interruptedBeforeStage = await handleInterruption();
      if (interruptedBeforeStage) return interruptedBeforeStage;
      await publish(await options.repository.updateJob(options.jobId, { status: stage }));
      await options.handlers[stage]({
        job,
        context: options.context,
        signal,
        report: async (counters) =>
          publish(await options.repository.updateJob(options.jobId, { counters })),
      });
      const interruptedAfterStage = await handleInterruption();
      if (interruptedAfterStage) return interruptedAfterStage;
    }

    return publish(await options.repository.updateJob(options.jobId, { status: 'completed' }));
  } catch (error) {
    const interrupted = await handleInterruption();
    if (interrupted) return interrupted;
    const structured = toSiteCapsuleError(error, 'unexpected-error', {
      operation: 'job-update',
      jobId: options.jobId,
      stage: job.status,
    });
    if (job.status !== 'failed' && job.status !== 'completed' && job.status !== 'cancelled') {
      try {
        await publish(
          await options.repository.updateJob(options.jobId, {
            status: 'failed',
            error: structured.details,
          }),
        );
      } catch {
        // Preserve the stage error when persisting the failed state also fails.
      }
    }
    throw structured;
  }
}
