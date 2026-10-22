import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import { requireEnv } from "@/lib/env";

export type AppSupabaseClient = SupabaseClient<Database>;
export type MessageRow = Tables<"messages">;

export const MESSAGE_COLUMNS =
  "id, created_at, user_name, content, status, telegram_response" as const;
export const MESSAGES_PAGE_SIZE = 50;

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
};

let adminClient: AppSupabaseClient | undefined;

// Secret key: server and worker only.
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

// URL and publishable key are passed in from the server at request time.
export function createBrowserClient(
  url: string,
  publishableKey: string,
): AppSupabaseClient {
  return createClient<Database>(url, publishableKey, clientOptions);
}

// Latest page of messages, oldest first.
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
