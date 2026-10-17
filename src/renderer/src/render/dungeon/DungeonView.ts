// Lets PixiJS run under the packaged game's content security policy, which forbids eval().
import "pixi.js/unsafe-eval";
import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { Floor } from "../../../../engine/generate";
import {
  DIRECTION_VECTORS,
  type Direction,
  type Point,
  samePoint,
  step,
} from "../../../../engine/geometry";
import {
  inBounds,
  indexOf,
  isWalkable,
  MAP_HEIGHT,
  MAP_SIZE,
  MAP_WIDTH,
  pointOf,
  SIGHT_RADIUS,
  tileAt,
} from "../../../../engine/map";
import { findPath } from "../../../../engine/path";
import type { GameEvent, Hero } from "../../../../engine/run";
import { STEP_MS } from "../../game/timing";
import { cameraOffset, crispScale, snapToPixel } from "./camera";
import { HeroRig } from "./HeroRig";
import { flicker, lanternLevel, REMEMBERED_TINT, scaleColor, tileTint } from "./lighting";
import { approach, clamp01, moveToward, StepQueue } from "./motion";
import type { FloorPalette } from "./palettes";
import { ParticleField } from "./particles";
import {
  createTileTextures,
  loadSpriteTextures,
  type SpriteTextures,
  TILE_PIXELS,
  type TileTextures,
} from "./textures";

/** Roughly how many tiles should fit across and down; the tile scale is chosen to match. */
const TARGET_COLUMNS = 20;
const TARGET_ROWS = 12;
/** Screen space kept clear for the HUD bars, so the map's edges never hide underneath them. */
const HUD_TOP_SPACE = 64;
const HUD_BOTTOM_SPACE = 104;

const REDUCED_STEP_MS = 50;
/** Fades, in milliseconds. */
const SIGHT_FADE_MS = 160;
const REVEAL_FADE_MS = 240;
const FADE_OUT_MS = 170;
const FADE_IN_MS = 340;
/** The camera covers half the distance to its target in this time. */
const CAMERA_HALF_LIFE_MS = 55;
/** After this long with nothing moving, drawing drops to 30 frames a second to save power. */
const IDLE_MS = 2000;

/** Average number of lantern motes drifting around the hero. */
const MOTE_COUNT = 14;
const MOTE_LIFE_S = 3.5;
const EMBER_COLORS = [0xffd9a0, 0xffb066, 0xff8a3d] as const;

const ROUTE_COLOR = 0xffa45c;
const NO_ROUTE_COLOR = 0x8a8f9c;

export interface DungeonModel {
  readonly floor: Floor;
  readonly palette: FloorPalette;
  readonly hero: Hero;
  readonly visible: ReadonlySet<number>;
}

export interface DungeonViewOptions {
  onTileClick(tile: Point): void;
  /** Shorter, calmer animation for players who asked their system for reduced motion. */
  reducedMotion: boolean;
}

type Transition = { phase: "out" | "in"; ms: number };

/**
 * Draws and animates one dungeon floor with PixiJS. It only displays state: the engine has
 * already applied every action, and this view plays the results (`handleEvents`) as animation
 * while drawing the latest state (`render`).
 */
export class DungeonView {
  private readonly world = new Container();
  private readonly tiles: Sprite[] = [];
  private readonly stairs = new Container();
  /** Dust stays under the hero; motes and embers float over it. */
  private readonly ground = new ParticleField(160);
  private readonly air = new ParticleField(240);
  private readonly glow: Sprite;
  private readonly glowMask = new Graphics();
  private readonly overlay = new Graphics();
  private readonly fade = new Graphics();
  private readonly hero: HeroRig;
  private readonly steps: StepQueue;
  private readonly reducedMotion: boolean;

  /** Solid rock with no open neighbor is never drawn. */
  private readonly bedrock = new Uint8Array(MAP_SIZE);
  /** How "in sight" each tile currently looks (fades toward sightTarget). */
  private readonly sight = new Float32Array(MAP_SIZE);
  private readonly sightTarget = new Uint8Array(MAP_SIZE);
  /** How discovered each tile looks (fades in the first time it is seen). */
  private readonly reveal = new Float32Array(MAP_SIZE);
  private readonly revealTarget = new Uint8Array(MAP_SIZE);

