// Lets PixiJS run under the packaged game's content security policy, which forbids eval().
import "pixi.js/unsafe-eval";
import { Application, Container, Sprite, Texture } from "pixi.js";

export interface EmberScene {
  /** Which renderer PixiJS picked: "webgl", "webgpu" or "canvas". */
  readonly renderer: string;
  destroy(): void;
}

interface Ember {
  sprite: Sprite;
  /** Upward speed in pixels per second. */
  rise: number;
  sway: number;
  phase: number;
  age: number;
  life: number;
  baseScale: number;
}

const EMBER_COLORS = [0xffd9a0, 0xffa45c, 0xff7a33, 0xff5a1f];

/** A soft round texture drawn once on a 2D canvas, used for both the glow and the embers. */
function radialTexture(size: number, stops: ReadonlyArray<readonly [number, string]>): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This system could not create a 2D canvas.");
  const center = size / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return Texture.from(canvas);
}

/**
 * Placeholder title scene: embers drift up from a flickering glow. Cosmetic randomness here uses
 * Math.random(); game rules never do (they use the engine's seeded Rng).
 */
export async function createEmberScene(
  host: HTMLElement,
  reducedMotion: boolean,
): Promise<EmberScene> {
  const app = new Application();
  await app.init({
    resizeTo: host,
    backgroundAlpha: 0,
    antialias: false,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    preference: "webgl",
  });
  host.appendChild(app.canvas);

  const glowTexture = radialTexture(256, [
    [0, "rgba(255, 150, 70, 0.55)"],
    [0.35, "rgba(220, 70, 30, 0.2)"],
    [1, "rgba(0, 0, 0, 0)"],
  ]);
  const emberTexture = radialTexture(32, [
    [0, "rgba(255, 245, 215, 1)"],
    [0.3, "rgba(255, 175, 80, 0.9)"],
    [1, "rgba(255, 80, 20, 0)"],
  ]);

  const glow = new Sprite(glowTexture);
  glow.anchor.set(0.5);
  glow.blendMode = "add";
  const embers = new Container();
  app.stage.addChild(glow, embers);

  const width = () => app.screen.width;
  const height = () => app.screen.height;

  const spawn = (ember: Ember, anywhere: boolean) => {
    ember.sprite.x = Math.random() * width();
    ember.sprite.y = anywhere ? Math.random() * height() : height() + 10;
    ember.rise = (reducedMotion ? 8 : 18) + Math.random() * (reducedMotion ? 12 : 46);
    ember.sway = 6 + Math.random() * 18;
    ember.phase = Math.random() * Math.PI * 2;
    ember.age = 0;
    ember.life = 5 + Math.random() * 7;
    ember.baseScale = 0.12 + Math.random() * 0.38;
    ember.sprite.tint = EMBER_COLORS[Math.floor(Math.random() * EMBER_COLORS.length)] ?? 0xffa45c;
  };

  const pool: Ember[] = [];
  const count = reducedMotion ? 40 : 140;
  for (let i = 0; i < count; i++) {
    const sprite = new Sprite(emberTexture);
    sprite.anchor.set(0.5);
    sprite.blendMode = "add";
    embers.addChild(sprite);
    const ember: Ember = { sprite, rise: 0, sway: 0, phase: 0, age: 0, life: 1, baseScale: 0 };
    spawn(ember, true);
    ember.age = Math.random() * ember.life;
    pool.push(ember);
  }

  let time = 0;
  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS / 1000, 0.1);
    time += dt;

    const flicker = reducedMotion
      ? 1
      : 1 + 0.05 * Math.sin(time * 3.1) + 0.025 * Math.sin(time * 7.7);
    glow.x = width() / 2;
    glow.y = height() * 0.78;
    glow.scale.set((Math.max(width(), height()) / 256) * 0.9 * flicker);
    glow.alpha = 0.85 * flicker;

    for (const ember of pool) {
      ember.age += dt;
      ember.sprite.y -= ember.rise * dt;
      ember.sprite.x += Math.sin(time * 0.9 + ember.phase) * ember.sway * dt;
      const progress = ember.age / ember.life;
      // Fade in quickly, then cool and shrink as the ember rises.
      ember.sprite.alpha = Math.min(1, progress * 6) * (1 - progress);
      ember.sprite.scale.set(ember.baseScale * (1 - progress * 0.5));
      if (progress >= 1 || ember.sprite.y < -20) spawn(ember, false);
    }
  });

  return {
    renderer: app.renderer.name,
    destroy: () => {
      app.destroy({ removeView: true }, { children: true, texture: true, textureSource: true });
    },
  };
}
