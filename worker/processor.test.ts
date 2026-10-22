import { describe, expect, it, vi } from "vitest";
import {
  processTelegramJob,
  type MessageStore,
  type ProcessorJob,
  type StoredMessage,
} from "./processor";

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// In-memory message store that records every status transition.
function createFakeStore(rows: StoredMessage[]) {
  const byId = new Map(rows.map((row) => [row.id, { ...row }]));
  const responses = new Map<string, string>();
  const transitions: string[] = [];
  const store: MessageStore = {
    async getMessage(id) {
      return byId.get(id) ?? null;
    },
    async markProcessing(id) {
      byId.get(id)!.status = "processing";
      transitions.push("processing");
    },
    async markCompleted(id, telegramResponse) {
      byId.get(id)!.status = "completed";
      responses.set(id, telegramResponse);
      transitions.push("completed");
    },
    async markFailed(id, error) {
      byId.get(id)!.status = "failed";
      responses.set(id, error);
      transitions.push("failed");
    },
  };
  return { store, byId, responses, transitions };
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
