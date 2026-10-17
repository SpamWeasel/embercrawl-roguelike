import { Container, Graphics, Sprite } from "pixi.js";
import type { Point } from "../../../../engine/geometry";
import type { FloorItem, Trap } from "../../../../engine/items";
import { indexOf } from "../../../../engine/map";
import type { LootTextures } from "./lootArt";
import { clamp01, easeOutCubic } from "./motion";
import { TILE_PIXELS } from "./textures";

/** How an item's tile looks right now, so the item is lit and faded the same way. */
export interface TileLook {
  readonly shown: boolean;
  readonly alpha: number;
  readonly tint: number;
  /** 1 when in the hero's sight, 0 when only remembered. */
  readonly sight: number;
}

interface Piece {
  readonly item: FloorItem;
  readonly sprite: Sprite;
  readonly shadow: Graphics;
  /** Offsets each item's gentle bob, so they don't all move in step. */
  readonly phase: number;
  /** Time since it was set down mid-floor (a short drop and settle); null once settled. */
  spawnMs: number | null;
  /** Set when picked up: counts up from minus the delay, then lifts and fades the item away. */
  leavingMs: number | null;
}

/** Items are drawn a little smaller than a tile, standing on its lower part. */
const ITEM_SIZE = 12;
const SPAWN_MS = 300;
const LEAVE_MS = 320;

/**
 * Items lying on the floor and the traps the hero has found. Items bob gently, drop in when set
 * down and lift away when picked up; traps glow faintly. Both take the light of their tile.
 */
export class LootLayer {
  /** Goes above the floor glow, below the actors. */
  readonly items = new Container();
  /** Goes on the floor, under everything else. */
  readonly traps = new Container();
  private readonly pieces = new Map<string, Piece>();
  private readonly trapSprites = new Map<string, { trap: Trap; sprite: Sprite }>();

  constructor(
    private readonly textures: LootTextures,
    private readonly reducedMotion: boolean,
  ) {}

  /** Matches sprites to the floor's items and found traps. `rebuild` starts fresh (new floor). */
  sync(items: readonly FloorItem[], traps: readonly Trap[], rebuild: boolean): void {
    if (rebuild) this.clear();
    const present = new Set(items.map((item) => item.id));
    for (const item of items) {
      if (this.pieces.has(item.id)) continue;
      const shadow = new Graphics().ellipse(0, 0, 4.2, 1.3).fill(0x000000);
      const sprite = new Sprite(this.textures.item(item.item));
      sprite.anchor.set(0.5, 1);
      sprite.setSize(ITEM_SIZE);
      this.items.addChild(shadow, sprite);
      this.pieces.set(item.id, {
        item,
        sprite,
        shadow,
        phase: (item.x * 7 + item.y * 13) % 6.28,
        spawnMs: rebuild || this.reducedMotion ? null : 0,
        leavingMs: null,
      });
    }
    for (const [id, piece] of this.pieces) {
      if (!present.has(id) && piece.leavingMs === null) this.remove(id, piece);
    }

    const found = traps.filter((t) => t.found);
    const shown = new Set(found.map((t) => t.id));
    for (const trap of found) {
      if (this.trapSprites.has(trap.id)) continue;
      const sprite = new Sprite(this.textures.trap(trap.kind));
      sprite.position.set(trap.x * TILE_PIXELS, trap.y * TILE_PIXELS);
      sprite.setSize(TILE_PIXELS);
      this.traps.addChild(sprite);
      this.trapSprites.set(trap.id, { trap, sprite });
    }
    for (const [id, entry] of this.trapSprites) {
      if (shown.has(id)) continue;
      entry.sprite.destroy();
      this.trapSprites.delete(id);
    }
  }

  /** Lifts a picked-up item away after `delayMs` (once the hero has stepped onto it). */
  pickUp(id: string, delayMs: number): void {
    const piece = this.pieces.get(id);
    if (piece) piece.leavingMs = -delayMs;
  }

  /** True while anything is dropping in or lifting away. */
  get busy(): boolean {
    for (const piece of this.pieces.values()) {
      if (piece.spawnMs !== null || piece.leavingMs !== null) return true;
    }
    return false;
  }

  update(deltaMs: number, seconds: number, look: (index: number) => TileLook): void {
    for (const [id, piece] of this.pieces) {
      const { item, sprite, shadow } = piece;
      const tile = look(indexOf(item));
      let alpha = tile.shown ? tile.alpha : 0;
      let lift = this.reducedMotion ? 0.5 : (Math.sin(seconds * 2.2 + piece.phase) + 1) * 0.6;
      let scale = 1;
      if (piece.spawnMs !== null) {
        piece.spawnMs += deltaMs;
        const t = clamp01(piece.spawnMs / SPAWN_MS);
        // Falls from above and settles with one small bounce.
        lift +=
          t < 0.7 ? (1 - easeOutCubic(t / 0.7)) * 9 : Math.sin(((t - 0.7) / 0.3) * Math.PI) * 1.5;
        alpha *= clamp01(t * 3);
        if (t >= 1) piece.spawnMs = null;
      }
      if (piece.leavingMs !== null) {
        piece.leavingMs += deltaMs;
        if (piece.leavingMs >= 0) {
          const t = clamp01(piece.leavingMs / LEAVE_MS);
          lift += easeOutCubic(t) * 8;
          scale = 1 + 0.4 * t;
          alpha *= 1 - t * t;
          if (t >= 1) {
            this.remove(id, piece);
            continue;
          }
        }
      }
      sprite.position.set((item.x + 0.5) * TILE_PIXELS, (item.y + 0.9) * TILE_PIXELS - lift);
      sprite.setSize(ITEM_SIZE * scale);
      sprite.alpha = alpha;
      sprite.tint = tile.tint;
      shadow.position.set((item.x + 0.5) * TILE_PIXELS, (item.y + 0.9) * TILE_PIXELS);
      shadow.scale.set(1 - Math.min(0.5, lift / 18));
      shadow.alpha = alpha * 0.32;
    }
    for (const { trap, sprite } of this.trapSprites.values()) {
      const tile = look(indexOf(trap));
      const pulse = this.reducedMotion ? 0.85 : 0.72 + 0.2 * Math.sin(seconds * 2.6 + trap.x);
      sprite.alpha = tile.shown ? tile.alpha * (tile.sight > 0 ? pulse : 0.55) : 0;
      sprite.tint = tile.tint;
    }
  }

  /** Items in plain view, for the occasional glint. */
  glintSpots(look: (index: number) => TileLook): Point[] {
    const spots: Point[] = [];
    for (const piece of this.pieces.values()) {
      if (piece.leavingMs === null && look(indexOf(piece.item)).sight > 0.5) spots.push(piece.item);
    }
    return spots;
  }

  clear(): void {
    for (const [id, piece] of this.pieces) this.remove(id, piece);
    for (const { sprite } of this.trapSprites.values()) sprite.destroy();
    this.trapSprites.clear();
  }

  private remove(id: string, piece: Piece): void {
    piece.sprite.destroy();
    piece.shadow.destroy();
    this.pieces.delete(id);
  }
}
