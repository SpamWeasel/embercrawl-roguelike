import type { Point } from "../../../../engine/geometry";

/** Timing curves, all mapping 0..1 to 0..1. */
export const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const smoothstep = (t: number) => t * t * (3 - 2 * t);

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

export interface Step {
  readonly from: Point;
  readonly to: Point;
}

export interface StepFrame {
  /** Where the walker should be drawn, in tiles (fractional while gliding). */
  readonly position: Point;
  /** 0..1 through the current step, or null when standing still. */
  readonly progress: number | null;
  /** The step that just finished this frame, if any (for landing effects). */
  readonly landed: Step | null;
  /** True when another step is already waiting, so motion should flow on without easing out. */
  readonly chained: boolean;
}

/**
 * Plays a walker's steps one after another. The game rules have already moved the walker; this
 * only animates. When steps arrive faster than they play, playback speeds up so the picture
 * never lags far behind the game, and very old steps are dropped.
 */
export class StepQueue {
  private readonly steps: Step[] = [];
  private progress = 0;
  private resting: Point;

  constructor(
    start: Point,
    private readonly stepMs: number,
    private readonly maxBacklog = 4,
  ) {
    this.resting = start;
  }

  get busy(): boolean {
    return this.steps.length > 0;
  }

  get backlog(): number {
    return this.steps.length;
  }

  push(step: Step): void {
    this.steps.push(step);
    while (this.steps.length > this.maxBacklog) {
      this.steps.shift();
      this.progress = 0;
    }
  }

  /** Stops all motion and stands at `at` (used when the walker teleports, e.g. between floors). */
  snap(at: Point): void {
    this.steps.length = 0;
    this.progress = 0;
    this.resting = at;
  }

  update(deltaMs: number): StepFrame {
    let landed: Step | null = null;
    if (this.steps.length > 0) {
      // One step behind plays at normal speed; each extra waiting step adds 60% speed.
      const speed = 1 + 0.6 * (this.steps.length - 1);
      this.progress += (deltaMs * speed) / this.stepMs;
      while (this.progress >= 1 && this.steps.length > 0) {
        landed = this.steps.shift() ?? null;
        this.progress = this.steps.length > 0 ? this.progress - 1 : 0;
        if (landed) this.resting = landed.to;
      }
    }
    const current = this.steps[0];
    if (!current) return { position: this.resting, progress: null, landed, chained: false };
    const chained = this.steps.length > 1;
    const eased = chained ? this.progress : easeOutQuad(this.progress);
    return {
      position: lerpPoint(current.from, current.to, eased),
      progress: this.progress,
      landed,
      chained,
    };
  }
}

/**
 * Moves `current` toward `target` so that half the remaining distance is covered every
 * `halfLifeMs`, whatever the frame rate. Used for camera follow and fades.
 */
export function approach(
  current: number,
  target: number,
  deltaMs: number,
  halfLifeMs: number,
): number {
  if (halfLifeMs <= 0) return target;
  return target + (current - target) * 2 ** (-deltaMs / halfLifeMs);
}

/** Moves `current` toward `target` at a constant rate of `perMs` units per millisecond. */
export function moveToward(
  current: number,
  target: number,
  deltaMs: number,
  perMs: number,
): number {
  const change = deltaMs * perMs;
  if (Math.abs(target - current) <= change) return target;
  return current + Math.sign(target - current) * change;
}
