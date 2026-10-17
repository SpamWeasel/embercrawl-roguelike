import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import type { Point } from "../../../../engine/geometry";
import { clamp01, easeOutCubic, lerp } from "./motion";

interface Floating {
  readonly text: Text;
  /** Anchored to a point in the world (pixels), so it follows the camera. */
  readonly at: Point;
  ms: number;
  readonly life: number;
}

interface Ring {
  readonly graphics: Graphics;
  ms: number;
  readonly life: number;
  readonly radius: number;
  readonly color: number;
}

interface Bolt {
  readonly sprite: Sprite;
  readonly from: Point;
  readonly to: Point;
  ms: number;
  readonly life: number;
  readonly onArrive: () => void;
}

/**
 * Short-lived combat effects: floating numbers (drawn in screen space so text stays crisp at any
 * zoom), expanding rings (pulses, level-ups) and projectiles (ranged attacks). Cosmetic only.
 */
export class EffectLayer {
  /** Goes on the stage, above the world. */
  readonly screen = new Container();
  /** Goes inside the world, above the actors. */
  readonly world = new Container();
  private readonly floating: Floating[] = [];
  private readonly rings: Ring[] = [];
  private readonly bolts: Bolt[] = [];

  constructor(
    private readonly toScreen: (worldPixels: Point) => Point,
    private readonly dot: Texture,
  ) {}

  /** A number (or short word) that pops up from a point and drifts upward. */
  number(at: Point, label: string, color: number, big = false): void {
    this.float(at, label, color, big ? 26 : 19, "800", big ? 1200 : 850);
  }

  /** A name (an item picked up, gear put on) that rises a little slower than a number. */
  label(at: Point, label: string, color: number): void {
    this.float(at, label, color, 15, "700", 1300);
  }

  private float(
    at: Point,
    label: string,
    color: number,
    fontSize: number,
    fontWeight: "700" | "800",
    life: number,
  ): void {
    const text = new Text({
      text: label,
      style: {
        fontFamily: "Segoe UI, system-ui, sans-serif",
        fontSize,
        fontWeight,
        fill: color,
        stroke: { color: 0x0a0608, width: 4 },
      },
    });
    text.anchor.set(0.5, 1);
    this.screen.addChild(text);
    this.floating.push({ text, at, ms: 0, life });
  }

  ring(at: Point, radius: number, color: number, life = 360): void {
    const graphics = new Graphics();
    graphics.position.set(at.x, at.y);
    graphics.blendMode = "add";
    this.world.addChild(graphics);
    this.rings.push({ graphics, ms: 0, life, radius, color });
  }

  /** A glowing shot from one point to another; `onArrive` runs when it lands. */
  bolt(from: Point, to: Point, color: number, life: number, onArrive: () => void): void {
    const sprite = new Sprite(this.dot);
    sprite.anchor.set(0.5);
    sprite.setSize(5, 5);
    sprite.tint = color;
    sprite.blendMode = "add";
    sprite.position.set(from.x, from.y);
    this.world.addChild(sprite);
    this.bolts.push({ sprite, from, to, ms: 0, life, onArrive });
  }

  update(deltaMs: number): void {
    for (let i = this.floating.length - 1; i >= 0; i--) {
      const f = this.floating[i] as Floating;
      f.ms += deltaMs;
      const t = clamp01(f.ms / f.life);
      const screen = this.toScreen(f.at);
      f.text.position.set(screen.x, screen.y - 8 - easeOutCubic(t) * 30);
      f.text.scale.set(1 + 0.45 * clamp01(1 - f.ms / 120));
      f.text.alpha = clamp01((1 - t) / 0.4);
      if (t >= 1) {
        f.text.destroy();
        this.floating.splice(i, 1);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i] as Ring;
      r.ms += deltaMs;
      const t = clamp01(r.ms / r.life);
      r.graphics
        .clear()
        .circle(0, 0, 2 + easeOutCubic(t) * r.radius)
        .stroke({ color: r.color, width: 2.2 * (1 - t) + 0.4, alpha: 0.9 * (1 - t) });
      if (t >= 1) {
        r.graphics.destroy();
        this.rings.splice(i, 1);
      }
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i] as Bolt;
      b.ms += deltaMs;
      const t = clamp01(b.ms / b.life);
      // A slight arc, so shots read as thrown rather than teleported.
      b.sprite.position.set(
        lerp(b.from.x, b.to.x, t),
        lerp(b.from.y, b.to.y, t) - Math.sin(t * Math.PI) * 4,
      );
      if (t >= 1) {
        b.sprite.destroy();
        this.bolts.splice(i, 1);
        b.onArrive();
      }
    }
  }

  clear(): void {
    for (const f of this.floating) f.text.destroy();
    for (const r of this.rings) r.graphics.destroy();
    for (const b of this.bolts) b.sprite.destroy();
    this.floating.length = 0;
    this.rings.length = 0;
    this.bolts.length = 0;
  }
}
