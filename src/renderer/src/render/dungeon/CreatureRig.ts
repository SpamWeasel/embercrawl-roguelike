import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { type CreatureKind, creatureKind, type Monster } from "../../../../engine/creatures";
import type { Point } from "../../../../engine/geometry";
import { clamp01, moveToward, StepQueue } from "./motion";
import { TILE_PIXELS } from "./textures";

const FLASH_MS = 140;
const LUNGE_MS = 170;
const LUNGE_PIXELS = 5;
const NOTICE_MS = 700;
const DISSOLVE_MS = 420;
/** Guardians are drawn larger than a tile. */
const GUARDIAN_SCALE = 1.4;

/**
 * One creature's sprite and animation: glide between tiles, an idle motion that suits its
 * behavior, a lunge when it strikes, a white flash when hit, a red marker while it is about to
 * strike, a "!" when it notices the hero, a health bar once wounded, and a dissolve on death.
 */
export class CreatureRig {
  readonly container = new Container();
  readonly steps: StepQueue;
  /** Where the creature will be once queued steps finish. */
  expected: Point;
  private readonly kind: CreatureKind;
  private readonly sprite: Sprite;
  private readonly shadow = new Graphics();
  private readonly bars = new Graphics();
  private readonly warning = new Graphics();
  private readonly baseScale: number;
  private readonly phase = Math.random() * Math.PI * 2;
  private facing: number;
  private facingTarget: number;
  private flashMs = Number.POSITIVE_INFINITY;
  private lunge: { dx: number; dy: number; ms: number } | null = null;
  private noticeMs = Number.POSITIVE_INFINITY;
  private dyingMs: number | null = null;
  private shownHp: number;
  /** Killed in the rules; kept on screen until its death animation has played. */
  doomed = false;

  constructor(
    monster: Monster,
    texture: Texture,
    stepMs: number,
    private readonly reducedMotion: boolean,
  ) {
    this.kind = creatureKind(monster.kind);
    this.steps = new StepQueue({ x: monster.x, y: monster.y }, stepMs);
    this.expected = { x: monster.x, y: monster.y };
    this.sprite = new Sprite(texture);
    this.sprite.anchor.set(0.5, 1);
    const size = TILE_PIXELS * ("guardian" in this.kind ? GUARDIAN_SCALE : 1);
    this.baseScale = size / texture.width;
    this.facing = monster.facing === "left" ? -1 : 1;
    this.facingTarget = this.facing;
    this.shownHp = monster.hp;
    const shadowWidth = "guardian" in this.kind ? 7.5 : 5;
    this.shadow.ellipse(0, 0, shadowWidth, 1.6).fill({ color: 0x000000, alpha: 0.35 });
    this.container.addChild(this.shadow, this.warning, this.sprite, this.bars);
  }

  get dying(): boolean {
    return this.dyingMs !== null;
  }

  face(direction: "left" | "right"): void {
    this.facingTarget = direction === "left" ? -1 : 1;
  }

  flash(): void {
    this.flashMs = 0;
  }

  /** Leans toward a target when striking. */
  strikeToward(target: Point, from: Point): void {
    if (this.reducedMotion) return;
    const dx = Math.sign(target.x - from.x);
    const dy = Math.sign(target.y - from.y);
    this.lunge = { dx, dy, ms: 0 };
  }

  noticed(): void {
    this.noticeMs = 0;
  }

  die(): void {
    this.dyingMs = 0;
  }

