// Supabase-backed MessageStore used by the worker (implements the interface the
// processor depends on, so the processor itself can be tested without a database).
import type { AppSupabaseClient } from "@/lib/supabase";
import type { MessageStore } from "./processor";

// supabase-js returns errors instead of throwing; rethrow so BullMQ sees the failure.
function check(error: { message: string } | null, action: string): void {
  if (error) throw new Error(`Failed to ${action}: ${error.message}`);
}

// markProcessing and markFailed never overwrite a completed row (the .neq filter
// makes them a no-op, not an error), so a redelivered or late job can't undo a
// delivery. markCompleted is unguarded: once Telegram accepted the message,
// completed is the truth.
export function createSupabaseMessageStore(
  client: AppSupabaseClient,
): MessageStore {
  return {
    async getMessage(id) {
      const { data, error } = await client
        .from("messages")
        // maybeSingle: a missing row is null (the processor treats it as unrecoverable),
        // not an error.
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
