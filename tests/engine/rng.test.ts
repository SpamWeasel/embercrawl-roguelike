import { describe, expect, it } from "vitest";
import { Rng } from "../../src/engine/rng";

const take = (rng: Rng, count: number) => Array.from({ length: count }, () => rng.nextUint32());

describe("Rng", () => {
  it("produces the same sequence for the same seed", () => {
    expect(take(Rng.fromSeed(42), 20)).toEqual(take(Rng.fromSeed(42), 20));
  });

  it("produces different sequences for nearby seeds", () => {
    expect(take(Rng.fromSeed(1), 5)).not.toEqual(take(Rng.fromSeed(2), 5));
  });

  it("keeps the algorithm stable, since every saved seed depends on it", () => {
    expect(take(Rng.fromSeed(1), 4)).toMatchInlineSnapshot(`
      [
        1828152527,
        3394835397,
        2967886022,
        2251045104,
      ]
    `);
  });

  it("resumes exactly from a saved state", () => {
    const original = Rng.fromSeed(7);
    take(original, 13);
    const resumed = Rng.fromState(original.state());
    expect(take(resumed, 10)).toEqual(take(original, 10));
  });

  it("survives a JSON round trip, as it will inside save files", () => {
    const original = Rng.fromSeed(99);
    const restored = Rng.fromState(JSON.parse(JSON.stringify(original.state())));
    expect(take(restored, 5)).toEqual(take(original, 5));
  });

  it("keeps integers inside the inclusive range and reaches both ends", () => {
    const rng = Rng.fromSeed(3);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const value = rng.int(-2, 2);
      expect(value).toBeGreaterThanOrEqual(-2);
      expect(value).toBeLessThanOrEqual(2);
      seen.add(value);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2]);
  });

  it("rejects invalid ranges and states", () => {
    const rng = Rng.fromSeed(5);
    expect(() => rng.int(3, 1)).toThrow(RangeError);
    expect(() => rng.int(0.5, 2)).toThrow(RangeError);
    expect(() => rng.pick([])).toThrow(RangeError);
    expect(() => Rng.fromState([1, 2, 3] as unknown as [number, number, number, number])).toThrow(
      RangeError,
    );
    expect(() => Rng.fromSeed(1.5)).toThrow(RangeError);
  });

  it("spreads floats evenly across [0, 1)", () => {
    const rng = Rng.fromSeed(11);
    const buckets = new Array<number>(10).fill(0);
    const samples = 20_000;
    for (let i = 0; i < samples; i++) {
      const value = rng.float();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      const bucket = Math.floor(value * 10);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    for (const count of buckets) expect(count / samples).toBeCloseTo(0.1, 1);
  });

  it("derives stable, independent streams from keys", () => {
    const floorThree = take(Rng.derive(1234, "floor", 3), 5);
    expect(take(Rng.derive(1234, "floor", 3), 5)).toEqual(floorThree);
    expect(take(Rng.derive(1234, "floor", 4), 5)).not.toEqual(floorThree);
    expect(take(Rng.derive(1234, "floor", "3"), 5)).not.toEqual(floorThree);
    expect(take(Rng.derive(4321, "floor", 3), 5)).not.toEqual(floorThree);
  });

  it("shuffles without changing the input", () => {
    const input = [1, 2, 3, 4, 5, 6];
    const shuffled = Rng.fromSeed(8).shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(input);
  });
});
