type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  return value;
}

function write(level: Level, message: string, fields: Fields = {}): void {
  const line = JSON.stringify(
    { ...fields, level, time: new Date().toISOString(), message },
    replacer,
  );
  (level === "error" ? process.stderr : process.stdout).write(`${line}\n`);
}

// Never pass secrets (bot token, keys) as fields.
export const logger = {
  info: (message: string, fields?: Fields) => write("info", message, fields),
  warn: (message: string, fields?: Fields) => write("warn", message, fields),
  error: (message: string, fields?: Fields) => write("error", message, fields),
};

export type Logger = typeof logger;
