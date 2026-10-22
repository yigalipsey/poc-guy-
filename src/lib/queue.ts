// BullMQ queue definition shared by both sides: the web app enqueues jobs here and
// the worker process consumes them. The only module that knows the queue name.
import { Redis } from "ioredis";
import { Queue, type JobsOptions } from "bullmq";
import { requireEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

export const TELEGRAM_QUEUE_NAME = "telegram-integration-queue";

// The worker reads the user name from the database row.
export type TelegramJobData = {
  messageId: string;
  content: string;
};

// 5 attempts with 2s, 4s, 8s, 16s between them. Finished jobs expire so Redis
// doesn't grow without bound.
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: { age: 24 * 60 * 60 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

// BullMQ requires maxRetriesPerRequest: null on blocking connections: the worker
// waits on Redis for new jobs, and the default retry limit would make it throw.
export function createWorkerConnection(): Redis {
  return new Redis(requireEnv("REDIS_URL"), { maxRetriesPerRequest: null });
}

// Producer side. Cached on globalThis so dev hot reloads (which re-evaluate this
// module) don't open a new Redis connection each time.
const globalForQueue = globalThis as typeof globalThis & {
  __telegramQueue?: Queue<TelegramJobData>;
};

function getProducerQueue(): Queue<TelegramJobData> {
  if (!globalForQueue.__telegramQueue) {
    const queue = new Queue<TelegramJobData>(TELEGRAM_QUEUE_NAME, {
      connection: new Redis(requireEnv("REDIS_URL")),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    // Attached here, at creation, so hot reloads reusing the cached queue don't stack listeners.
    // Without any listener, an emitted 'error' event would throw and could crash the process.
    queue.on("error", (error) => logger.error("Producer queue error", { error }));
    globalForQueue.__telegramQueue = queue;
  }
  return globalForQueue.__telegramQueue;
}

// jobId = messageId makes the enqueue idempotent: BullMQ ignores an add whose id
// already exists, so one message can never have two live jobs.
export async function enqueueTelegramJob(data: TelegramJobData): Promise<void> {
  await getProducerQueue().add("send-telegram-message", data, {
    jobId: data.messageId,
  });
}
