import type { AppSupabaseClient } from "@/lib/supabase";
import type { MessageStore } from "./processor";

function check(error: { message: string } | null, action: string): void {
  if (error) throw new Error(`Failed to ${action}: ${error.message}`);
}

// markProcessing and markFailed never overwrite a completed row; markCompleted
// is unguarded.
export function createSupabaseMessageStore(
  client: AppSupabaseClient,
): MessageStore {
  return {
    async getMessage(id) {
      const { data, error } = await client
        .from("messages")
        .select("id, status, user_name")
        .eq("id", id)
        .maybeSingle();
      check(error, "load message");
      return data;
    },

    async markProcessing(id) {
      const { error } = await client
        .from("messages")
        .update({ status: "processing" })
        .eq("id", id)
        .neq("status", "completed");
      check(error, "mark message processing");
    },

    async markCompleted(id, telegramResponse) {
      const { error } = await client
        .from("messages")
        .update({ status: "completed", telegram_response: telegramResponse })
        .eq("id", id);
      check(error, "mark message completed");
    },

    async markFailed(id, errorMessage) {
      const { error } = await client
        .from("messages")
        .update({ status: "failed", telegram_response: errorMessage })
        .eq("id", id)
        .neq("status", "completed");
      check(error, "mark message failed");
    },
  };
}
