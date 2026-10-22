import { RateLimitError, UnrecoverableError } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { TelegramError, sendTelegramMessage } from "@/lib/telegram";
import {
  processTelegramJob,
  type MessageStore,
  type ProcessorJob,
  type StoredMessage,
} from "./processor";

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// In-memory message store that records every status transition. Like the real
// store, markProcessing and markFailed never overwrite a completed row.
// `failures` makes the next N calls of an operation throw.
function createFakeStore(rows: StoredMessage[]) {
  const byId = new Map(rows.map((row) => [row.id, { ...row }]));
  const responses = new Map<string, string>();
  const transitions: string[] = [];
  const failures: Partial<Record<keyof MessageStore, number>> = {};
  const maybeFail = (operation: keyof MessageStore) => {
    const remaining = failures[operation] ?? 0;
    if (remaining > 0) {
      failures[operation] = remaining - 1;
      throw new Error(`${operation} database error`);
    }
  };
  const store: MessageStore = {
    async getMessage(id) {
      maybeFail("getMessage");
      return byId.get(id) ?? null;
    },
    async markProcessing(id) {
      maybeFail("markProcessing");
      const row = byId.get(id);
      if (!row || row.status === "completed") return;
      row.status = "processing";
      transitions.push("processing");
    },
    async markCompleted(id, telegramResponse) {
      maybeFail("markCompleted");
      byId.get(id)!.status = "completed";
      responses.set(id, telegramResponse);
      transitions.push("completed");
    },
    async markFailed(id, error) {
      maybeFail("markFailed");
      const row = byId.get(id);
      if (!row || row.status === "completed") return;
      row.status = "failed";
      responses.set(id, error);
      transitions.push("failed");
    },
  };
  return { store, byId, responses, transitions, failures };
}

function createFakeJob(
  data: { messageId: string; content: string },
  overrides: Partial<ProcessorJob> = {},
) {
  const job: ProcessorJob & { progressHistory: object[] } = {
    id: "job-1",
    data,
    progress: 0,
    attemptsMade: 0,
    opts: { attempts: 5 },
    progressHistory: [],
    async updateProgress(progress) {
      job.progress = progress;
      job.progressHistory.push(progress);
    },
    ...overrides,
  };
  return job;
}

describe("processTelegramJob happy path", () => {
  it("goes pending -> processing -> completed and stores the Telegram result", async () => {
    const fake = createFakeStore([
      { id: "m1", status: "pending", user_name: "Ada" },
    ]);
    const telegramResult = { message_id: 42, text: "Ada: hello there" };
    const sendTelegram = vi.fn(async () => telegramResult);
    const rateLimit = vi.fn(async () => {});
    const job = createFakeJob({ messageId: "m1", content: "hello there" });

    await processTelegramJob(job, {
      store: fake.store,
      sendTelegram,
      queue: { rateLimit },
      logger: silentLogger,
    });

    expect(sendTelegram).toHaveBeenCalledExactlyOnceWith("Ada: hello there");
    expect(fake.transitions).toEqual(["processing", "completed"]);
    expect(fake.byId.get("m1")!.status).toBe("completed");
    expect(fake.responses.get("m1")).toBe(JSON.stringify(telegramResult));
    expect(job.progress).toEqual({ telegramResult });
    expect(rateLimit).not.toHaveBeenCalled();
  });
});

