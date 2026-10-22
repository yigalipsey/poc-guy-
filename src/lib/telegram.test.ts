import { describe, expect, it, vi } from "vitest";
import {
  TelegramError,
  formatTelegramText,
  sendTelegramMessage,
} from "./telegram";

const TOKEN = "123456:SECRET-TOKEN";
const base = { token: TOKEN, chatId: "-100500", text: "Ada: hello" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

async function failureOf(promise: Promise<unknown>): Promise<TelegramError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(TelegramError);
    return error as TelegramError;
  }
  throw new Error("expected the send to fail");
}

describe("sendTelegramMessage", () => {
  it("returns result and posts the expected request", async () => {
    const result = { message_id: 7, text: "Ada: hello" };
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true, result }));

    await expect(sendTelegramMessage({ ...base, fetchImpl })).resolves.toEqual(
      result,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      chat_id: "-100500",
      text: "Ada: hello",
    });
  });

  it("treats 429 as rate_limited and honors retry_after", async () => {
    const fetchImpl = async () =>
      jsonResponse(
        {
          ok: false,
          description: "Too Many Requests",
          parameters: { retry_after: 12 },
        },
        429,
      );
    const error = await failureOf(sendTelegramMessage({ ...base, fetchImpl }));
    expect(error.kind).toBe("rate_limited");
    expect(error.status).toBe(429);
    expect(error.retryAfterMs).toBe(12_000);
  });

  it("defaults retry_after to 5s when absent", async () => {
    const fetchImpl = async () => jsonResponse({ ok: false }, 429);
    const error = await failureOf(sendTelegramMessage({ ...base, fetchImpl }));
    expect(error.kind).toBe("rate_limited");
    expect(error.retryAfterMs).toBe(5_000);
  });

  it("treats 5xx as retryable, including non-JSON bodies", async () => {
    const withJson = await failureOf(
      sendTelegramMessage({
        ...base,
        fetchImpl: async () => jsonResponse({ ok: false }, 502),
      }),
    );
    expect(withJson.kind).toBe("retryable");
    expect(withJson.status).toBe(502);

    const html = await failureOf(
      sendTelegramMessage({
        ...base,
        fetchImpl: async () => new Response("<html>Bad Gateway</html>", { status: 503 }),
      }),
    );
    expect(html.kind).toBe("retryable");
    expect(html.status).toBe(503);
  });

  it.each([
    [400, "Bad Request: chat not found"],
    [401, "Unauthorized"],
    [403, "Forbidden: bot was blocked by the user"],
    [404, "Not Found"],
  ])("treats %i as fatal and includes Telegram's description", async (status, description) => {
    const fetchImpl = async () =>
      jsonResponse({ ok: false, error_code: status, description }, status);
    const error = await failureOf(sendTelegramMessage({ ...base, fetchImpl }));
    expect(error.kind).toBe("fatal");
    expect(error.status).toBe(status);
    expect(error.message).toContain(description);
  });

  it("treats a network failure as retryable and never leaks the token", async () => {
    const fetchImpl = async () => {
      throw new TypeError(
        `fetch failed: https://api.telegram.org/bot${TOKEN}/sendMessage`,
      );
    };
    const error = await failureOf(sendTelegramMessage({ ...base, fetchImpl }));
    expect(error.kind).toBe("retryable");
    expect(error.message).not.toContain(TOKEN);
  });

  it("treats a timeout as retryable", async () => {
    const fetchImpl = (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    const error = await failureOf(
      sendTelegramMessage({ ...base, fetchImpl, timeoutMs: 20 }),
    );
    expect(error.kind).toBe("retryable");
    expect(error.message).not.toContain(TOKEN);
  });
});

describe("formatTelegramText", () => {
  it("formats plain 'name: content'", () => {
    expect(formatTelegramText("Ada", "hi <b>there</b> *x*")).toBe(
      "Ada: hi <b>there</b> *x*",
    );
  });
});
