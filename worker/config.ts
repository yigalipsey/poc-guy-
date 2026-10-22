// Startup configuration check for the worker process (never imported by Next).
import { MissingEnvError, requireEnv } from "@/lib/env";

// Includes variables that other modules read lazily (Supabase, Redis) so that a
// missing one stops the worker at startup instead of failing the first job.
export const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "REDIS_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
] as const;

// Only the Telegram settings are returned; the other modules read their own vars.
export type WorkerConfig = {
  telegramBotToken: string;
  telegramChatId: string;
};

// Fails fast, naming every missing variable at once.
export function loadWorkerConfig(
  env: Record<string, string | undefined> = process.env,
): WorkerConfig {
  const missing: string[] = [];
  for (const name of REQUIRED_ENV) {
    try {
      requireEnv(name, env);
    } catch (error) {
      if (!(error instanceof MissingEnvError)) throw error;
      missing.push(error.variable);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }
  return {
    telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN", env),
    telegramChatId: requireEnv("TELEGRAM_CHAT_ID", env),
  };
}