describe("processTelegramJob idempotent redelivery", () => {
  it("does not send again when the message is already completed", async () => {
    const fake = createFakeStore([
      { id: "m1", status: "completed", user_name: "Ada" },
    ]);
    const sendTelegram = vi.fn(async () => ({ message_id: 42 }));
    const job = createFakeJob({ messageId: "m1", content: "hello there" });

    await processTelegramJob(job, {
      store: fake.store,
      sendTelegram,
      queue: { rateLimit: vi.fn(async () => {}) },
      logger: silentLogger,
    });

    expect(sendTelegram).not.toHaveBeenCalled();
    expect(fake.transitions).toEqual([]);
    expect(fake.byId.get("m1")!.status).toBe("completed");
  });

  it("does not re-send on retry when the job progress holds the Telegram result", async () => {
    const fake = createFakeStore([
      { id: "m1", status: "processing", user_name: "Ada" },
    ]);
    const telegramResult = { message_id: 42, text: "Ada: hello there" };
    const sendTelegram = vi.fn(async () => ({ message_id: 99 }));
    const job = createFakeJob(
      { messageId: "m1", content: "hello there" },
      { progress: { telegramResult }, attemptsMade: 1 },
    );

    await processTelegramJob(job, {
      store: fake.store,
      sendTelegram,
      queue: { rateLimit: vi.fn(async () => {}) },
      logger: silentLogger,
    });

    expect(sendTelegram).not.toHaveBeenCalled();
    expect(fake.byId.get("m1")!.status).toBe("completed");
    expect(fake.responses.get("m1")).toBe(JSON.stringify(telegramResult));
  });
});

function setup(
  rows: StoredMessage[] = [{ id: "m1", status: "pending", user_name: "Ada" }],
) {
  const fake = createFakeStore(rows);
  const rateLimit = vi.fn<(expireTimeMs: number) => Promise<void>>(async () => {});
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const run = (
    job: ProcessorJob,
    sendTelegram: (text: string) => Promise<unknown>,
  ) =>
    processTelegramJob(job, {
      store: fake.store,
      sendTelegram,
      queue: { rateLimit },
      logger,
    });
  return { fake, rateLimit, logger, run };
}

const data = { messageId: "m1", content: "hello there" };

describe("processTelegramJob failed completion update", () => {
  it("rethrows when saving the result fails, and the retry only saves without re-sending", async () => {
    const { fake, run } = setup();
    fake.failures.markCompleted = 1;
    const telegramResult = { message_id: 42 };
    const sendTelegram = vi.fn(async () => telegramResult);
    const job = createFakeJob(data);

    await expect(run(job, sendTelegram)).rejects.toThrow(
      "markCompleted database error",
    );
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(fake.byId.get("m1")!.status).toBe("processing");
    expect(job.progress).toEqual({ telegramResult });

    // BullMQ runs the retry on the same job: attemptsMade went up, progress kept.
    job.attemptsMade = 1;
    await run(job, sendTelegram);

    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(fake.byId.get("m1")!.status).toBe("completed");
    expect(fake.responses.get("m1")).toBe(JSON.stringify(telegramResult));
  });
});

