// Structured logger used by both the web app and the worker: one JSON object per
// line, which is what Coolify's log view and any log shipper expect.
type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

// JSON.stringify turns an Error into `{}`; keep only name and message. Dropping the
// stack and cause also keeps request details out of the logs.
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  return value;
}

function write(level: Level, message: string, fields: Fields = {}): void {
  // Reserved keys come last so a caller's fields can't overwrite level/time/message.
  const line = JSON.stringify(
    { ...fields, level, time: new Date().toISOString(), message },
    replacer,
  );
  // Errors go to stderr, everything else to stdout, so the platform can tell them apart.
  (level === "error" ? process.stderr : process.stdout).write(`${line}\n`);
}

// Never pass secrets (bot token, keys) as fields.
export const logger = {
  info: (message: string, fields?: Fields) => write("info", message, fields),
  warn: (message: string, fields?: Fields) => write("warn", message, fields),
  error: (message: string, fields?: Fields) => write("error", message, fields),
};

export type Logger = typeof logger;
