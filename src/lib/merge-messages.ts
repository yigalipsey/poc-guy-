import type { MessageRow } from "@/lib/supabase";

// Upserts incoming rows by id and keeps the list sorted oldest to newest.
// Ticket 05 makes this monotonic by status rank.
export function mergeMessages(
  current: MessageRow[],
  incoming: MessageRow[],
): MessageRow[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    byId.set(message.id, message);
  }
  return [...byId.values()].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
}
