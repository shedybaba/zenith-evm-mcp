import { describe, expect, it } from "vitest";
import { RateLimiter } from "../../src/core/limiter.js";
import { toJsonSafe } from "../../src/core/json.js";

describe("RateLimiter", () => {
  it("never runs more than maxConcurrent calls at once", async () => {
    const limiter = new RateLimiter({ maxPerWindow: 100, windowMs: 1000, maxConcurrent: 2 });
    let running = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        limiter.run(async () => {
          running++;
          peak = Math.max(peak, running);
          await new Promise((r) => setTimeout(r, 10));
          running--;
        }),
      ),
    );
    expect(peak).toBe(2);
  });

  it("spreads calls across windows instead of failing", async () => {
    const limiter = new RateLimiter({ maxPerWindow: 3, windowMs: 150, maxConcurrent: 10 });
    const start = Date.now();
    await Promise.all(Array.from({ length: 6 }, () => limiter.run(async () => undefined)));
    expect(Date.now() - start).toBeGreaterThanOrEqual(140);
  });

  it("keeps working after a call throws", async () => {
    const limiter = new RateLimiter({ maxPerWindow: 10, windowMs: 1000, maxConcurrent: 1 });
    await expect(limiter.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    await expect(limiter.run(async () => 42)).resolves.toBe(42);
  });
});

describe("toJsonSafe", () => {
  it("turns bigints into strings and drops undefined", () => {
    expect(toJsonSafe({ a: 1n, b: undefined, c: [2n], d: { e: 3n } })).toEqual({
      a: "1",
      c: ["2"],
      d: { e: "3" },
    });
  });
});
