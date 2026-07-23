import {
  JOB_STATUSES,
  TERMINAL_JOB_STATUSES,
  transitionJobState,
  type CaptureJob,
  type CaptureMode,
  type CaptureProfile,
  type CaptureSettings,
  type JobCounters,
  type JobState,
  type JobStatus,
} from '@sitecapsule/domain';
import { database, type SiteCapsuleDatabase } from './database';

export const RECOVERABLE_JOB_STATUSES = JOB_STATUSES.filter(
  (status) => !(TERMINAL_JOB_STATUSES as readonly JobStatus[]).includes(status),
);

export type CreateCaptureJobInput = {
  tabId: number;
  startUrl: string;
  mode: CaptureMode;
  profile: CaptureProfile;
  settings: CaptureSettings;
};

export type CaptureJobUpdate = {
  status?: JobStatus;
  settings?: CaptureSettings;
  counters?: Partial<JobCounters>;
};

export type ListCaptureJobsOptions = {
  statuses?: readonly JobStatus[];
  limit?: number;
};

export type JobRepositoryDependencies = {
  createId: () => string;
  now: () => string;
};

const EMPTY_JOB_COUNTERS: JobCounters = {
  pagesDiscovered: 0,
  pagesCaptured: 0,
  resourcesDiscovered: 0,
  resourcesSaved: 0,
  resourcesFailed: 0,
  resourcesSkipped: 0,
  bytesWritten: 0,
};

const DEFAULT_DEPENDENCIES: JobRepositoryDependencies = {
  createId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

function currentJobState(job: CaptureJob): JobState {
  if (job.status === 'paused') {
    return {
      status: job.status,
      resumeStatus: job.resumeStatus,
    };
  }

  return { status: job.status };
}

function mergeJobCounters(
  current: JobCounters,
  update: Partial<JobCounters> | undefined,
): JobCounters {
  const counters: JobCounters = {
    pagesDiscovered: update?.pagesDiscovered ?? current.pagesDiscovered,
    pagesCaptured: update?.pagesCaptured ?? current.pagesCaptured,
    resourcesDiscovered: update?.resourcesDiscovered ?? current.resourcesDiscovered,
    resourcesSaved: update?.resourcesSaved ?? current.resourcesSaved,
    resourcesFailed: update?.resourcesFailed ?? current.resourcesFailed,
    resourcesSkipped: update?.resourcesSkipped ?? current.resourcesSkipped,
    bytesWritten: update?.bytesWritten ?? current.bytesWritten,
  };

  for (const [name, value] of Object.entries(counters)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Invalid capture job counter: ${name}`);
    }
  }

  return counters;
}

export class JobRepository {
  private readonly dependencies: JobRepositoryDependencies;

  constructor(
    private readonly db: SiteCapsuleDatabase = database,
    dependencies: Partial<JobRepositoryDependencies> = {},
  ) {
    this.dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  }

  async createJob(input: CreateCaptureJobInput): Promise<CaptureJob> {
    const timestamp = this.dependencies.now();
    const job: CaptureJob = {
      id: this.dependencies.createId(),
      ...input,
      status: 'idle',
      counters: { ...EMPTY_JOB_COUNTERS },
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.db.jobs.add(job);
    return job;
  }

  getJob(jobId: string): Promise<CaptureJob | undefined> {
    return this.db.jobs.get(jobId);
  }

  async listJobs(options: ListCaptureJobsOptions = {}): Promise<CaptureJob[]> {
    if (
      options.statuses?.length === 0 ||
      (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit <= 0))
    ) {
      return [];
    }

    const jobs = options.statuses
      ? await this.db.jobs
          .where('status')
          .anyOf([...options.statuses])
          .toArray()
      : await this.db.jobs.toArray();

    jobs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    return options.limit === undefined ? jobs : jobs.slice(0, options.limit);
  }

  listRecoverableJobs(): Promise<CaptureJob[]> {
    return this.listJobs({ statuses: RECOVERABLE_JOB_STATUSES });
  }

  async updateJob(jobId: string, update: CaptureJobUpdate): Promise<CaptureJob | undefined> {
    return this.db.transaction('rw', this.db.jobs, async () => {
      const current = await this.db.jobs.get(jobId);
      if (!current) return undefined;

      const nextState =
        update.status === undefined || update.status === current.status
          ? currentJobState(current)
          : transitionJobState(current, update.status);
      const { status: _status, resumeStatus: _resumeStatus, ...details } = current;
      const updated: CaptureJob = {
        ...details,
        settings: update.settings ?? current.settings,
        counters: mergeJobCounters(current.counters, update.counters),
        updatedAt: this.dependencies.now(),
        ...nextState,
      };

      await this.db.jobs.put(updated);
      return updated;
    });
  }

  async deleteJob(jobId: string): Promise<boolean> {
    return (await this.deleteJobs([jobId])) === 1;
  }

  async clearTerminalJobs(updatedBefore?: string): Promise<number> {
    const terminalJobs = await this.db.jobs
      .where('status')
      .anyOf([...TERMINAL_JOB_STATUSES])
      .toArray();
    const jobIds = terminalJobs
      .filter((job) => updatedBefore === undefined || job.updatedAt <= updatedBefore)
      .map((job) => job.id);

    return this.deleteJobs(jobIds);
  }

  async clearAllJobs(): Promise<number> {
    return this.db.transaction('rw', this.db.jobs, this.db.resources, async () => {
      const deletedJobCount = await this.db.jobs.count();
      await this.db.resources.clear();
      await this.db.jobs.clear();
      return deletedJobCount;
    });
  }

  private async deleteJobs(jobIds: readonly string[]): Promise<number> {
    if (jobIds.length === 0) return 0;

    return this.db.transaction('rw', this.db.jobs, this.db.resources, async () => {
      const existingJobs = await this.db.jobs.bulkGet([...jobIds]);
      const existingJobIds = existingJobs.flatMap((job) => (job ? [job.id] : []));
      if (existingJobIds.length === 0) return 0;

      await this.db.resources.where('jobId').anyOf(existingJobIds).delete();
      await this.db.jobs.bulkDelete(existingJobIds);
      return existingJobIds.length;
    });
  }
}

export const jobRepository = new JobRepository();