  /**
   * @param tile where to draw (fractional while gliding)
   * @param visibility 0..1, how much of the creature's tile the hero can see
   * @returns false once a death dissolve has finished and the rig can be removed
   */
  update(
    deltaMs: number,
    seconds: number,
    tile: Point,
    stepProgress: number | null,
    visibility: number,
    monster: Monster | undefined,
  ): boolean {
    this.facing = moveToward(this.facing, this.facingTarget, deltaMs, 2 / 90);
    this.flashMs += deltaMs;
    this.noticeMs += deltaMs;
    if (this.dyingMs !== null) this.dyingMs += deltaMs;
    if (monster) this.shownHp = monster.hp;

    let hop = 0;
    let stretchX = 1;
    let stretchY = 1;
    let lungeX = 0;
    let lungeY = 0;
    if (!this.reducedMotion) {
      if (stepProgress !== null) hop = Math.sin(stepProgress * Math.PI) * 1.2;
      // Each behavior idles differently: moths hover, erratic things twitch, heavy ones breathe.
      const t = seconds * 2 + this.phase;
      switch (this.kind.behavior) {
        case "ranged":
          hop += 1.5 + Math.sin(t * 1.6) * 1.2;
          break;
        case "erratic":
          lungeX += Math.sin(t * 9.1) * 0.35;
          break;
        case "slow":
          stretchY *= 1 + 0.03 * Math.sin(t * 0.9);
          stretchX *= 1 - 0.015 * Math.sin(t * 0.9);
          break;
        default:
          stretchY *= 1 + 0.02 * Math.sin(t * 1.4);
      }
      if (this.lunge) {
        this.lunge.ms += deltaMs;
        const push = Math.sin(Math.PI * clamp01(this.lunge.ms / LUNGE_MS));
        lungeX += this.lunge.dx * LUNGE_PIXELS * push;
        lungeY += this.lunge.dy * LUNGE_PIXELS * push;
        if (this.lunge.ms >= LUNGE_MS) this.lunge = null;
      }
    }

    const dissolve = this.dyingMs === null ? 0 : clamp01(this.dyingMs / DISSOLVE_MS);
    this.container.position.set(
      (tile.x + 0.5) * TILE_PIXELS + lungeX,
      (tile.y + 1) * TILE_PIXELS - 1 + lungeY,
    );
    this.container.alpha = visibility * (1 - dissolve);
    this.container.visible = this.container.alpha > 0.01;
    this.sprite.position.set(0, -hop + dissolve * 4);
    const shrink = 1 - dissolve * 0.4;
    this.sprite.scale.set(
      this.baseScale * stretchX * this.facing * shrink,
      this.baseScale * stretchY * shrink * (1 - dissolve * 0.3),
    );
    // Hit flash: drawn additively (much brighter) for a moment; dying creatures redden as they fade.
    const flash = clamp01(1 - this.flashMs / FLASH_MS);
    this.sprite.tint = this.dyingMs !== null ? 0xff8866 : 0xffffff;
    this.sprite.blendMode = flash > 0.5 ? "add" : "normal";

    this.drawWarning(monster?.ready === true && this.dyingMs === null, seconds);
    this.drawBars(monster);
    return dissolve < 1;
  }

  /** A red marker over the head while the creature is about to strike, bobbing for attention. */
  private drawWarning(ready: boolean, seconds: number): void {
    const notice = clamp01(1 - this.noticeMs / NOTICE_MS);
    this.warning.clear();
    if (!ready && notice === 0) return;
    const head = -TILE_PIXELS * ("guardian" in this.kind ? GUARDIAN_SCALE : 1) - 2.5;
    const bob = this.reducedMotion ? 0 : Math.sin(seconds * 8) * 0.8;
    if (ready) {
      const glow = 0.6 + 0.4 * Math.sin(seconds * 10);
      this.warning
        .ellipse(0, 0, 6, 2)
        .fill({ color: 0xff3b2f, alpha: 0.22 * glow })
        .poly([-2, head + bob, 2, head + bob, 0, head + 3 + bob])
        .fill({ color: 0xff4a3a, alpha: 0.95 });
    } else {
      // "!" when it first notices the hero.
      const rise = (1 - notice) * 2;
      this.warning
        .rect(-0.5, head - 4 - rise, 1, 2.6)
        .rect(-0.5, head - 1 - rise, 1, 1)
        .fill({ color: 0xffd45a, alpha: notice });
    }
  }

  private drawBars(monster: Monster | undefined): void {
    this.bars.clear();
    if (!monster || this.dyingMs !== null || monster.hp >= monster.maxHp) return;
    const width = "guardian" in this.kind ? 14 : 10;
    const top = -TILE_PIXELS * ("guardian" in this.kind ? GUARDIAN_SCALE : 1) - 1;
    const share = clamp01(this.shownHp / monster.maxHp);
    this.bars
      .rect(-width / 2, top, width, 1.2)
      .fill({ color: 0x120a0a, alpha: 0.85 })
      .rect(-width / 2, top, width * share, 1.2)
      .fill({ color: share > 0.5 ? 0xd9c25a : share > 0.25 ? 0xe08a3a : 0xe0463a });
  }
}
