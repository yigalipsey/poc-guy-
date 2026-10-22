// Backstop for the worker's `failed` event, kept free of Redis and Supabase so it can
// be unit-tested. The processor marks and logs its own failures; this only acts when
// BullMQ failed a job without running the processor, which leaves the row stuck on
// "processing". The known case: a job that stalls twice (worker killed mid-send,
// maxStalledCount is 1) is failed directly with an UnrecoverableError.
import { UnrecoverableError } from "bullmq";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import { wasHandledByProcessor, type MessageStore } from "./processor";

// The slice of a BullMQ Job this uses, so tests can pass plain objects.
export interface FailedJob {
  id?: string;
  data: { messageId: string };
  attemptsMade: number;
  finishedOn?: number;
  opts: { attempts?: number };
}

export interface FailedHandlerDeps {
  store: Pick<MessageStore, "markFailed">;
  logger?: Logger;
}

// By the time `failed` is emitted BullMQ has already counted the attempt, so
// attemptsMade is the number of finished attempts, and finishedOn is only set once
// the job has moved to the failed set (not when it is scheduled for a retry).
function isTerminal(job: FailedJob, error: Error): boolean {
  return (
    job.finishedOn !== undefined ||
    error instanceof UnrecoverableError ||
    job.attemptsMade >= (job.opts.attempts ?? 1)
  );
}

// Never throws: this runs inside an event emitter, where a rejection would crash
// the process.
export async function handleJobFailed(
  job: FailedJob | undefined,
  error: Error,
  deps: FailedHandlerDeps,
): Promise<void> {
  if (!job || wasHandledByProcessor(error) || !isTerminal(job, error)) return;

  const log = deps.logger ?? defaultLogger;
  const { messageId } = job.data;
  const errorKind = error instanceof UnrecoverableError ? "unrecoverable" : "retryable";
  log.error("Job failed without the processor handling it", {
    jobId: job.id,
    messageId,
    attempt: job.attemptsMade,
    errorKind,
    error,
  });
  try {
    await deps.store.markFailed(messageId, error.message);
  } catch (markError) {
    log.error("Could not mark message failed", {
      jobId: job.id,
      messageId,
      error: markError,
    });
  }
}
