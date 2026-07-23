import type { CaptureJob, ResourceRecord } from '@sitecapsule/domain';
import Dexie, { type Table } from 'dexie';

export const DATABASE_NAME = 'sitecapsule';
export const DATABASE_SCHEMA_VERSION = 1;

export const DATABASE_SCHEMA = {
  jobs: 'id,status,createdAt,updatedAt,[status+updatedAt]',
  resources: 'id,jobId,state,type,originalUrl,[jobId+state],[jobId+originalUrl]',
} as const;

export class SiteCapsuleDatabase extends Dexie {
  jobs!: Table<CaptureJob, string>;
  resources!: Table<ResourceRecord, string>;

  constructor(name = DATABASE_NAME) {
    super(name);

    this.version(DATABASE_SCHEMA_VERSION).stores(DATABASE_SCHEMA);
  }
}

export const database = new SiteCapsuleDatabase();