  private readonly tileTextures = new Map<string, TileTextures>();
  private builtTiles: Floor["tiles"] | null = null;
  private builtPalette: FloorPalette | null = null;
  private model: DungeonModel | null = null;
  /** A model for the next floor, held until the screen has faded to black. */
  private pendingModel: DungeonModel | null = null;
  /** Where the hero will be once queued steps finish; anything else means a resync. */
  private expectedHero: Point | null = null;
  private transition: Transition | null = null;
  private hover: Point | null = null;
  private display: Point = { x: 0, y: 0 };
  private scale = 1;
  private camera = { x: 0, y: 0, ready: false };
  private shake = 0;
  private elapsedMs = 0;
  private lastActivityMs = 0;
  /** Set when waking from the idle frame rate, so the first frame's long gap doesn't skip animation. */
  private wakeFromIdle = false;

  private constructor(
    private readonly app: Application,
    private readonly sprites: SpriteTextures,
    options: DungeonViewOptions,
  ) {
    this.reducedMotion = options.reducedMotion;
    this.steps = new StepQueue(this.display, options.reducedMotion ? REDUCED_STEP_MS : STEP_MS);

    for (let index = 0; index < MAP_SIZE; index++) {
      // Textures (and so sizes) are assigned in buildFloor, once the palette is known.
      const sprite = new Sprite();
      const { x, y } = pointOf(index);
      sprite.position.set(x * TILE_PIXELS, y * TILE_PIXELS);
      this.tiles.push(sprite);
      this.world.addChild(sprite);
    }

    this.hero = new HeroRig(sprites.hero, options.reducedMotion);
    this.glow = new Sprite(lanternGlowTexture());
    this.glow.anchor.set(0.5);
    this.glow.blendMode = "add";
    // The warm glow only lands on tiles the hero can actually see, never through walls.
    this.glow.mask = this.glowMask;
    this.world.addChild(
      this.stairs,
      this.ground.container,
      this.glowMask,
      this.glow,
      this.hero.container,
      this.air.container,
      this.overlay,
    );
    app.stage.addChild(this.world, this.fade);

    app.stage.eventMode = "static";
    app.stage.hitArea = app.screen;
    app.stage.on("pointermove", (event) => this.setHover(this.tileUnder(event.global)));
    app.stage.on("pointerdown", (event) => {
      if (event.button !== 0) return;
      const tile = this.tileUnder(event.global);
      if (tile) options.onTileClick(tile);
    });
    app.canvas.addEventListener("pointerleave", () => this.setHover(null));
    app.renderer.on("resize", () => {
      this.camera.ready = false;
      this.layout();
    });
    app.ticker.add((ticker) => this.update(ticker.deltaMS));
    this.layout();
  }

  static async create(host: HTMLElement, options: DungeonViewOptions): Promise<DungeonView> {
    const app = new Application();
    await app.init({
      resizeTo: host,
      background: "#050507",
      antialias: false,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: "webgl",
    });
    try {
      const sprites = await loadSpriteTextures();
      host.appendChild(app.canvas);
      return new DungeonView(app, sprites, options);
    } catch (error) {
      app.destroy(true);
      throw error;
    }
  }

  get rendererName(): string {
    return this.app.renderer.name;
  }

  /** Shows the latest game state. Animation toward it happens frame by frame in `update`. */
  render(model: DungeonModel): void {
    this.markActive();
    if (this.transition?.phase === "out") {
      this.pendingModel = model;
      return;
    }
    if (!this.model) {
      this.applyFloor(model);
      this.transition = { phase: "in", ms: 0 };
      return;
    }
    if (model.floor.tiles !== this.builtTiles || model.palette !== this.builtPalette) {
      this.applyFloor(model);
      return;
    }
    this.model = model;
    this.setTargets(model);
    if (!this.expectedHero || !samePoint(this.expectedHero, model.hero)) {
      // Missed or out-of-order events: jump straight to the truth.
      this.steps.snap(model.hero);
      this.expectedHero = model.hero;
    }
    this.hero.face(model.hero.facing);
    this.drawGlowMask(model.visible);
    this.drawOverlay();
  }

