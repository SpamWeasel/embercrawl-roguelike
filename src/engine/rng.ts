/**
 * Deterministic random numbers for game rules (sfc32, seeded through splitmix32). The whole state
 * is four 32-bit integers, so it can be written into a save file and resumed exactly.
 *
 * Changing this algorithm changes every dungeon generated from every seed. The golden-value test
 * in tests/engine/rng.test.ts exists to catch that.
 */

export type RngState = readonly [number, number, number, number];

const UINT32_RANGE = 0x1_0000_0000;

/** Expands one 32-bit seed into a stream of well-mixed 32-bit values. */
function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** FNV-1a over the seed and keys, so `Rng.derive(seed, "floor", 3)` names a stable sub-stream. */
function hashKeys(seed: number, keys: ReadonlyArray<string | number>): number {
  let hash = 0x811c9dc5 ^ (seed >>> 0);
  const text = keys.map((key) => `${typeof key === "number" ? "n" : "s"}:${key}`).join("|");
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  private constructor(state: RngState) {
    [this.a, this.b, this.c, this.d] = state.map((part) => part >>> 0) as [
      number,
      number,
      number,
      number,
    ];
  }

  static fromSeed(seed: number): Rng {
    if (!Number.isInteger(seed)) throw new RangeError(`Seed must be an integer, got ${seed}.`);
    const next = splitmix32(seed);
    const rng = new Rng([next(), next(), next(), next()]);
    // Discard the first outputs so nearby seeds diverge immediately.
    for (let i = 0; i < 12; i++) rng.nextUint32();
    return rng;
  }

  /** Resumes a generator exactly where `state()` left it. */
  static fromState(state: RngState): Rng {
    if (state.length !== 4 || !state.every((part) => Number.isInteger(part))) {
      throw new RangeError("Rng state must be four integers.");
    }
    return new Rng(state);
  }

  /** An independent stream named by keys, e.g. one per dungeon floor. */
  static derive(seed: number, ...keys: ReadonlyArray<string | number>): Rng {
    return Rng.fromSeed(hashKeys(seed, keys));
  }

  state(): RngState {
    return [this.a, this.b, this.c, this.d];
  }

  nextUint32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = (this.b ^ (this.b >>> 9)) >>> 0;
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** A float in [0, 1). */
  float(): number {
    return this.nextUint32() / UINT32_RANGE;
  }

  /** An integer from `min` to `max`, both inclusive. */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
      throw new RangeError(`Invalid integer range ${min}..${max}.`);
    }
    return min + Math.floor(this.float() * (max - min + 1));
  }

  /** True with probability `p` (0 to 1). */
  chance(p: number): boolean {
    return this.float() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("Cannot pick from an empty list.");
    return items[this.int(0, items.length - 1)] as T;
  }

  /** A shuffled copy; the input is left unchanged. */
  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [result[i], result[j]] = [result[j] as T, result[i] as T];
    }
    return result;
  }
}
