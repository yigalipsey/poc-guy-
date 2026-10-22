import { describe, expect, it } from "vitest";
import { parseSendMessage } from "@/lib/send-message";

describe("parseSendMessage", () => {
  it("trims name and content", () => {
    expect(parseSendMessage({ user_name: "  Ada ", content: " hi \n" })).toEqual({
      ok: true,
      data: { user_name: "Ada", content: "hi" },
    });
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(parseSendMessage({ user_name: "   ", content: "hi" })).toEqual({
      ok: false,
      error: "Name is required",
    });
  });

  it("rejects a name over 50 characters", () => {
    const result = parseSendMessage({ user_name: "a".repeat(51), content: "hi" });
    expect(result.ok).toBe(false);
  });

  it("accepts a name of exactly 50 characters", () => {
    expect(
      parseSendMessage({ user_name: "a".repeat(50), content: "hi" }).ok,
    ).toBe(true);
  });

  it("rejects whitespace-only content", () => {
    expect(parseSendMessage({ user_name: "Ada", content: " \n " })).toEqual({
      ok: false,
      error: "Message is required",
    });
  });

  it("enforces the 4000 character content limit", () => {
    expect(parseSendMessage({ user_name: "Ada", content: "x".repeat(4000) }).ok).toBe(true);
    expect(parseSendMessage({ user_name: "Ada", content: "x".repeat(4001) }).ok).toBe(false);
  });

  it("rejects missing fields and non-object bodies", () => {
    expect(parseSendMessage({ content: "hi" }).ok).toBe(false);
    expect(parseSendMessage(null).ok).toBe(false);
    expect(parseSendMessage("hello").ok).toBe(false);
  });
});
