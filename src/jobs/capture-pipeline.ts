import {
  SiteCapsuleError,
  createCaptureError,
  toSiteCapsuleError,
  type CaptureJob,
  type JobCounters,
  type JobStatus,
} from '@sitecapsule/domain';

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
    update: { status?: JobStatus; counters?: Partial<JobCounters> },
  ): Promise<CaptureJob | undefined>;
};

export type CapturePipelineStageContext<TContext> = {
  job: CaptureJob;
  context: TContext;
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
  onJobUpdated?: (job: CaptureJob) => void | Promise<void>;
};

async function requireJob(value: CaptureJob | undefined, jobId: string): Promise<CaptureJob> {
  if (value) return value;
  throw new SiteCapsuleError(createCaptureError('job-not-found', { operation: 'job-read', jobId }));
}

export async function runCapturePipeline<TContext>(
  options: CapturePipelineOptions<TContext>,
): Promise<CaptureJob> {
  let job = await requireJob(await options.repository.getJob(options.jobId), options.jobId);

  const publish = async (next: CaptureJob | undefined) => {
    job = await requireJob(next, options.jobId);
    await options.onJobUpdated?.(job);
    return job;
  };

  try {
    for (const stage of CAPTURE_PIPELINE_STAGES) {
      await publish(await options.repository.updateJob(options.jobId, { status: stage }));
      await options.handlers[stage]({
        job,
        context: options.context,
        report: async (counters) =>
          publish(await options.repository.updateJob(options.jobId, { counters })),
      });
    }

    return publish(await options.repository.updateJob(options.jobId, { status: 'completed' }));
  } catch (error) {
    const structured = toSiteCapsuleError(error, 'unexpected-error', {
      operation: 'job-update',
      jobId: options.jobId,
      stage: job.status,
    });
    if (job.status !== 'failed' && job.status !== 'completed' && job.status !== 'cancelled') {
      try {
        await publish(await options.repository.updateJob(options.jobId, { status: 'failed' }));
      } catch {
        // Preserve the stage error when persisting the failed state also fails.
      }
    }
    throw structured;
  }
}
