import { Queue, JobsOptions } from 'bullmq';
import { getConnectionOptions } from './connection';
import { logger } from '../logger';

export const QUEUE_NAME = 'campaign-messages';
export const SCHEDULER_QUEUE_NAME = 'campaign-scheduler';

export interface SendJobData {
  campaignId: string;
  contactId: string;
  userId: string;
}

let queueInstance: Queue | null = null;
let schedulerQueue: Queue | null = null;

export function getCampaignQueue(): Queue {
  if (queueInstance) return queueInstance;
  queueInstance = new Queue(QUEUE_NAME, {
    connection: getConnectionOptions(),
    defaultJobOptions: {
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  });
  return queueInstance;
}

export function getSchedulerQueue(): Queue {
  if (schedulerQueue) return schedulerQueue;
  schedulerQueue = new Queue(SCHEDULER_QUEUE_NAME, { connection: getConnectionOptions() });
  return schedulerQueue;
}

export function jobIdFor(campaignId: string, contactId: string): string {
  return `${campaignId}:${contactId}`;
}

export async function enqueueContact(
  data: SendJobData,
  opts: JobsOptions = {},
): Promise<string> {
  const q = getCampaignQueue();
  const jobId = jobIdFor(data.campaignId, data.contactId);
  await q.add('send-message', data, { ...opts, jobId });
  return jobId;
}

export async function enqueueContactsBulk(
  rows: SendJobData[],
  opts: JobsOptions = {},
): Promise<void> {
  if (rows.length === 0) return;
  const q = getCampaignQueue();
  await q.addBulk(
    rows.map((data) => ({
      name: 'send-message',
      data,
      opts: { ...opts, jobId: jobIdFor(data.campaignId, data.contactId) },
    })),
  );
}

export async function removeCampaignJobs(campaignId: string): Promise<number> {
  const q = getCampaignQueue();
  const jobs = await q.getJobs(['waiting', 'delayed', 'paused', 'wait']);
  let removed = 0;
  for (const j of jobs) {
    if ((j as any)?.data?.campaignId === campaignId) {
      await j.remove();
      removed++;
    }
  }
  logger.debug({ campaignId, removed }, '[Queue] Removed jobs for campaign');
  return removed;
}
