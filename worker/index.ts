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
import { createSupabaseMessageStore } from "./message-store";
import { processTelegramJob } from "./processor";

function main(): void {
  let config;
  try {
    config = loadWorkerConfig();
  } catch (error) {
    logger.error("Worker cannot start", { error });
    process.exit(1);
  }

  const connection = createWorkerConnection();
  const queue = new Queue(TELEGRAM_QUEUE_NAME, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  const store = createSupabaseMessageStore(getAdminClient());

  const worker = new Worker<TelegramJobData>(
    TELEGRAM_QUEUE_NAME,
    (job) =>
      processTelegramJob(job, {
        store,
        queue,
        sendTelegram: (text) =>
          sendTelegramMessage({
            token: config.telegramBotToken,
            chatId: config.telegramChatId,
            text,
          }),
      }),
    { connection, concurrency: 1, limiter: { max: 1, duration: 1000 } },
  );

  worker.on("error", (error) => logger.error("Worker error", { error }));
  worker.on("failed", (job, error) =>
    logger.warn("Job failed", {
      jobId: job?.id,
      messageId: job?.data.messageId,
      attempt: job?.attemptsMade,
      error,
    }),
  );

  logger.info("Worker started", { queue: TELEGRAM_QUEUE_NAME });
}

main();
