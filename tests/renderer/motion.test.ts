import { describe, expect, it } from "vitest";
import {
  cameraOffset,
  crispScale,
  snapToPixel,
} from "../../src/renderer/src/render/dungeon/camera";
import {
  flicker,
  lanternLevel,
  mixColor,
  REMEMBERED_TINT,
  scaleColor,
  tileTint,
} from "../../src/renderer/src/render/dungeon/lighting";
import { approach, moveToward, StepQueue } from "../../src/renderer/src/render/dungeon/motion";

const STEP_MS = 100;
const a = { x: 0, y: 0 };
const b = { x: 1, y: 0 };
const c = { x: 2, y: 1 };

describe("StepQueue", () => {
  it("stands still until a step arrives", () => {
    const queue = new StepQueue(a, STEP_MS);
    expect(queue.update(16)).toEqual({ position: a, progress: null, landed: null, chained: false });
  });

  it("glides through a step and lands on its target", () => {
    const queue = new StepQueue(a, STEP_MS);
    queue.push({ from: a, to: b });
    const midway = queue.update(50);
    expect(midway.position.x).toBeGreaterThan(0.5); // eases out, so past halfway at half time
    expect(midway.position.x).toBeLessThan(1);
    const end = queue.update(60);
    expect(end.position).toEqual(b);
    expect(end.landed).toEqual({ from: a, to: b });
    expect(queue.busy).toBe(false);
  });

  it("speeds up when steps pile up, without skipping any", () => {
    const queue = new StepQueue(a, STEP_MS);
    queue.push({ from: a, to: b });
    queue.push({ from: b, to: c });
    let elapsed = 0;
    const landed = [];
    while (queue.busy && elapsed < 1000) {
      const frame = queue.update(10);
      elapsed += 10;
      if (frame.landed) landed.push(frame.landed.to);
    }
    expect(landed).toEqual([b, c]);
    expect(elapsed).toBeLessThan(2 * STEP_MS); // faster than playing both at normal speed
  });

  it("drops the oldest steps when it falls far behind", () => {
    const queue = new StepQueue(a, STEP_MS, 2);
    for (let i = 0; i < 6; i++) queue.push({ from: { x: i, y: 0 }, to: { x: i + 1, y: 0 } });
    expect(queue.backlog).toBe(2);
  });

  it("snaps to a new place and forgets queued steps", () => {
    const queue = new StepQueue(a, STEP_MS);
    queue.push({ from: a, to: b });
    queue.snap(c);
    expect(queue.update(16).position).toEqual(c);
    expect(queue.busy).toBe(false);
  });
});

describe("approach and moveToward", () => {
  it("covers half the distance per half-life, at any frame rate", () => {
    expect(approach(0, 100, 50, 50)).toBeCloseTo(50);
    let stepped = 0;
    for (let i = 0; i < 5; i++) stepped = approach(stepped, 100, 10, 50);
    expect(stepped).toBeCloseTo(50);
  });

  it("moves at a constant rate and stops exactly on target", () => {
    expect(moveToward(0, 1, 100, 0.005)).toBeCloseTo(0.5);
    expect(moveToward(0.9, 1, 100, 0.005)).toBe(1);
    expect(moveToward(1, 0, 100, 0.005)).toBeCloseTo(0.5);
  });
});

describe("camera", () => {
  it("centers the focus between the HUD bars", () => {
    // 1000px view, 2000px map, focus at 1000px, 50px reserved top and bottom.
    expect(cameraOffset(1000, 2000, 1000, 50, 50)).toBe(-500);
  });

  it("stops at the map's edges", () => {
    expect(cameraOffset(1000, 2000, 10, 50, 50)).toBe(50);
    expect(cameraOffset(1000, 2000, 1990, 50, 50)).toBe(1000 - 50 - 2000);
  });

  it("centers a map that fits", () => {
    expect(cameraOffset(1000, 600, 300, 50, 150)).toBe(50 + (800 - 600) / 2);
  });

  it("keeps art pixels a whole number of physical pixels", () => {
    for (const dpr of [1, 1.25, 1.5, 2]) {
      for (const [w, h] of [
        [1280, 720],
        [1266, 763],
        [1920, 1080],
        [3840, 2160],
        [960, 600],
      ]) {
        const physical = crispScale(w as number, h as number, dpr, 16, 20, 12) * dpr;
        expect(physical).toBeCloseTo(Math.round(physical));
        expect(physical).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("aims for about 20 tiles across", () => {
    const scale = crispScale(1920, 1080, 1, 16, 20, 12);
    expect(1920 / (16 * scale)).toBeGreaterThan(16);
    expect(1920 / (16 * scale)).toBeLessThan(25);
  });

  it("snaps to the physical pixel grid", () => {
    expect(snapToPixel(10.3, 1.5)).toBe(10); // 15.45 physical px rounds to 15
    expect(snapToPixel(10.5, 1.5)).toBeCloseTo(32 / 3); // 15.75 rounds to 16
  });
});

describe("lantern light", () => {
  it("is brightest near the hero and dims toward the edge of sight", () => {
    expect(lanternLevel(0, 5)).toBe(1);
    expect(lanternLevel(1, 5)).toBe(1);
    expect(lanternLevel(3, 5)).toBeLessThan(lanternLevel(2, 5));
    expect(lanternLevel(5.5, 5)).toBeCloseTo(0.45);
  });

  it("flickers gently around full strength", () => {
    for (let t = 0; t < 20; t += 0.05) {
      expect(flicker(t)).toBeGreaterThan(0.92);
      expect(flicker(t)).toBeLessThan(1.08);
      expect(Math.abs(flicker(t, 0.3) - 1)).toBeLessThanOrEqual(Math.abs(flicker(t) - 1) + 1e-9);
    }
  });

  it("blends tiles from remembered to lit", () => {
    expect(tileTint(0, 1)).toBe(REMEMBERED_TINT);
    expect(mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(scaleColor(0xffffff, 2)).toBe(0xffffff);
    expect(scaleColor(0x804020, 0.5)).toBe(0x402010);
  });
});
