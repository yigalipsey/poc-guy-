import { UnrecoverableError } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { TelegramError } from "@/lib/telegram";
import { handleJobFailed, type FailedJob } from "./failed-handler";
import { processTelegramJob } from "./processor";

function setup(overrides: Partial<FailedJob> = {}) {
  const markFailed = vi.fn<(id: string, error: string) => Promise<void>>(
    async () => {},
  );
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const job: FailedJob = {
    id: "job-1",
    data: { messageId: "m1" },
    attemptsMade: 1,
    opts: { attempts: 5 },
    ...overrides,
  };
  const run = (error: Error, target: FailedJob | null = job) =>
    handleJobFailed(target ?? undefined, error, { store: { markFailed }, logger });
  return { markFailed, logger, run };
}

describe("handleJobFailed backstop", () => {
  it("marks the row failed when BullMQ fails a stalled job without running the processor", async () => {
    const { markFailed, logger, run } = setup({
      attemptsMade: 2,
      finishedOn: Date.now(),
    });

    await run(new UnrecoverableError("job stalled more than allowable limit"));

    expect(markFailed).toHaveBeenCalledExactlyOnceWith(
      "m1",
      "job stalled more than allowable limit",
    );
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      "Job failed without the processor handling it",
      expect.objectContaining({
        jobId: "job-1",
        messageId: "m1",
        errorKind: "unrecoverable",
      }),
    );
  });

  it("marks failed when attempts are used up even without finishedOn", async () => {
    const { markFailed, run } = setup({ attemptsMade: 5 });

    await run(new Error("boom"));

    expect(markFailed).toHaveBeenCalledExactlyOnceWith("m1", "boom");
  });

  it("does nothing for a retryable intermediate failure", async () => {
    const { markFailed, logger, run } = setup({ attemptsMade: 2 });

    await run(new Error("Telegram server error (502)"));

    expect(markFailed).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("does nothing when there is no job", async () => {
    const { markFailed, run } = setup();

    await run(new UnrecoverableError("gone"), null);

    expect(markFailed).not.toHaveBeenCalled();
  });

  it("swallows and logs a failing markFailed", async () => {
    const { markFailed, logger, run } = setup({ finishedOn: Date.now() });
    markFailed.mockRejectedValueOnce(new Error("db down"));

    await expect(
      run(new UnrecoverableError("job stalled more than allowable limit")),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      "Could not mark message failed",
      expect.objectContaining({ messageId: "m1" }),
    );
  });

  it("stays silent for errors the processor already logged and marked", async () => {
    const { markFailed, logger, run } = setup({
      attemptsMade: 1,
      finishedOn: Date.now(),
    });
    const processorLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const error = await processTelegramJob(
      {
        id: "job-1",
        data: { messageId: "m1", content: "hi" },
        progress: 0,
        attemptsMade: 0,
        opts: { attempts: 5 },
        updateProgress: async () => {},
      },
      {
        store: {
          getMessage: async () => ({ id: "m1", status: "pending", user_name: "Ada" }),
          markProcessing: async () => {},
          markCompleted: async () => {},
          markFailed: async () => {},
        },
        sendTelegram: async () => {
          throw new TelegramError("Telegram error (403)", {
            kind: "fatal",
            status: 403,
          });
        },
        queue: { rateLimit: async () => {} },
        logger: processorLogger,
      },
    ).catch((e) => e);
    await run(error);

    expect(markFailed).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