  /** Plays what just happened in the game as animation. */
  handleEvents(events: readonly GameEvent[]): void {
    this.markActive();
    for (const event of events) {
      switch (event.type) {
        case "moved":
          if (this.transition) break;
          this.steps.push({ from: event.from, to: event.to });
          this.expectedHero = event.to;
          this.footstepDust(event.from, event.direction);
          break;
        case "blocked": {
          const { x, y } = DIRECTION_VECTORS[event.direction];
          this.hero.startBump(x, y);
          this.bumpDust(event.direction);
          if (!this.reducedMotion) this.shake = Math.max(this.shake, 1.6);
          break;
        }
        case "changed-floor":
          this.transition = { phase: "out", ms: 0 };
          this.hero.startSink();
          break;
        case "waited":
        case "no-stairs":
          break;
      }
    }
  }

  destroy(): void {
    this.ground.destroy();
    this.air.destroy();
    const glowTexture = this.glow.texture;
    this.app.destroy({ removeView: true }, { children: true });
    glowTexture.destroy(true);
    this.sprites.destroy();
    for (const textures of this.tileTextures.values()) textures.destroy();
    this.tileTextures.clear();
  }

  private update(rawDeltaMs: number): void {
    const deltaMs = Math.min(rawDeltaMs, this.wakeFromIdle ? 1000 / 60 : 50);
    this.wakeFromIdle = false;
    this.elapsedMs += deltaMs;
    const model = this.model;
    if (!model) return;

    this.advanceTransition(deltaMs);
    const frame = this.steps.update(deltaMs);
    if (frame.landed && !frame.chained) this.hero.landed();
    this.display = frame.position;
    const seconds = this.elapsedMs / 1000;
    this.hero.update(deltaMs, seconds, this.display, frame.progress);
    this.updateLight(deltaMs, seconds);
    this.updateParticles(deltaMs);
    this.updateCamera(deltaMs);

    if (this.steps.busy || this.transition || this.shake > 0.05)
      this.lastActivityMs = this.elapsedMs;
    const wantedFps = this.elapsedMs - this.lastActivityMs > IDLE_MS ? 30 : 0;
    if (this.app.ticker.maxFPS !== wantedFps) this.app.ticker.maxFPS = wantedFps;
  }

  private markActive(): void {
    this.lastActivityMs = this.elapsedMs;
    if (this.app.ticker.maxFPS !== 0) {
      this.app.ticker.maxFPS = 0;
      this.wakeFromIdle = true;
    }
  }

  /** Builds a floor's tiles and jumps straight to its current state (used on arrival). */
  private applyFloor(model: DungeonModel): void {
    this.buildFloor(model.floor, model.palette);
    this.model = model;
    this.setTargets(model);
    this.sight.set(this.sightTarget);
    this.reveal.set(this.revealTarget);
    this.steps.snap(model.hero);
    this.expectedHero = model.hero;
    this.display = model.hero;
    this.hero.face(model.hero.facing, true);
    this.camera.ready = false;
    this.ground.clear();
    this.air.clear();
    this.drawGlowMask(model.visible);
    this.drawOverlay();
  }

  private setTargets({ floor, visible }: DungeonModel): void {
    for (let index = 0; index < MAP_SIZE; index++) {
      this.sightTarget[index] = visible.has(index) ? 1 : 0;
      this.revealTarget[index] = floor.explored[index] || visible.has(index) ? 1 : 0;
    }
  }

