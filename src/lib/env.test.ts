import { describe, expect, it } from "vitest";
import { MissingEnvError, requireEnv } from "./env";

describe("requireEnv", () => {
  it("returns the value when set", () => {
    expect(requireEnv("REDIS_URL", { REDIS_URL: "redis://x" })).toBe("redis://x");
  });

  it("throws a named error naming the missing variable", () => {
    expect(() => requireEnv("REDIS_URL", {})).toThrow(MissingEnvError);
    expect(() => requireEnv("REDIS_URL", { REDIS_URL: " " })).toThrow(
      /REDIS_URL/,
    );
  });
});