describe("processTelegramJob delivered but completion not recorded", () => {
  const expectLeftProcessing = async (
    job: ReturnType<typeof createFakeJob>,
    sendTelegram: (text: string) => Promise<unknown>,
  ) => {
    const { fake, run, logger } = setup();
    fake.failures.markCompleted = 1;
    const markFailed = vi.spyOn(fake.store, "markFailed");

    const error = await run(job, sendTelegram).catch((e) => e);

    expect(error.message).toBe("markCompleted database error");
    expect(markFailed).not.toHaveBeenCalled();
    expect(fake.byId.get("m1")!.status).toBe("processing");
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      "Message delivered to Telegram but could not record completion",
      expect.objectContaining({ jobId: "job-1", messageId: "m1", attempt: 5 }),
    );
    return { error, sendTelegram };
  };

  it("does not mark failed on the final attempt when the send just succeeded", async () => {
    const sendTelegram = vi.fn(async () => ({ message_id: 42 }));
    const job = createFakeJob(data, { attemptsMade: 4 });

    await expectLeftProcessing(job, sendTelegram);

    expect(sendTelegram).toHaveBeenCalledTimes(1);
  });

  it("does not mark failed on the final attempt when a sent-once marker exists", async () => {
    const sendTelegram = vi.fn(async () => ({ message_id: 99 }));
    const job = createFakeJob(data, {
      attemptsMade: 4,
      progress: { telegramResult: { message_id: 42 } },
    });

    await expectLeftProcessing(job, sendTelegram);

    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("stays a plain retry on a non-final attempt", async () => {
    const { fake, run, logger } = setup();
    fake.failures.markCompleted = 1;
    const job = createFakeJob(data, { attemptsMade: 1 });

    await expect(run(job, async () => ({ message_id: 42 }))).rejects.toThrow(
      "markCompleted database error",
    );

    expect(fake.byId.get("m1")!.status).toBe("processing");
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      "Job attempt failed, will retry",
      expect.objectContaining({ attempt: 2 }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("processTelegramJob empty Telegram result", () => {
  it("stores null as the sent marker so a retry does not re-send", async () => {
    const { fake, run } = setup();
    fake.failures.markCompleted = 1;
    const sendTelegram = vi.fn(async () => undefined);
    const job = createFakeJob(data);

    await expect(run(job, sendTelegram)).rejects.toThrow(
      "markCompleted database error",
    );
    expect(job.progress).toEqual({ telegramResult: null });

    // Redis persists progress as JSON, so retry with a round-tripped copy.
    job.progress = JSON.parse(JSON.stringify(job.progress));
    job.attemptsMade = 1;
    await run(job, sendTelegram);

    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(fake.byId.get("m1")!.status).toBe("completed");
    expect(fake.responses.get("m1")).toBe("null");
  });
});

describe("processTelegramJob fatal errors", () => {
  it("throws an unrecoverable error and marks the row failed on the first attempt", async () => {
    const { fake, run } = setup();
    const sendTelegram = vi.fn(async () => {
      throw new TelegramError("Telegram error (400): Bad Request: chat not found", {
        kind: "fatal",
        status: 400,
      });
    });

    const error = await run(createFakeJob(data), sendTelegram).catch((e) => e);

    expect(error).toBeInstanceOf(UnrecoverableError);
    expect(fake.byId.get("m1")!.status).toBe("failed");
    expect(fake.responses.get("m1")).toBe(
      "Telegram error (400): Bad Request: chat not found",
    );
    expect(fake.transitions).toEqual(["processing", "failed"]);
  });
});

describe("processTelegramJob retryable errors", () => {
  const transient = () =>
    new TelegramError("Telegram server error (502)", {
      kind: "retryable",
      status: 502,
    });

  it("rethrows without marking failed on a non-final attempt", async () => {
    const { fake, run, logger } = setup();
    const job = createFakeJob(data, { attemptsMade: 2 });

    const error = await run(job, async () => {
      throw transient();
    }).catch((e) => e);

    expect(error).toBeInstanceOf(TelegramError);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
    expect(fake.byId.get("m1")!.status).toBe("processing");
    expect(fake.transitions).toEqual(["processing"]);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      "Job attempt failed, will retry",
      expect.objectContaining({
        jobId: "job-1",
        messageId: "m1",
        attempt: 3,
        errorKind: "retryable",
      }),
    );
  });

  it("marks the row failed with the last error on the final attempt", async () => {
    const { fake, run } = setup();
    const job = createFakeJob(data, { attemptsMade: 4 });

    await expect(
      run(job, async () => {
        throw transient();
      }),
    ).rejects.toBeInstanceOf(TelegramError);

    expect(fake.byId.get("m1")!.status).toBe("failed");
    expect(fake.responses.get("m1")).toBe("Telegram server error (502)");
  });

  it("completes when a later attempt succeeds", async () => {
    const { fake, run } = setup();
    const sendTelegram = vi
      .fn()
      .mockRejectedValueOnce(transient())
      .mockResolvedValueOnce({ message_id: 7 });
    const job = createFakeJob(data);

    await expect(run(job, sendTelegram)).rejects.toBeInstanceOf(TelegramError);
    job.attemptsMade = 1;
    await run(job, sendTelegram);

    expect(fake.byId.get("m1")!.status).toBe("completed");
    expect(sendTelegram).toHaveBeenCalledTimes(2);
  });

  it("treats a single-attempt job as final", async () => {
    const { fake, run } = setup();
    const job = createFakeJob(data, { opts: {} });

    await expect(
      run(job, async () => {
        throw transient();
      }),
    ).rejects.toBeInstanceOf(TelegramError);

    expect(fake.byId.get("m1")!.status).toBe("failed");
  });

  it("still throws the original error when marking failed also fails", async () => {
    const { fake, run, logger } = setup();
    fake.failures.markFailed = 1;
    const job = createFakeJob(data, { attemptsMade: 4 });

    const error = await run(job, async () => {
      throw transient();
    }).catch((e) => e);

    expect(error).toBeInstanceOf(TelegramError);
    expect(logger.error).toHaveBeenCalledWith(
      "Could not mark message failed",
      expect.anything(),
    );
  });
});

describe("processTelegramJob rate limiting", () => {
  it("pauses the queue for retryAfterMs, throws the rate-limit signal and never marks failed", async () => {
    const { fake, rateLimit, run } = setup();
    // Even on the final attempt, rate limiting alone never fails a message.
    const job = createFakeJob(data, { attemptsMade: 4 });

    const error = await run(job, async () => {
      throw new TelegramError("Telegram rate limit (429): Too Many Requests", {
        kind: "rate_limited",
        status: 429,
        retryAfterMs: 7000,
      });
    }).catch((e) => e);

    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.message).toBe("bullmq:rateLimitExceeded");
    expect(rateLimit).toHaveBeenCalledExactlyOnceWith(7000);
    expect(fake.byId.get("m1")!.status).toBe("processing");
    expect(fake.transitions).not.toContain("failed");
  });

  it("falls back to a normal retry when the queue cannot be paused", async () => {
    const { fake, rateLimit, run } = setup();
    rateLimit.mockRejectedValueOnce(new Error("redis down"));
    const job = createFakeJob(data, { attemptsMade: 4 });

    const error = await run(job, async () => {
      throw new TelegramError("Telegram rate limit (429)", {
        kind: "rate_limited",
        retryAfterMs: 1000,
      });
    }).catch((e) => e);

    expect(error.message).toBe("redis down");
    expect(fake.byId.get("m1")!.status).toBe("failed");
  });
});

describe("processTelegramJob missing row and database read errors", () => {
  it("fails as unrecoverable when the row does not exist", async () => {
    const { run } = setup([]);
    const sendTelegram = vi.fn(async () => ({}));

    await expect(run(createFakeJob(data), sendTelegram)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("treats a database read error as retryable", async () => {
    const { fake, run } = setup();
    fake.failures.getMessage = 1;
    const sendTelegram = vi.fn(async () => ({}));

    const error = await run(createFakeJob(data), sendTelegram).catch((e) => e);

    expect(error).not.toBeInstanceOf(UnrecoverableError);
    expect(error.message).toBe("getMessage database error");
    expect(fake.byId.get("m1")!.status).toBe("pending");
    expect(sendTelegram).not.toHaveBeenCalled();
  });
});

describe("processTelegramJob never overwrites a completed row", () => {
  it("leaves a row completed by someone else untouched when the job then fails", async () => {
    const { fake, run } = setup();
    const job = createFakeJob(data);

    await expect(
      run(job, async () => {
        // Another delivery completes the row while this send is in flight.
        fake.byId.get("m1")!.status = "completed";
        throw new TelegramError("Telegram error (403): bot was blocked", {
          kind: "fatal",
          status: 403,
        });
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(fake.byId.get("m1")!.status).toBe("completed");
    expect(fake.responses.has("m1")).toBe(false);
  });
});

describe("processTelegramJob secrets", () => {
  it("never leaks the bot token into logs or the stored error", async () => {
    const token = "123456:SECRET-TOKEN";
    const { fake, run, logger } = setup();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      throw new TypeError(`fetch failed for ${String(url)}`);
    }) as unknown as typeof fetch;
    const sendTelegram = (text: string) =>
      sendTelegramMessage({ token, chatId: "1", text, fetchImpl });

    await run(createFakeJob(data, { attemptsMade: 4 }), sendTelegram).catch(
      () => {},
    );

    const everything = JSON.stringify([
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.error.mock.calls,
      [...fake.responses.values()],
    ]);
    expect(fake.byId.get("m1")!.status).toBe("failed");
    expect(everything).not.toContain(token);
    expect(everything).not.toContain("SECRET-TOKEN");
  });
});
