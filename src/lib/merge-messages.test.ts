import { describe, expect, it } from "vitest";
import { mergeMessages } from "@/lib/merge-messages";
import type { MessageRow } from "@/lib/supabase";

function row(id: string, created_at: string, status = "pending"): MessageRow {
  return { id, created_at, user_name: "Ada", content: id, status, telegram_response: null };
}

describe("mergeMessages", () => {
  it("adds new rows and sorts oldest to newest", () => {
    const merged = mergeMessages(
      [row("b", "2026-01-01T00:00:02Z")],
      [row("c", "2026-01-01T00:00:03Z"), row("a", "2026-01-01T00:00:01Z")],
    );
    expect(merged.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("replaces an existing row with the same id", () => {
    const merged = mergeMessages(
      [row("a", "2026-01-01T00:00:01Z")],
      [row("a", "2026-01-01T00:00:01Z", "completed")],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe("completed");
  });
});
