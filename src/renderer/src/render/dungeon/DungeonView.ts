// Lets PixiJS run under the packaged game's content security policy, which forbids eval().
import "pixi.js/unsafe-eval";
import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import { creatureKind, type Monster } from "../../../../engine/creatures";
import type { Floor } from "../../../../engine/generate";
import {
  DIRECTION_VECTORS,
  type Direction,
  type Point,
  samePoint,
  step,
} from "../../../../engine/geometry";
import { itemKind, type SupplyId, type SupplyKind, trapKind } from "../../../../engine/items";
import {
  inBounds,
  indexOf,
  isWalkable,
  MAP_HEIGHT,
  MAP_SIZE,
  MAP_WIDTH,
  pointOf,
  tileAt,
} from "../../../../engine/map";
import { PULSE_RADIUS } from "../../../../engine/rules";
import { type GameEvent, type Hero, walkRoute } from "../../../../engine/run";
import { STEP_MS } from "../../game/timing";
import { CreatureRig } from "./CreatureRig";
import { cameraOffset, crispScale, snapToPixel } from "./camera";
import { type CreatureTextures, loadCreatureTextures } from "./creatureArt";
import { EffectLayer } from "./effects";
import { HeroRig } from "./HeroRig";
import { LootLayer, type TileLook } from "./LootLayer";
import { flicker, lanternLevel, REMEMBERED_TINT, scaleColor, tileTint } from "./lighting";
import { type LootTextures, loadLootTextures } from "./lootArt";
import { approach, clamp01, moveToward, StepQueue } from "./motion";
import type { FloorPalette } from "./palettes";
import { ParticleField } from "./particles";
import {
  createCampTextures,
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
const HUD_BOTTOM_SPACE = 128;

const REDUCED_STEP_MS = 50;
/** Fades, in milliseconds. */
const SIGHT_FADE_MS = 160;
const REVEAL_FADE_MS = 240;
const FADE_OUT_MS = 170;
const FADE_IN_MS = 340;
/** The camera covers half the distance to its target in this time. */
const CAMERA_HALF_LIFE_MS = 55;
/** The lantern's reach eases to its new size over about this half-life when toggled. */
const LIGHT_HALF_LIFE_MS = 110;
/** After this long with nothing moving, drawing drops to 30 frames a second to save power. */
const IDLE_MS = 2000;
/** Ranged shots take this long to fly. */
const BOLT_MS = 150;

/** Average number of lantern motes drifting around the hero. */
const MOTE_COUNT = 14;
const MOTE_LIFE_S = 3.5;
const EMBER_COLORS = [0xffd9a0, 0xffb066, 0xff8a3d] as const;

const ROUTE_COLOR = 0xffa45c;
const NO_ROUTE_COLOR = 0x8a8f9c;
const DAMAGE_DEALT_COLOR = 0xfff1d6;
const DAMAGE_TAKEN_COLOR = 0xff5a4a;
const SHIELD_COLOR = 0x8fc8ff;
const HEAL_COLOR = 0x8ff0a0;
const LEVEL_COLOR = 0xffd45a;
const PICKUP_COLOR = 0xffe2a8;
const MUTED_COLOR = 0xb8b0a8;
const CHARGE_COLOR = 0xffc060;
const VIGOR_COLOR = 0xff7a8a;
const WAYSTONE_COLOR = 0xbfd4ff;
const SURVEY_COLOR = 0x9fe6ff;
const FLARE_COLORS = [0xffe0a0, 0xffb347, 0xff6a2a] as const;
const CRATE_COLORS = [0x8a5a30, 0xb07a44, 0x9aa0a8] as const;

/** A Survey Lens reveals the floor as a ripple spreading this many tiles a second. */
const SURVEY_WAVE_TILES_PER_S = 30;
/** Items in view glint about this often, all together, per second. */
const GLINT_RATE = 0.9;

export interface DungeonModel {
  readonly floor: Floor;
  readonly palette: FloorPalette;
  readonly hero: Hero;
  readonly visible: ReadonlySet<number>;
  /** How far the lantern reaches right now, in tiles. */
  readonly sightRadius: number;
}

export interface DungeonViewOptions {
  onTileClick(tile: Point): void;
  /** The tile under the mouse changed (null when the mouse leaves the map). */
  onHover?(tile: Point | null): void;
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
  private readonly camp = new Sprite();
  private readonly campGlow: Sprite;
  /** Dust stays under the actors; motes and embers float over them. */
  private readonly ground = new ParticleField(200);
  private readonly air = new ParticleField(320);
  private readonly glow: Sprite;
  private readonly glowMask = new Graphics();
  /** The hero and creatures, drawn nearest-last so they overlap naturally. */
  private readonly actors = new Container();
  private readonly overlay = new Graphics();
  private readonly fade = new Graphics();
  private readonly effects: EffectLayer;
  private readonly hero: HeroRig;
  private readonly steps: StepQueue;
  private readonly stepMs: number;
  private readonly reducedMotion: boolean;
  private readonly campTextures = createCampTextures();
  private readonly loot: LootLayer;
  private readonly onHover: DungeonViewOptions["onHover"];
  /** Where a Survey Lens was used, and when; its reveal ripples outward from there. */
  private surveyWave: { origin: Point; ms: number } | null = null;
  private readonly rigs = new Map<string, CreatureRig>();
  private monstersById = new Map<string, Monster>();
  /** Small delays so a strike plays after the step that provoked it. */
  private timers: Array<{ at: number; run: () => void }> = [];

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
  private lightRadius = 4;
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
    private readonly creatureTextures: CreatureTextures,
    private readonly lootTextures: LootTextures,
    options: DungeonViewOptions,
  ) {
    this.reducedMotion = options.reducedMotion;
    this.onHover = options.onHover;
    this.stepMs = options.reducedMotion ? REDUCED_STEP_MS : STEP_MS;
    this.steps = new StepQueue(this.display, this.stepMs);
    this.loot = new LootLayer(lootTextures, options.reducedMotion);

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
    this.campGlow = new Sprite(this.glow.texture);
    this.campGlow.anchor.set(0.5);
    this.campGlow.blendMode = "add";
    this.camp.visible = false;
    this.campGlow.visible = false;
    this.actors.sortableChildren = true;
    this.actors.addChild(this.hero.container);
    this.effects = new EffectLayer((p) => this.world.toGlobal(p), this.glow.texture);
    this.world.addChild(
      this.stairs,
      this.camp,
      this.loot.traps,
      this.ground.container,
      this.glowMask,
      this.glow,
      this.campGlow,
      this.loot.items,
      this.actors,
      this.effects.world,
      this.air.container,
      this.overlay,
    );
    app.stage.addChild(this.world, this.effects.screen, this.fade);

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
      const [sprites, creatures, loot] = await Promise.all([
        loadSpriteTextures(),
        loadCreatureTextures(),
        loadLootTextures(),
      ]);
      host.appendChild(app.canvas);
      return new DungeonView(app, sprites, creatures, loot, options);
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
      // A different floor without stairs (a new descent): fade it in.
      this.applyFloor(model);
      this.transition = { phase: "in", ms: 0 };
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
    this.syncCreatures(model.floor.monsters, false);
    this.loot.sync(model.floor.items, model.floor.traps, false);
    this.drawCamp(model.floor);
    this.drawGlowMask(model.visible);
    this.drawOverlay();
  }

  /** Plays what just happened in the game as animation. */
  handleEvents(events: readonly GameEvent[]): void {
    this.markActive();
    let heroStepped = false;
    /** Creature strikes start once the hero's own move has landed, and stagger after each other. */
    let strikeAt = 0;
    for (const event of events) {
      switch (event.type) {
        case "moved":
          if (this.transition) break;
          this.steps.push({ from: event.from, to: event.to });
          this.expectedHero = event.to;
          this.footstepDust(event.from, event.direction);
          heroStepped = true;
          break;
        case "blocked": {
          const { x, y } = DIRECTION_VECTORS[event.direction];
          this.hero.startBump(x, y);
          this.bumpDust(event.direction);
          if (!this.reducedMotion) this.shake = Math.max(this.shake, 1.6);
          break;
        }
        case "attacked": {
          const { x, y } = DIRECTION_VECTORS[event.direction];
          this.hero.lunge(x, y);
          this.later(70, () => {
            this.rigs.get(event.target)?.flash();
            this.effects.number(
              this.centerOf(event.at, 0.4),
              String(event.damage),
              DAMAGE_DEALT_COLOR,
            );
            this.sparks(event.at, 0xfff0c8, 8);
          });
          strikeAt = Math.max(strikeAt, 170);
          break;
        }
        case "monster-died": {
          const rig = this.rigs.get(event.id);
          if (rig) rig.doomed = true;
          this.later(120, () => {
            rig?.die();
            this.sparks(event.at, creatureKind(event.kind).color, 16);
            this.effects.number(this.centerOf(event.at, 0.8), `+${event.xp} xp`, LEVEL_COLOR);
          });
          break;
        }
        case "monster-moved": {
          const rig = this.rigs.get(event.id);
          if (!rig) break;
          rig.steps.push({ from: event.from, to: event.to });
          rig.expected = event.to;
          break;
        }
        case "monster-noticed":
          this.rigs.get(event.id)?.noticed();
          break;
        case "monster-struck": {
          const delay = Math.max(strikeAt, heroStepped ? this.stepMs * 0.6 : 40);
          strikeAt = delay + 140;
          const rig = this.rigs.get(event.id);
          const hurt = () => this.heroHurt(event.damage, event.absorbed);
          this.later(delay, () => {
            const heroAt = this.expectedHero ?? event.from;
            rig?.strikeToward(heroAt, event.from);
            if (event.ranged) {
              this.effects.bolt(
                this.centerOf(event.from, 0.55),
                this.centerOf(heroAt, 0.55),
                creatureKind(event.kind).color,
                BOLT_MS,
                hurt,
              );
            } else {
              this.later(80, hurt);
            }
          });
          break;
        }
        case "leveled-up":
          this.later(260, () => this.levelUpBurst(event.level));
          break;
        case "pulsed":
          this.pulseWave(event.at);
          break;
        case "rested":
          this.later(60, () => {
            const at = this.expectedHero ?? this.display;
            if (event.healed > 0)
              this.effects.number(this.centerOf(at, 0.9), `+${event.healed}`, HEAL_COLOR);
            this.sparks(at, HEAL_COLOR, 12, true);
            this.hero.flash(HEAL_COLOR);
          });
          break;
        case "lantern":
          if (event.bright) this.sparks(this.expectedHero ?? this.display, 0xffe2a0, 10, true);
          break;
        case "died":
          this.later(strikeAt + 160, () => {
            this.hero.collapse();
            if (!this.reducedMotion) this.shake = Math.max(this.shake, 4);
          });
          break;
        case "changed-floor":
          this.transition = { phase: "out", ms: 0 };
          this.hero.startSink();
          break;
        case "monster-hurt":
          this.later(110, () => {
            this.rigs.get(event.id)?.flash();
            this.effects.number(
              this.centerOf(event.at, 0.4),
              String(event.damage),
              DAMAGE_DEALT_COLOR,
            );
            this.sparks(event.at, 0xffc070, 8);
          });
          strikeAt = Math.max(strikeAt, 220);
          break;
        case "picked-up": {
          // The item lifts away once the hero has stepped onto it.
          const delay = heroStepped ? this.stepMs * 0.7 : 30;
          this.loot.pickUp(event.loot, delay);
          this.later(delay, () => {
            const name = itemKind(event.item).name;
            if (event.fromCache) this.crateBurst(event.at);
            this.sparks(event.at, PICKUP_COLOR, event.fromCache ? 14 : 8, true);
            this.effects.label(
              this.centerOf(event.at, 1.05),
              event.fromCache ? `${name}!` : name,
              PICKUP_COLOR,
            );
          });
          break;
        }
        case "pack-full":
          this.later(heroStepped ? this.stepMs * 0.7 : 30, () =>
            this.effects.label(
              this.centerOf(this.expectedHero ?? this.display, 1.05),
              "Pack full",
              MUTED_COLOR,
            ),
          );
          break;
        case "used":
          this.supplyUsed(event.item, event.amount);
          break;
        case "teleported":
          this.waystoneJump(event.from, event.to);
          break;
        case "equipped": {
          const at = this.expectedHero ?? this.display;
          this.effects.ring(this.centerOf(at, 0.5), TILE_PIXELS * 0.9, PICKUP_COLOR, 320);
          this.sparks(at, PICKUP_COLOR, 8, true);
          this.hero.flash(0xfff0c8);
          this.effects.label(this.centerOf(at, 1.05), itemKind(event.item).name, PICKUP_COLOR);
          break;
        }
        case "trap-found":
          this.later(80, () => {
            const color = trapKind(event.kind).color;
            this.effects.ring(this.centerOf(event.at, 0.5), TILE_PIXELS * 0.9, color, 420);
            this.sparks(event.at, color, 6, true);
          });
          break;
        case "trap-sprung": {
          const delay = heroStepped ? this.stepMs * 0.75 : 40;
          this.later(delay, () => this.trapSprung(event));
          strikeAt = Math.max(strikeAt, delay + 160);
          break;
        }
        case "waited":
        case "no-stairs":
        case "monster-readied":
        case "spotted":
        case "not-enough-charge":
        case "camp-spent":
        case "nothing-here":
        case "item-unneeded":
        case "already-equipped":
        case "dropped":
        case "cannot-drop":
          break;
      }
    }
  }

  destroy(): void {
    this.ground.destroy();
    this.air.destroy();
    this.effects.clear();
    this.loot.clear();
    const glowTexture = this.glow.texture;
    this.app.destroy({ removeView: true }, { children: true });
    glowTexture.destroy(true);
    this.sprites.destroy();
    this.creatureTextures.destroy();
    this.lootTextures.destroy();
    this.campTextures.destroy();
    for (const textures of this.tileTextures.values()) textures.destroy();
    this.tileTextures.clear();
  }

  private update(rawDeltaMs: number): void {
    const deltaMs = Math.min(rawDeltaMs, this.wakeFromIdle ? 1000 / 60 : 50);
    this.wakeFromIdle = false;
    this.elapsedMs += deltaMs;
    const model = this.model;
    if (!model) return;

    this.runTimers();
    this.advanceTransition(deltaMs);
    const frame = this.steps.update(deltaMs);
    if (frame.landed && !frame.chained) this.hero.landed();
    this.display = frame.position;
    this.lightRadius = approach(this.lightRadius, model.sightRadius, deltaMs, LIGHT_HALF_LIFE_MS);
    const seconds = this.elapsedMs / 1000;
    this.hero.update(deltaMs, seconds, this.display, frame.progress);
    this.hero.container.zIndex = this.hero.container.y + 0.5;
    this.updateCreatures(deltaMs, seconds);
    this.updateLight(deltaMs, seconds);
    this.loot.update(deltaMs, seconds, this.tileLook);
    this.updateParticles(deltaMs);
    this.updateCamera(deltaMs);
    this.effects.update(deltaMs);

    const busy =
      this.steps.busy ||
      this.transition !== null ||
      this.shake > 0.05 ||
      this.timers.length > 0 ||
      this.surveyWave !== null ||
      this.loot.busy ||
      [...this.rigs.values()].some((rig) => rig.steps.busy || rig.dying);
    if (busy) this.lastActivityMs = this.elapsedMs;
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

  private later(delayMs: number, run: () => void): void {
    this.timers.push({ at: this.elapsedMs + delayMs, run });
  }

  private runTimers(): void {
    if (this.timers.length === 0) return;
    const due = this.timers.filter((t) => t.at <= this.elapsedMs);
    if (due.length === 0) return;
    this.timers = this.timers.filter((t) => t.at > this.elapsedMs);
    for (const timer of due) timer.run();
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
    this.lightRadius = model.sightRadius;
    this.hero.reset();
    this.hero.face(model.hero.facing, true);
    this.camera.ready = false;
    this.timers = [];
    this.ground.clear();
    this.air.clear();
    this.effects.clear();
    this.surveyWave = null;
    this.syncCreatures(model.floor.monsters, true);
    this.loot.sync(model.floor.items, model.floor.traps, true);
    this.drawCamp(model.floor);
    this.drawGlowMask(model.visible);
    this.drawOverlay();
  }

  private setTargets({ floor, visible }: DungeonModel): void {
    for (let index = 0; index < MAP_SIZE; index++) {
      this.sightTarget[index] = visible.has(index) ? 1 : 0;
      this.revealTarget[index] = floor.explored[index] || visible.has(index) ? 1 : 0;
    }
  }

  /** Matches creature rigs to the creatures in the game state. `rebuild` starts fresh (new floor). */
  private syncCreatures(monsters: readonly Monster[], rebuild: boolean): void {
    if (rebuild) {
      for (const rig of this.rigs.values()) rig.container.destroy({ children: true });
      this.rigs.clear();
    }
    this.monstersById = new Map(monsters.map((m) => [m.id, m]));
    for (const monster of monsters) {
      let rig = this.rigs.get(monster.id);
      if (!rig) {
        rig = new CreatureRig(
          monster,
          this.creatureTextures.get(monster.kind),
          this.stepMs,
          this.reducedMotion,
        );
        this.rigs.set(monster.id, rig);
        this.actors.addChild(rig.container);
      }
      if (!samePoint(rig.expected, monster)) {
        rig.steps.snap(monster);
        rig.expected = { x: monster.x, y: monster.y };
      }
      rig.face(monster.facing);
    }
    for (const [id, rig] of this.rigs) {
      if (this.monstersById.has(id) || rig.doomed) continue;
      rig.container.destroy({ children: true });
      this.rigs.delete(id);
    }
  }

  private updateCreatures(deltaMs: number, seconds: number): void {
    for (const [id, rig] of this.rigs) {
      const monster = this.monstersById.get(id);
      const frame = rig.steps.update(deltaMs);
      const tile = monster ?? rig.expected;
      const visibility = this.sight[indexOf(tile)] ?? 0;
      const alive = rig.update(
        deltaMs,
        seconds,
        frame.position,
        frame.progress,
        visibility,
        monster,
      );
      rig.container.zIndex = rig.container.y;
      if (!alive) {
        rig.container.destroy({ children: true });
        this.rigs.delete(id);
      }
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

  private drawCamp(floor: Floor): void {
    const camp = floor.camp;
    this.camp.visible = camp !== null;
    this.campGlow.visible = camp !== null && !floor.campUsed;
    if (!camp) return;
    this.camp.texture = floor.campUsed ? this.campTextures.spent : this.campTextures.lit;
    this.camp.position.set(camp.x * TILE_PIXELS, camp.y * TILE_PIXELS);
    this.camp.setSize(TILE_PIXELS, TILE_PIXELS);
    this.campGlow.position.set((camp.x + 0.5) * TILE_PIXELS, (camp.y + 0.55) * TILE_PIXELS);
  }

  /** Fades tiles in and out of sight and lights them from where the hero is drawn right now. */
  private updateLight(deltaMs: number, seconds: number): void {
    const strength = flicker(seconds, this.reducedMotion ? 0.3 : 1);
    const radius = this.lightRadius;
    const { x: hx, y: hy } = this.display;
    // A Survey Lens reveals tiles only once its ripple has spread out to them.
    const wave = this.surveyWave;
    const waveReach = wave ? ((this.elapsedMs - wave.ms) / 1000) * SURVEY_WAVE_TILES_PER_S : 0;
    if (wave && waveReach > MAP_WIDTH + MAP_HEIGHT) this.surveyWave = null;
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
      const waiting =
        wave !== null &&
        this.sightTarget[index] === 0 &&
        Math.hypot(
          (index % MAP_WIDTH) - wave.origin.x,
          Math.floor(index / MAP_WIDTH) - wave.origin.y,
        ) > waveReach;
      const reveal = waiting
        ? (this.reveal[index] as number)
        : moveToward(
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
      sprite.tint = tileTint(sight, lanternLevel(distance, radius) * strength);
    }
    for (const mark of this.stairs.children as Sprite[]) {
      const tile = this.tiles[Number(mark.label)] as Sprite;
      mark.visible = tile.visible;
      mark.alpha = tile.alpha;
      mark.tint = tile.tint;
    }
    const camp = this.model?.floor.camp;
    if (camp && this.camp.visible) {
      const tile = this.tiles[indexOf(camp)] as Sprite;
      this.camp.alpha = tile.visible ? tile.alpha : 0;
      this.camp.tint = tile.tint;
      const campFlicker = flicker(seconds * 1.7 + 3, this.reducedMotion ? 0.3 : 1.6);
      this.campGlow.setSize(TILE_PIXELS * 2.6 * campFlicker);
      this.campGlow.alpha = (this.sight[indexOf(camp)] ?? 0) * 0.55 * campFlicker;
    }
    const bright = (this.model?.sightRadius ?? 4) > 4;
    const diameter = (radius * 2 + 1) * TILE_PIXELS;
    this.glow.position.set((hx + 0.5) * TILE_PIXELS, (hy + 0.5) * TILE_PIXELS);
    this.glow.setSize(diameter * (0.97 + 0.03 * strength));
    this.glow.alpha = clamp01((bright ? 0.62 : 0.5) * strength);
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
      const reach = Math.sqrt(Math.random()) * this.lightRadius * 0.85 * TILE_PIXELS;
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
    if (!this.reducedMotion && !this.transition && Math.random() < GLINT_RATE * seconds) {
      // Now and then, something lying in view catches the light.
      const spots = this.loot.glintSpots(this.tileLook);
      if (spots.length > 0) {
        const spot = pick(spots);
        this.air.emit({
          shape: "dot",
          glow: true,
          x: (spot.x + 0.3 + Math.random() * 0.4) * TILE_PIXELS,
          y: (spot.y + 0.35 + Math.random() * 0.3) * TILE_PIXELS,
          vy: -3,
          life: 0.45,
          size: 2.2,
          color: 0xfff4d0,
          alpha: 0.9,
        });
      }
    }
    this.ground.update(seconds);
    this.air.update(seconds);
  }

  /** How a tile looks this frame, for things drawn on it (items and traps). */
  private readonly tileLook = (index: number): TileLook => {
    const sprite = this.tiles[index] as Sprite;
    return {
      shown: sprite.visible,
      alpha: sprite.alpha,
      tint: sprite.tint,
      sight: this.sight[index] ?? 0,
    };
  };

  /** Eases the camera after the hero, with a little shake after bumps and blows. */
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

  /** A tile's center in world pixels, raised by `lift` tiles (e.g. a creature's chest). */
  private centerOf(tile: Point, lift = 0.5): Point {
    return { x: (tile.x + 0.5) * TILE_PIXELS, y: (tile.y + 1 - lift) * TILE_PIXELS };
  }

  private heroHurt(damage: number, absorbed: number): void {
    const at = this.centerOf(this.expectedHero ?? this.display, 0.75);
    const lost = damage - absorbed;
    if (absorbed > 0) this.effects.number({ x: at.x - 5, y: at.y }, `-${absorbed}`, SHIELD_COLOR);
    if (lost > 0)
      this.effects.number(
        { x: at.x + (absorbed > 0 ? 5 : 0), y: at.y },
        `-${lost}`,
        DAMAGE_TAKEN_COLOR,
      );
    this.hero.flash(lost > 0 ? DAMAGE_TAKEN_COLOR : SHIELD_COLOR);
    this.sparks(this.expectedHero ?? this.display, lost > 0 ? 0xff7a5a : SHIELD_COLOR, 7);
    if (!this.reducedMotion) this.shake = Math.max(this.shake, 1.8 + Math.min(3, lost * 0.25));
  }

  private levelUpBurst(level: number): void {
    const at = this.expectedHero ?? this.display;
    const center = this.centerOf(at, 0.5);
    this.effects.ring(center, TILE_PIXELS * 1.6, LEVEL_COLOR, 520);
    this.effects.number(this.centerOf(at, 1.1), `Level ${level}!`, LEVEL_COLOR, true);
    this.sparks(at, LEVEL_COLOR, 22, true);
    this.hero.flash(LEVEL_COLOR);
  }

  private pulseWave(at: Point): void {
    this.effects.ring(this.centerOf(at, 0.5), (PULSE_RADIUS + 0.6) * TILE_PIXELS, 0xffc070, 380);
    this.effects.ring(this.centerOf(at, 0.5), (PULSE_RADIUS + 0.2) * TILE_PIXELS, 0xff8a3d, 300);
    this.sparks(at, 0xffd9a0, 24, true);
    if (!this.reducedMotion) this.shake = Math.max(this.shake, 1.2);
  }

  private supplyUsed(item: SupplyId, amount: number): void {
    const at = this.expectedHero ?? this.display;
    const effect = (itemKind(item) as SupplyKind).effect;
    switch (effect.kind) {
      case "heal":
        this.effects.number(this.centerOf(at, 0.9), `+${amount}`, HEAL_COLOR);
        this.sparks(at, HEAL_COLOR, 14, true);
        this.hero.flash(HEAL_COLOR);
        break;
      case "vigor":
        this.effects.number(this.centerOf(at, 0.9), `+${amount} max`, VIGOR_COLOR);
        this.sparks(at, VIGOR_COLOR, 16, true);
        this.hero.flash(VIGOR_COLOR);
        break;
      case "charge":
        this.effects.number(this.centerOf(at, 0.9), `+${amount}`, CHARGE_COLOR);
        this.effects.ring(this.centerOf(at, 0.5), TILE_PIXELS * 1.4, CHARGE_COLOR, 420);
        this.sparks(at, CHARGE_COLOR, 16, true);
        break;
      case "shield":
        this.effects.ring(this.centerOf(at, 0.5), TILE_PIXELS * 1.1, SHIELD_COLOR, 380);
        this.effects.ring(this.centerOf(at, 0.5), TILE_PIXELS * 0.7, SHIELD_COLOR, 300);
        this.effects.number(this.centerOf(at, 0.9), `+${amount}`, SHIELD_COLOR);
        this.hero.flash(SHIELD_COLOR);
        break;
      case "flare":
        this.effects.ring(
          this.centerOf(at, 0.5),
          (effect.radius + 0.6) * TILE_PIXELS,
          0xffb347,
          420,
        );
        this.effects.ring(
          this.centerOf(at, 0.5),
          (effect.radius + 0.2) * TILE_PIXELS,
          0xff6a2a,
          340,
        );
        this.flareBurst(at);
        if (!this.reducedMotion) this.shake = Math.max(this.shake, 2.4);
        break;
      case "survey":
        this.surveyWave = { origin: { x: at.x, y: at.y }, ms: this.elapsedMs };
        this.effects.ring(this.centerOf(at, 0.5), TILE_PIXELS * 9, SURVEY_COLOR, 1000);
        this.sparks(at, SURVEY_COLOR, 12, true);
        break;
      case "waystone":
        break; // Shown by the "teleported" event that follows.
    }
  }

  /** The hero vanishes in a shimmer and reappears at the Waystone's landing spot. */
  private waystoneJump(from: Point, to: Point): void {
    this.sparks(from, WAYSTONE_COLOR, 18, true);
    this.effects.ring(this.centerOf(from, 0.5), TILE_PIXELS * 1.2, WAYSTONE_COLOR, 320);
    this.steps.snap(to);
    this.expectedHero = to;
    this.display = to;
    this.later(60, () => {
      this.effects.ring(this.centerOf(to, 0.5), TILE_PIXELS * 1.2, WAYSTONE_COLOR, 380);
      this.sparks(to, WAYSTONE_COLOR, 18, true);
      this.hero.flash(WAYSTONE_COLOR);
    });
  }

  private trapSprung(event: Extract<GameEvent, { type: "trap-sprung" }>): void {
    const color = trapKind(event.kind).color;
    const center = this.centerOf(event.at, 0.5);
    switch (event.kind) {
      case "ember-vent":
        this.flareBurst(event.at);
        this.heroHurt(event.damage, event.absorbed);
        break;
      case "alarm-glyph":
        for (const delay of [0, 140, 280]) {
          this.later(delay, () => this.effects.ring(center, TILE_PIXELS * 3, color, 520));
        }
        this.effects.label(this.centerOf(event.at, 1.1), "!!", color);
        if (!this.reducedMotion) this.shake = Math.max(this.shake, 1.4);
        break;
      case "gloom-rune":
        this.effects.ring(center, TILE_PIXELS * 1.4, color, 460);
        this.sparks(event.at, 0x5a3aa0, 18, true);
        if (event.drained > 0)
          this.effects.number(this.centerOf(event.at, 0.9), `-${event.drained}`, color);
        break;
    }
  }

  /** Fire leaping up from a tile: a flare bursting, or an ember vent going off. */
  private flareBurst(tile: Point): void {
    if (this.reducedMotion) return;
    for (let i = 0; i < 26; i++) {
      this.air.emit({
        shape: i % 3 === 0 ? "pixel" : "dot",
        glow: true,
        x: (tile.x + 0.5) * TILE_PIXELS + (Math.random() * 8 - 4),
        y: (tile.y + 0.85) * TILE_PIXELS,
        vx: Math.random() * 30 - 15,
        vy: -30 - Math.random() * 45,
        gravity: 10,
        drag: 2.5,
        life: 0.35 + Math.random() * 0.45,
        size: 1.2 + Math.random() * 1.8,
        color: pick(FLARE_COLORS),
        alpha: 0.95,
      });
    }
  }

  /** Splinters flying as a supply cache is broken open. */
  private crateBurst(tile: Point): void {
    if (this.reducedMotion) return;
    const center = this.centerOf(tile, 0.4);
    for (let i = 0; i < 12; i++) {
      const angle = -Math.PI * (0.1 + Math.random() * 0.8);
      const speed = 25 + Math.random() * 35;
      this.ground.emit({
        shape: "pixel",
        x: center.x,
        y: center.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: 90,
        drag: 1.5,
        life: 0.45 + Math.random() * 0.25,
        size: 1 + Math.random() * 0.8,
        color: pick(CRATE_COLORS),
        alpha: 1,
      });
    }
  }

  /** A burst of sparks from a tile; `rise` makes them float up instead of scattering. */
  private sparks(tile: Point, color: number, count: number, rise = false): void {
    if (this.reducedMotion) return;
    const center = this.centerOf(tile, 0.5);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 18 + Math.random() * 34;
      this.air.emit({
        shape: rise ? "dot" : "pixel",
        glow: true,
        x: center.x + (Math.random() * 4 - 2),
        y: center.y + (Math.random() * 4 - 2),
        vx: Math.cos(angle) * speed * (rise ? 0.4 : 1),
        vy: rise ? -14 - Math.random() * 26 : Math.sin(angle) * speed,
        gravity: rise ? 4 : 30,
        drag: 3.5,
        life: 0.35 + Math.random() * (rise ? 0.6 : 0.25),
        size: rise ? 1.6 + Math.random() * 1.6 : 0.9 + Math.random() * 0.7,
        color,
        alpha: 0.95,
      });
    }
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
    this.onHover?.(tile);
  }

  /** Outlines the tile under the mouse and previews the route a click would walk. */
  private drawOverlay(): void {
    const overlay = this.overlay;
    overlay.clear();
    const model = this.model;
    const target = this.hover;
    if (!model || !target || !model.floor.explored[indexOf(target)]) return;
    if (samePoint(target, model.hero)) return;

    // The same route a click would walk: around creatures and known traps.
    const route = isWalkable(tileAt(model.floor.tiles, target))
      ? walkRoute(model.floor, model.hero, target)
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
