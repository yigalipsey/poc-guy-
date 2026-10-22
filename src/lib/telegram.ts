export type TelegramErrorKind = "retryable" | "rate_limited" | "fatal";

export class TelegramError extends Error {
  readonly kind: TelegramErrorKind;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    details: { kind: TelegramErrorKind; status?: number; retryAfterMs?: number },
  ) {
    super(message);
    this.name = "TelegramError";
    this.kind = details.kind;
    this.status = details.status;
    this.retryAfterMs = details.retryAfterMs;
  }
}

export type SendTelegramMessageArgs = {
  token: string;
  chatId: string | number;
  text: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_AFTER_MS = 5_000;

export function formatTelegramText(userName: string, content: string): string {
  return `${userName}: ${content}`;
}

type TelegramBody = {
  ok?: boolean;
  result?: unknown;
  description?: unknown;
  parameters?: { retry_after?: unknown };
};

function parseBody(raw: string): TelegramBody | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as TelegramBody)
      : undefined;
  } catch {
    return undefined;
  }
}

// Posts plain text (no parse_mode) and returns Telegram's `result`. Error
// messages never include the request URL, which embeds the bot token.
export async function sendTelegramMessage({
  token,
  chatId,
  text,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
}: SendTelegramMessageArgs): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  let raw: string;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: controller.signal,
    });
    raw = await response.text();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new TelegramError(`Telegram request timed out after ${timeoutMs}ms`, {
        kind: "retryable",
      });
    }
    const name = error instanceof Error ? error.name : "unknown error";
    throw new TelegramError(`Telegram request failed: ${name}`, {
      kind: "retryable",
    });
  } finally {
    clearTimeout(timer);
  }

  const body = parseBody(raw);
  const { status } = response;

  if (response.ok) {
    if (body?.ok === true) return body.result;
    throw new TelegramError(`Telegram returned an unexpected ${status} response`, {
      kind: "fatal",
      status,
    });
  }

  const description =
    typeof body?.description === "string" ? body.description : undefined;

  if (status === 429) {
    const retryAfter = Number(body?.parameters?.retry_after);
    const retryAfterMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : DEFAULT_RETRY_AFTER_MS;
    throw new TelegramError(
      `Telegram rate limit (429): ${description ?? "Too Many Requests"}`,
      { kind: "rate_limited", status, retryAfterMs },
    );
  }

  if (status >= 500) {
    throw new TelegramError(
      `Telegram server error (${status})${description ? `: ${description}` : ""}`,
      { kind: "retryable", status },
    );
  }

  throw new TelegramError(
    `Telegram error (${status}): ${description ?? "Unknown error"}`,
    { kind: "fatal", status },
  );
}
