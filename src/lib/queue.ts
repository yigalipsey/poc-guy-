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

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: { age: 24 * 60 * 60 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

// BullMQ requires maxRetriesPerRequest: null on blocking connections.
export function createWorkerConnection(): Redis {
  return new Redis(requireEnv("REDIS_URL"), { maxRetriesPerRequest: null });
}

// Producer side. Cached on globalThis so dev hot reloads don't leak connections.
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
    queue.on("error", (error) => logger.error("Producer queue error", { error }));
    globalForQueue.__telegramQueue = queue;
  }
  return globalForQueue.__telegramQueue;
}

// jobId = messageId makes the enqueue idempotent.
export async function enqueueTelegramJob(data: TelegramJobData): Promise<void> {
  await getProducerQueue().add("send-telegram-message", data, {
    jobId: data.messageId,
  });
}
