// Lets PixiJS run under the packaged game's content security policy, which forbids eval().
import "pixi.js/unsafe-eval";
import { Application, Container, Graphics, Sprite, type Texture } from "pixi.js";
import type { Floor } from "../../../../engine/generate";
import { type Point, samePoint, step } from "../../../../engine/geometry";
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
import type { Hero } from "../../../../engine/run";
import type { FloorPalette } from "./palettes";
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

/** Lantern light: warm next to the hero, dimmer toward the edge of sight. */
const LIGHT_NEAR = [255, 246, 232] as const;
const LIGHT_FAR = [176, 158, 146] as const;
/** Screen space kept clear for the HUD bars, so the map's edges never hide underneath them. */
const HUD_TOP_SPACE = 64;
const HUD_BOTTOM_SPACE = 104;
/** Tiles seen before but not visible now. */
const REMEMBERED_TINT = 0x3c4458;

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
}

/** Draws one dungeon floor with PixiJS. It only displays state; all rules live in the engine. */
export class DungeonView {
  private readonly world = new Container();
  private readonly tiles: Sprite[] = [];
  private readonly stairs = new Container();
  private readonly hero: Sprite;
  private readonly overlay = new Graphics();
  /** Solid rock with no open neighbor is never drawn. */
  private readonly bedrock = new Array<boolean>(MAP_SIZE).fill(false);
  /** Tile textures per palette, made the first time a floor in that palette is shown. */
  private readonly tileTextures = new Map<string, TileTextures>();
  private builtTiles: Floor["tiles"] | null = null;
  private builtPalette: FloorPalette | null = null;
  private model: DungeonModel | null = null;
  private hover: Point | null = null;
  private scale = 1;

  private constructor(
    private readonly app: Application,
    private readonly textures: SpriteTextures,
    options: DungeonViewOptions,
  ) {
    for (let index = 0; index < MAP_SIZE; index++) {
      // Textures (and so sizes) are assigned in buildFloor, once the palette is known.
      const sprite = new Sprite();
      const { x, y } = pointOf(index);
      sprite.position.set(x * TILE_PIXELS, y * TILE_PIXELS);
      this.tiles.push(sprite);
      this.world.addChild(sprite);
    }
    this.hero = new Sprite(textures.hero);
    this.hero.anchor.set(0.5);
    this.world.addChild(this.stairs, this.hero, this.overlay);
    app.stage.addChild(this.world);

    app.stage.eventMode = "static";
    app.stage.hitArea = app.screen;
    app.stage.on("pointermove", (event) => this.setHover(this.tileUnder(event.global)));
    app.stage.on("pointerdown", (event) => {
      if (event.button !== 0) return;
      const tile = this.tileUnder(event.global);
      if (tile) options.onTileClick(tile);
    });
    app.canvas.addEventListener("pointerleave", () => this.setHover(null));
    app.renderer.on("resize", () => this.layout());
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
      const textures = await loadSpriteTextures();
      host.appendChild(app.canvas);
      return new DungeonView(app, textures, options);
    } catch (error) {
      app.destroy(true);
      throw error;
    }
  }

  get rendererName(): string {
    return this.app.renderer.name;
  }

  render(model: DungeonModel): void {
    this.model = model;
    if (model.floor.tiles !== this.builtTiles || model.palette !== this.builtPalette) {
      this.buildFloor(model.floor, model.palette);
    }
    this.applyLight(model);
    this.placeHero(model.hero);
    this.layout();
  }

  destroy(): void {
    this.app.destroy({ removeView: true }, { children: true });
    this.textures.destroy();
    for (const textures of this.tileTextures.values()) textures.destroy();
    this.tileTextures.clear();
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
      this.bedrock[index] = !open && !hasOpenNeighbor(floor, point);
    }

    for (const child of this.stairs.removeChildren()) child.destroy();
    const marks: Array<[Point | null, Texture]> = [
      [floor.downStairs, this.textures.stairsDown],
      [floor.upStairs, this.textures.stairsUp],
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

  private applyLight({ floor, hero, visible }: DungeonModel): void {
    for (let index = 0; index < MAP_SIZE; index++) {
      const sprite = this.tiles[index] as Sprite;
      const seen = visible.has(index);
      sprite.visible = (seen || floor.explored[index] === true) && !this.bedrock[index];
      if (sprite.visible) sprite.tint = seen ? lanternTint(pointOf(index), hero) : REMEMBERED_TINT;
    }
    for (const sprite of this.stairs.children) {
      const index = Number(sprite.label);
      const tile = this.tiles[index] as Sprite;
      sprite.visible = tile.visible;
      (sprite as Sprite).tint = tile.tint;
    }
  }

  private placeHero(hero: Hero): void {
    this.hero.position.set((hero.x + 0.5) * TILE_PIXELS, (hero.y + 0.5) * TILE_PIXELS);
    const size = TILE_PIXELS / this.textures.hero.width;
    this.hero.scale.set(hero.facing === "left" ? -size : size, size);
  }

  /** Scales the world in whole steps and keeps the hero centered, without showing past the map edge. */
  private layout(): void {
    const { width, height } = this.app.screen;
    const fit = Math.min(width / TARGET_COLUMNS, height / TARGET_ROWS) / TILE_PIXELS;
    this.scale = Math.max(2, Math.round(fit));
    this.world.scale.set(this.scale);
    const tile = TILE_PIXELS * this.scale;
    const hero = this.model?.hero ?? { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
    /** Centers the hero in the open space between `before` and `after`, stopping at the map's edges. */
    const axis = (view: number, mapTiles: number, heroTile: number, before = 0, after = 0) => {
      const mapSize = mapTiles * tile;
      const space = view - before - after;
      if (mapSize <= space) return Math.round(before + (space - mapSize) / 2);
      const centered = before + space / 2 - (heroTile + 0.5) * tile;
      return Math.round(Math.min(before, Math.max(view - after - mapSize, centered)));
    };
    this.world.position.set(
      axis(width, MAP_WIDTH, hero.x),
      axis(height, MAP_HEIGHT, hero.y, HUD_TOP_SPACE, HUD_BOTTOM_SPACE),
    );
    this.drawOverlay();
  }

  private tileUnder(global: { x: number; y: number }): Point | null {
    const local = this.world.toLocal(global);
    const tile = { x: Math.floor(local.x / TILE_PIXELS), y: Math.floor(local.y / TILE_PIXELS) };
    return inBounds(tile) ? tile : null;
  }

  private setHover(tile: Point | null): void {
    if (tile === this.hover || (tile && this.hover && samePoint(tile, this.hover))) return;
    this.hover = tile;
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
      if ((dx || dy) && isWalkable(tileAt(floor.tiles, { x: point.x + dx, y: point.y + dy })))
        return true;
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

function lanternTint(point: Point, hero: Point): number {
  const distance = Math.hypot(point.x - hero.x, point.y - hero.y);
  const t = Math.min(1, distance / (SIGHT_RADIUS + 0.5));
  const channel = (i: 0 | 1 | 2) => Math.round(LIGHT_NEAR[i] + (LIGHT_FAR[i] - LIGHT_NEAR[i]) * t);
  return (channel(0) << 16) | (channel(1) << 8) | channel(2);
}
