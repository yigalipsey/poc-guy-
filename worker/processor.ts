// The BullMQ job processor, kept free of Redis, Supabase and fetch (all injected via
// ProcessorDeps) so the delivery and retry rules can be unit-tested directly.
import { RateLimitError, UnrecoverableError } from "bullmq";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import { TelegramError, formatTelegramText } from "@/lib/telegram";
import type { TelegramJobData } from "@/lib/queue";

export type StoredMessage = {
  id: string;
  status: string;
  user_name: string;
};

// The database operations the processor needs.
export interface MessageStore {
  getMessage(id: string): Promise<StoredMessage | null>;
  markProcessing(id: string): Promise<void>;
  markCompleted(id: string, telegramResponse: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}

// Token and chat id are bound by the wiring; the processor only supplies text.
export type TelegramSender = (text: string) => Promise<unknown>;

// Pauses the whole queue, not just this job (BullMQ's Queue.rateLimit).
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

// Fallback if a rate_limited error carries no retryAfterMs (the Telegram client
// always sets one, so this is only a safety net).
const DEFAULT_RETRY_AFTER_MS = 5_000;

// The "sent once" marker: job progress is persisted in Redis and survives retries.
// Telegram's result is stored as null when absent (undefined would serialize to {}
// and the key would be lost), so a present key, even with a null value, means "sent".
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

// fatal: permanent Telegram error. unrecoverable: raised directly as a BullMQ
// UnrecoverableError (e.g. missing row). Both skip retries.
type FailureKind = "retryable" | "fatal" | "unrecoverable" | "rate_limited";

type JobContext = { jobId?: string; messageId: string; attempt: number };

// Errors this processor already logged (and marked failed where needed) before
// rethrowing, so the worker's `failed` handler can tell them apart from failures
// BullMQ raised without running the processor (e.g. a job that stalled twice).
const handledErrors = new WeakSet<Error>();

export function wasHandledByProcessor(error: Error): boolean {
  return handledErrors.has(error);
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

// Maps whatever went wrong onto BullMQ's behavior: UnrecoverableError skips
// retries, RateLimitError returns the job to waiting without using an attempt,
// anything else is retried with the configured backoff.
async function classify(
  error: unknown,
  deps: ProcessorDeps,
): Promise<{ kind: FailureKind; error: Error }> {
  if (error instanceof UnrecoverableError) {
    return { kind: "unrecoverable", error };
  }
  if (error instanceof TelegramError) {
    if (error.kind === "fatal") {
      return {
        kind: "fatal",
        error: new UnrecoverableError(error.message),
      };
    }
    if (error.kind === "rate_limited") {
      // Pause first, then signal: the queue-level pause is what stops other jobs from
      // hitting the same limit; the RateLimitError just returns this job to waiting.
      try {
        await deps.queue.rateLimit(error.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS);
        return { kind: "rate_limited", error: new RateLimitError() };
      } catch (rateLimitError) {
        // Couldn't pause the queue (e.g. Redis blip): fall back to a normal retry.
        return { kind: "retryable", error: toError(rateLimitError) };
      }
    }
  }
  return { kind: "retryable", error: toError(error) };
}

async function markFailedSafely(
  store: MessageStore,
  messageId: string,
  reason: string,
  log: Logger,
  context: JobContext,
): Promise<void> {
  try {
    await store.markFailed(messageId, reason);
  } catch (markError) {
    // Don't mask the original error; BullMQ still needs to see it.
    log.error("Could not mark message failed", {
      ...context,
      error: markError,
    });
  }
}

async function deliver(
  job: ProcessorJob,
  deps: ProcessorDeps,
  context: JobContext,
): Promise<void> {
  const { store, sendTelegram } = deps;
  const log = deps.logger ?? defaultLogger;
  const { messageId, content } = job.data;

  // user_name comes from the row (the job only carries id and content).
  const message = await store.getMessage(messageId);
  if (!message) {
    throw new UnrecoverableError(`Message ${messageId} not found`);
  }

  if (message.status === "completed") {
    log.info("Message already completed, skipping", context);
    return;
  }

  // Also runs on a retry that only needs to finish the database update, so the UI
  // shows "processing" again rather than a stale state.
  await store.markProcessing(messageId);

  // A previous attempt already sent to Telegram; only the database update is left.
  const sentBefore = readSentResult(job.progress);
  let telegramResult: unknown;
  if (sentBefore) {
    telegramResult = sentBefore.telegramResult;
  } else {
    telegramResult =
      (await sendTelegram(formatTelegramText(message.user_name, content))) ??
      null;
    // Recorded before touching the database so a retry can tell the send happened.
    // If this write fails right after a successful send, a retry re-sends (accepted
    // at-least-once window, see the spec).
    await job.updateProgress({ telegramResult });
  }

  await store.markCompleted(messageId, JSON.stringify(telegramResult ?? null));
  log.info("Message delivered to Telegram", context);
}

// Resolves when the message is delivered (or already was). Throws to hand control
// to BullMQ: UnrecoverableError = no retry, RateLimitError = back to waiting, any
// other error = retry with backoff.
export async function processTelegramJob(
  job: ProcessorJob,
  deps: ProcessorDeps,
): Promise<void> {
  const log = deps.logger ?? defaultLogger;
  const { messageId } = job.data;
  const context: JobContext = {
    jobId: job.id,
    messageId,
    attempt: job.attemptsMade + 1,
  };

  try {
    await deliver(job, deps, context);
  } catch (caught) {
    const { kind, error } = await classify(caught, deps);

    if (kind === "rate_limited") {
      // Never marks failed and doesn't use an attempt; the queue is paused.
      log.warn("Telegram rate limit, queue paused", {
        ...context,
        errorKind: kind,
        error: caught,
      });
      handledErrors.add(error);
      throw error;
    }

    // attemptsMade counts finished attempts, so this one is attemptsMade + 1. With no
    // attempts configured, the first failure is final.
    const maxAttempts = job.opts.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

    if (kind === "retryable" && !isFinalAttempt) {
      log.warn("Job attempt failed, will retry", {
        ...context,
        maxAttempts,
        errorKind: kind,
        error,
      });
      handledErrors.add(error);
      throw error;
    }

    // Telegram already has the message and only recording it failed. Marking the
    // row failed would show a delivered message as failed, so leave it "processing"
    // for reconciliation and let BullMQ record the job failure.
    if (kind === "retryable" && readSentResult(job.progress)) {
      log.error("Message delivered to Telegram but could not record completion", {
        ...context,
        maxAttempts,
        errorKind: kind,
        error,
      });
      handledErrors.add(error);
      throw error;
    }

    // Done retrying (fatal, unrecoverable or out of attempts): the row must not
    // stay "processing". Done here so it's deterministic; the worker's `failed`
    // handler is only a backstop for failures that never reach this code. The store
    // never overwrites a completed row.
    log.error("Job failed permanently", {
      ...context,
      maxAttempts,
      errorKind: kind,
      error,
    });
    await markFailedSafely(deps.store, messageId, error.message, log, context);
    handledErrors.add(error);
    throw error;
  }
}
