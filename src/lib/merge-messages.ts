import type { MessageRow } from "@/lib/supabase";

// Merges chat rows from every source (server render, POST response, Realtime events)
// into one list: upsert by id, sorted oldest to newest. Last write wins, with no
// guard on status, so a late event can currently overwrite a newer status.
export function mergeMessages(
  current: MessageRow[],
  incoming: MessageRow[],
): MessageRow[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    byId.set(message.id, message);
  }
  // id breaks ties so rows with the same created_at keep a stable order.
  return [...byId.values()].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
}
