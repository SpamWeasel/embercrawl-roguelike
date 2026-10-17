import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import type { Point } from "../../../../engine/geometry";
import { mixColor } from "./lighting";
import { clamp01, moveToward } from "./motion";
import { TILE_PIXELS } from "./textures";

/** How long the hero takes to turn around, in milliseconds. */
const TURN_MS = 90;
/** Wall-bump nudge length and distance (world pixels). */
const BUMP_MS = 130;
const BUMP_PIXELS = 2.6;
/** Height of the little hop on each step (world pixels). */
const HOP_PIXELS = 1.6;
const LAND_MS = 150;
/** Standing still this long fades in the idle breathing. */
const IDLE_AFTER_MS = 250;
/** Attacking leans further and longer than a wall bump. */
const LUNGE_MS = 160;
const LUNGE_PIXELS = 4.5;
const FLASH_MS = 260;

/**
 * The hero's sprite with everything that makes a single still image feel alive: a ground shadow,
 * a hop and stretch while walking, a squash on landing, idle breathing, turning around, a nudge
 * when walking into a wall, and sinking away when taking the stairs.
 */
export class HeroRig {
  readonly container = new Container();
  private readonly shadow = new Graphics();
  private readonly sprite: Sprite;
  private readonly baseScale: number;
  private facing = 1;
  private facingTarget = 1;
  private bump: { dx: number; dy: number; ms: number; length: number; pixels: number } | null =
    null;
  private sinceLandMs = Number.POSITIVE_INFINITY;
  private idleMs = Number.POSITIVE_INFINITY;
  private sink = 0;
  private sinking = false;
  private flashColor = 0xffffff;
  private flashMs = Number.POSITIVE_INFINITY;
  private collapsing = false;
  private fall = 0;

  constructor(
    texture: Texture,
    private readonly reducedMotion: boolean,
  ) {
    this.sprite = new Sprite(texture);
    // Anchored at the feet, so squash and stretch keep the hero planted on the ground.
    this.sprite.anchor.set(0.5, 1);
    this.baseScale = TILE_PIXELS / texture.width;
    this.shadow.ellipse(0, 0, 5.2, 1.7).fill({ color: 0x000000, alpha: 0.38 });
    this.container.addChild(this.shadow, this.sprite);
  }

  face(direction: "left" | "right", instantly = false): void {
    this.facingTarget = direction === "left" ? -1 : 1;
    if (instantly) this.facing = this.facingTarget;
  }

  startBump(dx: number, dy: number): void {
    if (this.reducedMotion) return;
    this.bump = { dx, dy, ms: 0, length: BUMP_MS, pixels: BUMP_PIXELS };
  }

  /** Leans into an attack. */
  lunge(dx: number, dy: number): void {
    if (this.reducedMotion) return;
    this.bump = { dx, dy, ms: 0, length: LUNGE_MS, pixels: LUNGE_PIXELS };
  }

  /** Tints toward `color` and back, e.g. red when hurt. */
  flash(color: number): void {
    this.flashColor = color;
    this.flashMs = 0;
  }

  /** Falls when slain; stays down until `reset`. */
  collapse(): void {
    this.collapsing = true;
  }

  landed(): void {
    this.sinceLandMs = 0;
  }

  /** Starts sinking into the stairs (screen is fading out). */
  startSink(): void {
    this.sinking = true;
  }

  /** Back to normal after arriving somewhere new. */
  reset(): void {
    this.sinking = false;
    this.sink = 0;
    this.bump = null;
    this.sinceLandMs = Number.POSITIVE_INFINITY;
    this.collapsing = false;
    this.fall = 0;
    this.flashMs = Number.POSITIVE_INFINITY;
  }

  /**
   * @param tile where to draw, in tiles (fractional while gliding)
   * @param stepProgress 0..1 through the current step, or null when standing still
   */
  update(deltaMs: number, seconds: number, tile: Point, stepProgress: number | null): void {
    const walking = stepProgress !== null;
    this.idleMs = walking ? 0 : this.idleMs + deltaMs;
    this.sinceLandMs += deltaMs;
    this.facing = moveToward(this.facing, this.facingTarget, deltaMs, 2 / TURN_MS);
    if (this.sinking) this.sink = moveToward(this.sink, 1, deltaMs, 1 / 160);
    if (this.collapsing) this.fall = moveToward(this.fall, 1, deltaMs, 1 / 650);
    this.flashMs += deltaMs;

    // The bump moves the whole body (sprite and shadow); the hop lifts only the sprite.
    let bumpX = 0;
    let bumpY = 0;
    let hop = 0;
    let stretchX = 1;
    let stretchY = 1;

    if (!this.reducedMotion) {
      if (walking) {
        const arc = Math.sin(stepProgress * Math.PI);
        hop = arc * HOP_PIXELS;
        stretchY *= 1 + 0.04 * arc;
        stretchX *= 1 - 0.02 * arc;
      }
      const squash = clamp01(1 - this.sinceLandMs / LAND_MS);
      stretchY *= 1 - 0.07 * squash;
      stretchX *= 1 + 0.05 * squash;
      const idle = clamp01((this.idleMs - IDLE_AFTER_MS) / 400);
      const breath = Math.sin(seconds * 2.2) * idle;
      stretchY *= 1 + 0.018 * breath;
      stretchX *= 1 - 0.008 * breath;
      if (this.bump) {
        this.bump.ms += deltaMs;
        const push = Math.sin(Math.PI * clamp01(this.bump.ms / this.bump.length));
        bumpX = this.bump.dx * this.bump.pixels * push;
        bumpY = this.bump.dy * this.bump.pixels * push;
        if (this.bump.ms >= this.bump.length) this.bump = null;
      }
    }

    const shrink = 1 - 0.35 * this.sink;
    this.container.position.set(
      (tile.x + 0.5) * TILE_PIXELS + bumpX,
      (tile.y + 1) * TILE_PIXELS - 1 + bumpY,
    );
    this.sprite.position.set(0, -hop + this.sink * 3);
    this.sprite.scale.set(
      this.baseScale * stretchX * this.facing * shrink,
      this.baseScale * stretchY * shrink,
    );
    this.sprite.alpha = (1 - this.sink) * (1 - 0.45 * this.fall);
    this.shadow.alpha = 1 - this.sink;
    // Slain: topples sideways and darkens.
    this.sprite.rotation = this.fall * 1.2 * Math.sign(this.facing || 1);
    const hurt = clamp01(1 - this.flashMs / FLASH_MS);
    const base = this.fall > 0 ? mixColor(0xffffff, 0x8a3028, this.fall) : 0xffffff;
    this.sprite.tint = mixColor(base, this.flashColor, hurt);
    this.shadow.scale.set(
      1 - 0.15 * (walking && !this.reducedMotion ? Math.sin((stepProgress ?? 0) * Math.PI) : 0),
    );
  }

  /** The point between the hero's feet, in world pixels. */
  get feet(): Point {
    return { x: this.container.x, y: this.container.y };
  }
}
