import { describe, expect, it } from "vitest";
import type { AppSupabaseClient } from "@/lib/supabase";
import { createSupabaseMessageStore } from "./message-store";

type Row = { id: string; status: string; user_name: string; telegram_response: string | null };

// Minimal in-memory stand-in for the slice of the Supabase query builder the
// store uses: update/select + eq/neq filters, resolved when awaited.
function createFakeClient(rows: Row[]) {
  const table = new Map(rows.map((row) => [row.id, { ...row }]));
  const client = {
    from() {
      let patch: Partial<Row> | null = null;
      const filters: Array<(row: Row) => boolean> = [];
      const matching = () =>
        [...table.values()].filter((row) => filters.every((f) => f(row)));
      const builder = {
        select: () => builder,
        update(values: Partial<Row>) {
          patch = values;
          return builder;
        },
        eq(column: keyof Row, value: unknown) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        neq(column: keyof Row, value: unknown) {
          filters.push((row) => row[column] !== value);
          return builder;
        },
        async maybeSingle() {
          return { data: matching()[0] ?? null, error: null };
        },
        then(resolve: (value: { error: null }) => void) {
          if (patch) matching().forEach((row) => Object.assign(row, patch));
          resolve({ error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as AppSupabaseClient, table };
}

describe("createSupabaseMessageStore", () => {
  const completed: Row = {
    id: "m1",
    status: "completed",
    user_name: "Ada",
    telegram_response: '{"message_id":1}',
  };

  it("markFailed never overwrites a completed row", async () => {
    const { client, table } = createFakeClient([completed]);
    await createSupabaseMessageStore(client).markFailed("m1", "boom");
    expect(table.get("m1")).toEqual(completed);
  });

  it("markProcessing never overwrites a completed row", async () => {
    const { client, table } = createFakeClient([completed]);
    await createSupabaseMessageStore(client).markProcessing("m1");
    expect(table.get("m1")).toEqual(completed);
  });

  it("markFailed and markProcessing do update rows that are not completed", async () => {
    const { client, table } = createFakeClient([
      { id: "m1", status: "pending", user_name: "Ada", telegram_response: null },
    ]);
    const store = createSupabaseMessageStore(client);
    await store.markProcessing("m1");
    expect(table.get("m1")!.status).toBe("processing");
    await store.markFailed("m1", "boom");
    expect(table.get("m1")).toMatchObject({
      status: "failed",
      telegram_response: "boom",
    });
  });
});
