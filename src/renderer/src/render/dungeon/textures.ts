import { Texture } from "pixi.js";
import heroUrl from "../../assets/sprites/hero.png";
import stairsDownUrl from "../../assets/sprites/stairs-down.png";
import stairsUpUrl from "../../assets/sprites/stairs-up.png";
import type { FloorPalette } from "./palettes";

/** Generated tiles are tiny pixel art, scaled up by whole numbers so they stay crisp. */
export const TILE_PIXELS = 16;

export interface SpriteTextures {
  readonly hero: Texture;
  readonly stairsDown: Texture;
  readonly stairsUp: Texture;
  destroy(): void;
}

/** Floor and wall tiles in one palette, with a few variants of each for texture. */
export interface TileTextures {
  readonly floors: readonly Texture[];
  readonly walls: readonly Texture[];
  destroy(): void;
}

export async function loadSpriteTextures(): Promise<SpriteTextures> {
  const [hero, stairsDown, stairsUp] = (await Promise.all(
    [heroUrl, stairsDownUrl, stairsUpUrl].map(loadImageTexture),
  )) as [Texture, Texture, Texture];
  return {
    hero,
    stairsDown,
    stairsUp,
    destroy: () => {
      for (const texture of [hero, stairsDown, stairsUp]) texture.destroy(true);
    },
  };
}

/** Draws placeholder stone and brick tiles in a palette's colors, until real tile art arrives. */
export function createTileTextures(palette: FloorPalette): TileTextures {
  const floors = [1, 2, 3, 4].map((variant) =>
    pixelTexture(variant, (paint, random) => drawFloor(paint, random, palette.floor)),
  );
  const walls = [11, 12, 13].map((variant) =>
    pixelTexture(variant, (paint, random) => drawWall(paint, random, palette.wall)),
  );
  return {
    floors,
    walls,
    destroy: () => {
      for (const texture of [...floors, ...walls]) texture.destroy(true);
    },
  };
}

/** A camp: a ring of stones around a small fire, and the same camp gone to ash once used. */
export function createCampTextures(): { lit: Texture; spent: Texture; destroy(): void } {
  const draw = (fire: boolean) =>
    pixelTexture(fire ? 31 : 32, (paint, random) => {
      for (const [x, y] of [
        [4, 10],
        [5, 12],
        [7, 13],
        [9, 13],
        [11, 12],
        [12, 10],
        [5, 8],
        [11, 8],
      ] as const) {
        paint(x, y, "#6f6a66");
        paint(x, y - 1, "#8e8882");
      }
      for (let x = 5; x <= 11; x++) paint(x, 11, "#5a3a22");
      for (let x = 6; x <= 10; x++) paint(x, 10, "#6e4628");
      if (fire) {
        for (const [x, y, color] of [
          [8, 5, "#ffe6a0"],
          [7, 6, "#ffcf6a"],
          [8, 6, "#fff2c8"],
          [9, 6, "#ffb347"],
          [6, 7, "#ff9a3c"],
          [7, 7, "#ffcf6a"],
          [8, 7, "#ffe6a0"],
          [9, 7, "#ff9a3c"],
          [10, 7, "#e0561a"],
          [6, 8, "#e0561a"],
          [7, 8, "#ff9a3c"],
          [8, 8, "#ffcf6a"],
          [9, 8, "#ff9a3c"],
          [10, 8, "#e0561a"],
          [7, 9, "#e0561a"],
          [8, 9, "#ff9a3c"],
          [9, 9, "#e0561a"],
        ] as const) {
          paint(x, y, color);
        }
      } else {
        for (let x = 6; x <= 10; x++) paint(x, 9, random() < 0.3 ? "#a8452a" : "#4a4440");
      }
    });
  const lit = draw(true);
  const spent = draw(false);
  return {
    lit,
    spent,
    destroy: () => {
      lit.destroy(true);
      spent.destroy(true);
    },
  };
}

/**
 * Loads an image through an <img> element rather than fetch(), which the packaged app's file://
 * pages don't support.
 */
export async function loadImageTexture(url: string): Promise<Texture> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const texture = Texture.from(image);
  texture.source.scaleMode = "linear";
  return texture;
}

/**
 * A dimmed copy of a picture: greyed and darkened, for a fixture that is spent or not yet lit (a
 * used camp, the Beacon before it is rekindled) when the owner's art has only one picture.
 */
export async function loadDimmedTexture(url: string): Promise<Texture> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) return Texture.from(image);
  context.filter = "grayscale(0.75) brightness(0.55)";
  context.drawImage(image, 0, 0);
  const texture = Texture.from(canvas);
  texture.source.scaleMode = "linear";
  return texture;
}

type Paint = (x: number, y: number, color: string) => void;

function pixelTexture(
  seed: number,
  painter: (paint: Paint, random: () => number) => void,
): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_PIXELS;
  canvas.height = TILE_PIXELS;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This system could not create a 2D canvas.");
  const paint: Paint = (x, y, color) => {
    context.fillStyle = color;
    context.fillRect(x, y, 1, 1);
  };
  painter(paint, cosmeticRandom(seed));
  const texture = Texture.from(canvas);
  texture.source.scaleMode = "nearest";
  return texture;
}

/** Staggered flagstones with a little speckle. */
function drawFloor(paint: Paint, random: () => number, colors: FloorPalette["floor"]): void {
  for (let y = 0; y < TILE_PIXELS; y++) {
    for (let x = 0; x < TILE_PIXELS; x++) {
      const groutRow = y === 7 || y === 15;
      const groutColumn = y < 7 ? x === 7 || x === 15 : x === 3 || x === 11;
      if (groutRow || groutColumn) {
        paint(x, y, colors.grout);
        continue;
      }
      const roll = random();
      if (colors.glint && roll < 0.025) paint(x, y, colors.glint);
      else if (roll < 0.1) paint(x, y, colors.light);
      else if (roll < 0.18) paint(x, y, colors.dark);
      else paint(x, y, colors.base);
    }
  }
}

/** Brick courses with a lit top edge on each brick. */
function drawWall(paint: Paint, random: () => number, colors: FloorPalette["wall"]): void {
  for (let y = 0; y < TILE_PIXELS; y++) {
    const offset = Math.floor(y / 4) % 2 === 0 ? 7 : 3;
    for (let x = 0; x < TILE_PIXELS; x++) {
      const mortar = y % 4 === 3 || (x - offset + TILE_PIXELS) % 8 === 0;
      if (mortar) paint(x, y, colors.mortar);
      else if (y % 4 === 0) paint(x, y, colors.light);
      else paint(x, y, random() < 0.12 ? colors.dark : colors.base);
    }
  }
}

/** Repeatable speckles, so the same tile variant always looks the same. Not used for game rules. */
function cosmeticRandom(seed: number): () => number {
  let state = seed * 2654435761;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}