  /** Picks a texture for every tile. Runs once per floor, not every turn. */
  private buildFloor(floor: Floor, palette: FloorPalette): void {
    this.builtTiles = floor.tiles;
    this.builtPalette = palette;
    let textures = this.tileTextures.get(palette.id);
    if (!textures) {
      textures = createTileTextures(palette);
      this.tileTextures.set(palette.id, textures);
    }
    for (let index = 0; index < MAP_SIZE; index++) {
      const sprite = this.tiles[index] as Sprite;
      const point = pointOf(index);
      const variant = tileVariant(point, floor.depth);
      const open = isWalkable(tileAt(floor.tiles, point));
      const choices = open ? textures.floors : textures.walls;
      sprite.texture = choices[variant % choices.length] ?? sprite.texture;
      sprite.setSize(TILE_PIXELS, TILE_PIXELS);
      this.bedrock[index] = !open && !hasOpenNeighbor(floor, point) ? 1 : 0;
    }

    for (const child of this.stairs.removeChildren()) child.destroy();
    const marks: Array<[Point | null, Texture]> = [
      [floor.downStairs, this.sprites.stairsDown],
      [floor.upStairs, this.sprites.stairsUp],
    ];
    for (const [at, texture] of marks) {
      if (!at) continue;
      const sprite = new Sprite(texture);
      sprite.position.set(at.x * TILE_PIXELS, at.y * TILE_PIXELS);
      sprite.setSize(TILE_PIXELS, TILE_PIXELS);
      sprite.label = String(indexOf(at));
      this.stairs.addChild(sprite);
    }
  }

  /** Fades tiles in and out of sight and lights them from where the hero is drawn right now. */
  private updateLight(deltaMs: number, seconds: number): void {
    const strength = flicker(seconds, this.reducedMotion ? 0.3 : 1);
    const { x: hx, y: hy } = this.display;
    for (let index = 0; index < MAP_SIZE; index++) {
      const sprite = this.tiles[index] as Sprite;
      if (this.bedrock[index]) {
        sprite.visible = false;
        continue;
      }
      const sight = moveToward(
        this.sight[index] as number,
        this.sightTarget[index] as number,
        deltaMs,
        1 / SIGHT_FADE_MS,
      );
      const reveal = moveToward(
        this.reveal[index] as number,
        this.revealTarget[index] as number,
        deltaMs,
        1 / REVEAL_FADE_MS,
      );
      this.sight[index] = sight;
      this.reveal[index] = reveal;
      sprite.visible = reveal > 0;
      if (!sprite.visible) continue;
      sprite.alpha = reveal;
      if (sight === 0) {
        sprite.tint = REMEMBERED_TINT;
        continue;
      }
      const distance = Math.hypot((index % MAP_WIDTH) - hx, Math.floor(index / MAP_WIDTH) - hy);
      sprite.tint = tileTint(sight, lanternLevel(distance, SIGHT_RADIUS) * strength);
    }
    for (const mark of this.stairs.children as Sprite[]) {
      const tile = this.tiles[Number(mark.label)] as Sprite;
      mark.visible = tile.visible;
      mark.alpha = tile.alpha;
      mark.tint = tile.tint;
    }
    const diameter = (SIGHT_RADIUS * 2 + 1) * TILE_PIXELS;
    this.glow.position.set((hx + 0.5) * TILE_PIXELS, (hy + 0.5) * TILE_PIXELS);
    this.glow.setSize(diameter * (0.97 + 0.03 * strength));
    this.glow.alpha = clamp01(0.5 * strength);
  }

  private updateParticles(deltaMs: number): void {
    const seconds = deltaMs / 1000;
    if (
      !this.reducedMotion &&
      !this.transition &&
      Math.random() < (MOTE_COUNT / MOTE_LIFE_S) * seconds
    ) {
      // A mote somewhere in the lantern's reach, rising slowly.
      const angle = Math.random() * Math.PI * 2;
      const reach = Math.sqrt(Math.random()) * SIGHT_RADIUS * 0.85 * TILE_PIXELS;
      this.air.emit({
        shape: "dot",
        glow: true,
        x: (this.display.x + 0.5) * TILE_PIXELS + Math.cos(angle) * reach,
        y: (this.display.y + 0.5) * TILE_PIXELS + Math.sin(angle) * reach,
        vy: -2 - Math.random() * 3,
        sway: 2 + Math.random() * 3,
        life: MOTE_LIFE_S * (0.7 + Math.random() * 0.6),
        size: 1.6 + Math.random() * 1.6,
        color: pick(EMBER_COLORS),
        alpha: 0.35 + Math.random() * 0.3,
      });
    }
    this.ground.update(seconds);
    this.air.update(seconds);
  }

