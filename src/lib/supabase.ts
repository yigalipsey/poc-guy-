// Typed Supabase clients (server/worker admin client and browser client) plus the
// shared message query, so the server render and the browser fetch the same rows.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import { requireEnv } from "@/lib/env";

export type AppSupabaseClient = SupabaseClient<Database>;
export type MessageRow = Tables<"messages">;

// Explicit column list, shared by the API insert and the list queries so every
// message row has the same shape.
export const MESSAGE_COLUMNS =
  "id, created_at, user_name, content, status, telegram_response" as const;
export const MESSAGES_PAGE_SIZE = 50;

// No session handling: the server has no user, and the browser only holds the
// read-only publishable key, so there is nothing to persist or refresh.
const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
};

let adminClient: AppSupabaseClient | undefined;

// Secret key: server and worker only. It bypasses RLS, so the window check guards
// against this being imported into client code by mistake. Created on first use
// because env vars are read at call time.
export function getAdminClient(): AppSupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("The Supabase admin client must not be created in a browser");
  }
  adminClient ??= createClient<Database>(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SECRET_KEY"),
    clientOptions,
  );
  return adminClient;
}

// URL and publishable key are passed in from the server at request time (as props)
// rather than NEXT_PUBLIC_* vars, which would be baked in at build time. RLS only
// allows this key to read.
export function createBrowserClient(
  url: string,
  publishableKey: string,
): AppSupabaseClient {
  return createClient<Database>(url, publishableKey, clientOptions);
}

// Latest page of messages, oldest first. Queried newest-first so limit() keeps the
// most recent rows, then reversed for display.
export async function fetchRecentMessages(
  client: AppSupabaseClient,
): Promise<MessageRow[]> {
  const { data, error } = await client
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(MESSAGES_PAGE_SIZE);
  if (error) {
    throw new Error(`Failed to fetch messages: ${error.message}`);
  }
  return data.reverse();
}
