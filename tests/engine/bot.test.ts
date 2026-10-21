import { describe, expect, it } from "vitest";
import { playRun } from "../../src/bot/bot";
import { newRun } from "../../src/engine/run";

describe("the balance bot", () => {
  it("plays whole descents to an end, win or lose, without getting stuck", () => {
    for (const seed of [3, 11]) {
      const outcome = playRun(seed, newRun(seed));
      expect(outcome.result).not.toBe("stalled");
      expect(outcome.depth).toBeGreaterThan(1);
    }
  }, 60_000);
});
