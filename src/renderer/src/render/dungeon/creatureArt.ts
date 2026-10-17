import { Texture } from "pixi.js";
import { CREATURES, type CreatureKind } from "../../../../engine/creatures";
import { scaleColor } from "./lighting";
import { loadImageTexture, TILE_PIXELS } from "./textures";

/**
 * Creature art is picked up by file name: `assets/sprites/creatures/<creature id>.png` replaces
 * that creature's placeholder automatically. Drop in a file, rebuild, done.
 */
const ART = import.meta.glob<string>("../../assets/sprites/creatures/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

export interface CreatureTextures {
  get(kindId: string): Texture;
  /** True when the creature has real art rather than a placeholder. */
  hasArt(kindId: string): boolean;
  destroy(): void;
}

export async function loadCreatureTextures(): Promise<CreatureTextures> {
  const textures = new Map<string, Texture>();
  const withArt = new Set<string>();
  await Promise.all(
    CREATURES.map(async (kind) => {
      const url = ART[`../../assets/sprites/creatures/${kind.id}.png`];
      if (url) {
        textures.set(kind.id, await loadImageTexture(url));
        withArt.add(kind.id);
      } else {
        textures.set(kind.id, placeholderTexture(kind));
      }
    }),
  );
  return {
    get: (kindId) => textures.get(kindId) ?? Texture.WHITE,
    hasArt: (kindId) => withArt.has(kindId),
    destroy: () => {
      for (const texture of textures.values()) texture.destroy(true);
    },
  };
}

/**
 * A little pixel-art stand-in: a silhouette by behavior (beetle, blob, moth, spiky, long) in the
 * creature's color, with eyes. Guardians wear a crown.
 */
function placeholderTexture(kind: CreatureKind): Texture {
  const size = TILE_PIXELS;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This system could not create a 2D canvas.");
  const css = (color: number) => `#${color.toString(16).padStart(6, "0")}`;
  const base = css(kind.color);
  const dark = css(scaleColor(kind.color, 0.5));
  const light = css(scaleColor(kind.color, 1.35));
  const paint = (x: number, y: number, color: string) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    context.fillStyle = color;
    context.fillRect(x, y, 1, 1);
  };
  /** A filled ellipse with a dark rim and a lit upper edge. */
  const body = (cx: number, cy: number, rx: number, ry: number) => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        if (d > 1) continue;
        const rim = d > 0.62;
        const lit = y < cy - ry * 0.35 && !rim;
        paint(x, y, rim ? dark : lit ? light : base);
      }
    }
  };
  const eyes = (y: number, left: number, right: number) => {
    for (const x of [left, right]) {
      paint(x, y, "#f4f0e6");
      paint(x, y + 1, "#16121a");
    }
  };

  switch (kind.behavior) {
    case "chase": // beetle
      for (const y of [9, 11, 13]) {
        paint(2, y, dark);
        paint(13, y, dark);
      }
      body(7.5, 10.5, 5, 4);
      eyes(8, 5, 10);
      break;
    case "slow": // heavy blob
      body(7.5, 10, 6.5, 5.5);
      eyes(8, 5, 10);
      for (let x = 5; x <= 10; x++) paint(x, 12, dark);
      break;
    case "ranged": // moth
      body(3.5, 8, 3, 4.5);
      body(11.5, 8, 3, 4.5);
      body(7.5, 9, 2, 4);
      eyes(6, 6, 9);
      break;
    case "erratic": // spiky
      for (const [x, y] of [
        [7, 3],
        [3, 6],
        [12, 6],
        [2, 11],
        [13, 11],
        [7, 15],
        [4, 14],
        [11, 14],
      ] as const) {
        paint(x, y, dark);
      }
      body(7.5, 9.5, 4.5, 4.5);
      eyes(8, 6, 9);
      break;
    case "swift": // long and low
      body(7, 11, 6.5, 3);
      for (let x = 12; x <= 15; x++) paint(x, 10, dark);
      eyes(9, 3, 6);
      break;
  }
  if ("guardian" in kind) {
    for (const x of [5, 7, 9, 11]) paint(x, 2, "#ffd45a");
    for (let x = 5; x <= 11; x++) paint(x, 3, "#e0a73d");
  }
  const texture = Texture.from(canvas);
  texture.source.scaleMode = "nearest";
  return texture;
}