  /** Eases the camera after the hero, with a little shake after bumps. */
  private updateCamera(deltaMs: number): void {
    const { width, height } = this.app.screen;
    const tile = TILE_PIXELS * this.scale;
    const targetX = cameraOffset(width, MAP_WIDTH * tile, (this.display.x + 0.5) * tile);
    const targetY = cameraOffset(
      height,
      MAP_HEIGHT * tile,
      (this.display.y + 0.5) * tile,
      HUD_TOP_SPACE,
      HUD_BOTTOM_SPACE,
    );
    if (!this.camera.ready) {
      this.camera = { x: targetX, y: targetY, ready: true };
    } else {
      this.camera.x = approach(this.camera.x, targetX, deltaMs, CAMERA_HALF_LIFE_MS);
      this.camera.y = approach(this.camera.y, targetY, deltaMs, CAMERA_HALF_LIFE_MS);
    }
    this.shake = approach(this.shake, 0, deltaMs, 40);
    const jitter = () => (Math.random() * 2 - 1) * this.shake;
    const resolution = this.app.renderer.resolution;
    this.world.position.set(
      snapToPixel(this.camera.x + jitter(), resolution),
      snapToPixel(this.camera.y + jitter(), resolution),
    );
  }

  /** Fades to black, swaps in the next floor while the screen is dark, then fades back in. */
  private advanceTransition(deltaMs: number): void {
    const transition = this.transition;
    if (!transition) {
      this.fade.alpha = 0;
      return;
    }
    transition.ms += deltaMs;
    if (transition.phase === "out") {
      this.fade.alpha = clamp01(transition.ms / FADE_OUT_MS);
      if (transition.ms < FADE_OUT_MS) return;
      const next = this.pendingModel ?? this.model;
      this.pendingModel = null;
      if (next) this.applyFloor(next);
      this.hero.reset();
      this.transition = { phase: "in", ms: 0 };
      this.arrivalEmbers();
    } else {
      this.fade.alpha = 1 - clamp01(transition.ms / FADE_IN_MS);
      if (transition.ms >= FADE_IN_MS) this.transition = null;
    }
  }

  /** Scales the world in whole steps of the art's pixels, so it stays crisp on any display. */
  private layout(): void {
    const { width, height } = this.app.screen;
    this.scale = crispScale(
      width,
      height,
      this.app.renderer.resolution,
      TILE_PIXELS,
      TARGET_COLUMNS,
      TARGET_ROWS,
    );
    this.world.scale.set(this.scale);
    this.fade.clear().rect(0, 0, width, height).fill(0x000000);
    this.drawOverlay();
  }

  private footstepDust(from: Point, direction: Direction): void {
    if (this.reducedMotion || !this.builtPalette) return;
    const { x: dx } = DIRECTION_VECTORS[direction];
    const color = scaleColor(hexColor(this.builtPalette.floor.light), 1.7);
    for (let i = 0; i < 4; i++) {
      this.ground.emit({
        shape: "pixel",
        x: (from.x + 0.5) * TILE_PIXELS + (Math.random() * 6 - 3),
        y: (from.y + 1) * TILE_PIXELS - 1.5,
        vx: -dx * 8 + (Math.random() * 12 - 6),
        vy: -4 - Math.random() * 6,
        gravity: 18,
        drag: 4,
        life: 0.35 + Math.random() * 0.15,
        size: 1 + Math.random() * 0.6,
        color,
        alpha: 0.7,
      });
    }
  }

  private bumpDust(direction: Direction): void {
    if (this.reducedMotion || !this.builtPalette || !this.model) return;
    const { x, y } = DIRECTION_VECTORS[direction];
    const hero = this.model.hero;
    const color = scaleColor(hexColor(this.builtPalette.wall.light), 1.2);
    for (let i = 0; i < 5; i++) {
      this.ground.emit({
        shape: "pixel",
        x: (hero.x + 0.5 + x * 0.5) * TILE_PIXELS,
        y: (hero.y + 0.6 + y * 0.45) * TILE_PIXELS,
        vx: -x * 10 + (Math.random() * 14 - 7),
        vy: -y * 10 - Math.random() * 8,
        gravity: 20,
        drag: 5,
        life: 0.3 + Math.random() * 0.2,
        size: 0.8 + Math.random() * 0.6,
        color,
        alpha: 0.8,
      });
    }
  }

