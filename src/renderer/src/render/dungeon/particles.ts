import { Container, Sprite, Texture } from "pixi.js";

export interface ParticleOptions {
  /** Start position in world pixels. */
  readonly x: number;
  readonly y: number;
  /** Velocity in world pixels per second. */
  readonly vx?: number;
  readonly vy?: number;
  /** Lifetime in seconds. */
  readonly life: number;
  /** Width and height in world pixels. */
  readonly size: number;
  readonly color: number;
  /** Peak opacity. */
  readonly alpha?: number;
  /** How quickly velocity dies away, per second. */
  readonly drag?: number;
  /** Downward acceleration in world pixels per second squared (negative rises). */
  readonly gravity?: number;
  /** Side-to-side drift amplitude in world pixels per second. */
  readonly sway?: number;
  /** Glowing particles add light instead of covering what's underneath. */
  readonly glow?: boolean;
  /** Soft round dot, or a hard square pixel. */
  readonly shape: "dot" | "pixel";
}

interface Live {
  sprite: Sprite;
  vx: number;
  vy: number;
  age: number;
  life: number;
  alpha: number;
  drag: number;
  gravity: number;
  sway: number;
  phase: number;
}

/** A pool of short-lived cosmetic particles (dust, embers, motes). Never affects the game. */
export class ParticleField {
  readonly container = new Container();
  private readonly live: Live[] = [];
  private readonly spare: Sprite[] = [];
  private readonly dot: Texture;

  constructor(private readonly limit = 400) {
    this.dot = softDotTexture();
  }

  get count(): number {
    return this.live.length;
  }

  emit(options: ParticleOptions): void {
    if (this.live.length >= this.limit) return;
    const sprite = this.spare.pop() ?? new Sprite();
    sprite.texture = options.shape === "dot" ? this.dot : Texture.WHITE;
    sprite.anchor.set(0.5);
    sprite.setSize(options.size, options.size);
    sprite.tint = options.color;
    sprite.blendMode = options.glow ? "add" : "normal";
    sprite.position.set(options.x, options.y);
    sprite.alpha = 0;
    this.container.addChild(sprite);
    this.live.push({
      sprite,
      vx: options.vx ?? 0,
      vy: options.vy ?? 0,
      age: 0,
      life: options.life,
      alpha: options.alpha ?? 1,
      drag: options.drag ?? 0,
      gravity: options.gravity ?? 0,
      sway: options.sway ?? 0,
      phase: Math.random() * Math.PI * 2,
    });
  }

  update(seconds: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i] as Live;
      p.age += seconds;
      if (p.age >= p.life) {
        this.retire(i);
        continue;
      }
      const damping = Math.exp(-p.drag * seconds);
      p.vx *= damping;
      p.vy = p.vy * damping + p.gravity * seconds;
      const drift = p.sway * Math.sin(p.age * 2.6 + p.phase);
      p.sprite.x += (p.vx + drift) * seconds;
      p.sprite.y += p.vy * seconds;
      // Fade in over the first 15% of life, out over the last half.
      const t = p.age / p.life;
      p.sprite.alpha = p.alpha * Math.min(1, t / 0.15) * Math.min(1, (1 - t) / 0.5);
    }
  }

  clear(): void {
    for (let i = this.live.length - 1; i >= 0; i--) this.retire(i);
  }

  destroy(): void {
    this.clear();
    this.container.destroy({ children: true });
    this.dot.destroy(true);
  }

  private retire(index: number): void {
    const [p] = this.live.splice(index, 1);
    if (!p) return;
    this.container.removeChild(p.sprite);
    this.spare.push(p.sprite);
  }
}

function softDotTexture(): Texture {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This system could not create a 2D canvas.");
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.35, "rgba(255, 255, 255, 0.7)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return Texture.from(canvas);
}
