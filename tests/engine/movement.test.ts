import { describe, expect, it } from "vitest";
import { directionFromDelta } from "../../src/engine/geometry";
import { canStep } from "../../src/engine/map";
import { mapFrom } from "./helpers";

describe("canStep", () => {
  const open = mapFrom([
    "#####", //
    "#...#",
    "#...#",
    "#...#",
    "#####",
  ]);

  it("allows all eight directions in an open room", () => {
    for (const direction of ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const) {
      expect(canStep(open, { x: 2, y: 2 }, direction)).toBe(true);
    }
  });

  it("refuses to walk into walls", () => {
    expect(canStep(open, { x: 1, y: 1 }, "n")).toBe(false);
    expect(canStep(open, { x: 1, y: 1 }, "w")).toBe(false);
    expect(canStep(open, { x: 1, y: 1 }, "nw")).toBe(false);
  });

  it("refuses to squeeze diagonally between two walls touching at a corner", () => {
    const seam = mapFrom([
      "####", //
      "#.##",
      "##.#",
      "####",
    ]);
    expect(canStep(seam, { x: 1, y: 1 }, "se")).toBe(false);
    expect(canStep(seam, { x: 2, y: 2 }, "nw")).toBe(false);
  });

  it("allows stepping diagonally past a single wall corner", () => {
    const corner = mapFrom([
      "####", //
      "#..#",
      "##.#",
      "####",
    ]);
    // (1,1) → (2,2): the side tile (2,1) is open, so only one corner is in the way.
    expect(canStep(corner, { x: 1, y: 1 }, "se")).toBe(true);
    expect(canStep(corner, { x: 2, y: 2 }, "nw")).toBe(true);
  });
});

describe("directionFromDelta", () => {
  it("maps deltas to the matching direction by sign", () => {
    expect(directionFromDelta(0, -1)).toBe("n");
    expect(directionFromDelta(3, -2)).toBe("ne");
    expect(directionFromDelta(-1, 5)).toBe("sw");
    expect(directionFromDelta(0, 0)).toBeNull();
  });
});
