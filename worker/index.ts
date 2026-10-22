// Worker process entry point (run separately from Next, as its own container). It
// consumes the Telegram queue and delegates each job to processTelegramJob.
import { Queue, Worker } from "bullmq";
import { logger } from "@/lib/logger";
import {
  DEFAULT_JOB_OPTIONS,
  TELEGRAM_QUEUE_NAME,
  createWorkerConnection,
  type TelegramJobData,
} from "@/lib/queue";
import { getAdminClient } from "@/lib/supabase";
import { sendTelegramMessage } from "@/lib/telegram";
import { loadWorkerConfig } from "./config";
import { handleJobFailed } from "./failed-handler";
import { createSupabaseMessageStore } from "./message-store";
import { processTelegramJob } from "./processor";

function main(): void {
  let config;
  try {
    config = loadWorkerConfig();
  } catch (error) {
    logger.error("Worker cannot start", { error });
    // Non-zero exit so the platform shows the crash instead of a silently idle worker.
    process.exit(1);
  }

  const connection = createWorkerConnection();
  // The worker doesn't add jobs; it holds a Queue so the processor can pause the
  // whole queue (queue.rateLimit) when Telegram answers 429.
  const queue = new Queue(TELEGRAM_QUEUE_NAME, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  queue.on("error", (error) => logger.error("Queue error", { error }));
  const store = createSupabaseMessageStore(getAdminClient());

  const worker = new Worker<TelegramJobData>(
    TELEGRAM_QUEUE_NAME,
    (job) =>
      processTelegramJob(job, {
        store,
        queue,
        // The token and chat id are bound here so the processor never handles them.
        sendTelegram: (text) =>
          sendTelegramMessage({
            token: config.telegramBotToken,
            chatId: config.telegramChatId,
            text,
          }),
      }),
    // One job at a time and at most one per second, to stay within Telegram's
    // per-chat send limits.
    { connection, concurrency: 1, limiter: { max: 1, duration: 1000 } },
  );

  worker.on("error", (error) => logger.error("Worker error", { error }));
  // The processor marks and logs its own failures; this only covers jobs BullMQ
  // fails without running it (e.g. stalled twice), which would stay "processing".
  worker.on("failed", (job, error) => {
    void handleJobFailed(job, error, { store });
  });

  logger.info("Worker started", { queue: TELEGRAM_QUEUE_NAME });
}

main();
