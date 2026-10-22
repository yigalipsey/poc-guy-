import { UnrecoverableError } from "bullmq";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import { formatTelegramText } from "@/lib/telegram";
import type { TelegramJobData } from "@/lib/queue";

export type StoredMessage = {
  id: string;
  status: string;
  user_name: string;
};

export interface MessageStore {
  getMessage(id: string): Promise<StoredMessage | null>;
  markProcessing(id: string): Promise<void>;
  markCompleted(id: string, telegramResponse: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}

// Token and chat id are bound by the wiring; the processor only supplies text.
export type TelegramSender = (text: string) => Promise<unknown>;

export interface QueueRateLimiter {
  rateLimit(expireTimeMs: number): Promise<void>;
}

export interface ProcessorDeps {
  store: MessageStore;
  sendTelegram: TelegramSender;
  queue: QueueRateLimiter;
  logger?: Logger;
}

// The slice of a BullMQ Job the processor uses, so tests can pass plain objects.
export interface ProcessorJob {
  id?: string;
  data: TelegramJobData;
  progress: unknown;
  attemptsMade: number;
  opts: { attempts?: number };
  updateProgress(progress: object): Promise<void>;
}

function readSentResult(progress: unknown): { telegramResult: unknown } | null {
  if (
    typeof progress === "object" &&
    progress !== null &&
    "telegramResult" in progress
  ) {
    return { telegramResult: progress.telegramResult };
  }
  return null;
}

export async function processTelegramJob(
  job: ProcessorJob,
  deps: ProcessorDeps,
): Promise<void> {
  const { store, sendTelegram } = deps;
  const log = deps.logger ?? defaultLogger;
  const { messageId, content } = job.data;
  const context = { jobId: job.id, messageId, attempt: job.attemptsMade + 1 };

  const message = await store.getMessage(messageId);
  if (!message) {
    throw new UnrecoverableError(`Message ${messageId} not found`);
  }

  if (message.status === "completed") {
    log.info("Message already completed, skipping", context);
    return;
  }

  await store.markProcessing(messageId);

  // A previous attempt already sent to Telegram; only the database update is left.
  const sentBefore = readSentResult(job.progress);
  let telegramResult: unknown;
  if (sentBefore) {
    telegramResult = sentBefore.telegramResult;
  } else {
    telegramResult = await sendTelegram(
      formatTelegramText(message.user_name, content),
    );
    // Recorded before touching the database so a retry can tell the send happened.
    await job.updateProgress({ telegramResult });
  }

  await store.markCompleted(messageId, JSON.stringify(telegramResult));
  log.info("Message delivered to Telegram", context);
}