  private arrivalEmbers(): void {
    if (this.reducedMotion || !this.model) return;
    const { x, y } = this.model.hero;
    for (let i = 0; i < 18; i++) {
      this.air.emit({
        shape: "dot",
        glow: true,
        x: (x + 0.5) * TILE_PIXELS + (Math.random() * 8 - 4),
        y: (y + 0.85) * TILE_PIXELS,
        vx: Math.random() * 40 - 20,
        vy: -18 - Math.random() * 30,
        gravity: 14,
        drag: 2,
        life: 0.6 + Math.random() * 0.6,
        size: 1.8 + Math.random() * 1.4,
        color: pick(EMBER_COLORS),
        alpha: 0.85,
      });
    }
  }

  private drawGlowMask(visible: ReadonlySet<number>): void {
    const mask = this.glowMask.clear();
    for (const index of visible) {
      const { x, y } = pointOf(index);
      mask.rect(x * TILE_PIXELS, y * TILE_PIXELS, TILE_PIXELS, TILE_PIXELS);
    }
    mask.fill(0xffffff);
  }

  private tileUnder(global: { x: number; y: number }): Point | null {
    const local = this.world.toLocal(global);
    const tile = { x: Math.floor(local.x / TILE_PIXELS), y: Math.floor(local.y / TILE_PIXELS) };
    return inBounds(tile) ? tile : null;
  }

  private setHover(tile: Point | null): void {
    if (tile === this.hover || (tile && this.hover && samePoint(tile, this.hover))) return;
    this.hover = tile;
    this.markActive();
    this.drawOverlay();
  }

  /** Outlines the tile under the mouse and previews the route a click would walk. */
  private drawOverlay(): void {
    const overlay = this.overlay;
    overlay.clear();
    const model = this.model;
    const target = this.hover;
    if (!model || !target || !model.floor.explored[indexOf(target)]) return;
    if (samePoint(target, model.hero)) return;

    const explored = (index: number) => model.floor.explored[index] === true;
    const route = isWalkable(tileAt(model.floor.tiles, target))
      ? findPath(model.floor.tiles, model.hero, target, explored)
      : null;
    const color = route ? ROUTE_COLOR : NO_ROUTE_COLOR;
    const line = 1 / this.scale;

    let at: Point = model.hero;
    for (const direction of route?.slice(0, -1) ?? []) {
      at = step(at, direction);
      overlay.circle((at.x + 0.5) * TILE_PIXELS, (at.y + 0.5) * TILE_PIXELS, 1.4);
    }
    overlay.fill({ color, alpha: 0.7 });
    overlay
      .rect(
        target.x * TILE_PIXELS + line,
        target.y * TILE_PIXELS + line,
        TILE_PIXELS - 2 * line,
        TILE_PIXELS - 2 * line,
      )
      .stroke({ color, width: 2 * line, alpha: route ? 0.95 : 0.5 });
  }
}

function hasOpenNeighbor(floor: Floor, point: Point): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && isWalkable(tileAt(floor.tiles, { x: point.x + dx, y: point.y + dy }))) {
        return true;
      }
    }
  }
  return false;
}

/** Stable per-tile variety, so the same floor always looks the same. */
function tileVariant(point: Point, depth: number): number {
  return (
    (Math.imul((point.x * 73856093) ^ (point.y * 19349663) ^ (depth * 83492791), 2654435761) >>>
      7) &
    0xffff
  );
}

function hexColor(css: string): number {
  return Number.parseInt(css.slice(1), 16);
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

/** The lantern's warm halo: brightest at the hero, fading to nothing at the edge of sight. */
function lanternGlowTexture(): Texture {
  const size = 128;
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
  gradient.addColorStop(0, "rgba(255, 176, 96, 0.42)");
  gradient.addColorStop(0.45, "rgba(255, 140, 60, 0.16)");
  gradient.addColorStop(1, "rgba(255, 120, 40, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return Texture.from(canvas);
}
