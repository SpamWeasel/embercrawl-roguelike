import {
  CACHE,
  type GearKind,
  GOLD,
  isSupply,
  itemKind,
  type LootId,
  type SupplyKind,
  type TrapKind,
  trapKind,
} from "../../../engine/items";
import { mixColor, scaleColor } from "./dungeon/lighting";

/**
 * Item and trap art is picked up by file name: `assets/sprites/items/<item id>.png` (or
 * `traps/<trap id>.png`) replaces the drawn placeholder automatically. The cache's id is "cache".
 */
const ITEM_ART = import.meta.glob<string>("../assets/sprites/items/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});
const TRAP_ART = import.meta.glob<string>("../assets/sprites/traps/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

export interface ArtImage {
  readonly url: string;
  /** Drawn pixel art, best scaled up with hard edges; real art is smooth-scaled. */
  readonly placeholder: boolean;
}

const cache = new Map<string, ArtImage>();

/** The picture for an item (or a supply cache): the owner's art if there is some, else a placeholder. */
export function itemArt(id: LootId): ArtImage {
  return remember(`item:${id}`, () => {
    const url = ITEM_ART[`../assets/sprites/items/${id}.png`];
    if (url) return { url, placeholder: false };
    return { url: drawItem(id), placeholder: true };
  });
}

/** The picture for a found trap, drawn flat on the floor. */
export function trapArt(kind: TrapKind): ArtImage {
  return remember(`trap:${kind}`, () => {
    const url = TRAP_ART[`../assets/sprites/traps/${kind}.png`];
    if (url) return { url, placeholder: false };
    return { url: drawTrap(kind), placeholder: true };
  });
}

function remember(key: string, make: () => ArtImage): ArtImage {
  let art = cache.get(key);
  if (!art) {
    art = make();
    cache.set(key, art);
  }
  return art;
}

/** Placeholders are drawn on this grid. */
const GRID = 32;
const OUTLINE = 0x140f16;
const WOOD = 0x7a4a26;
const WOOD_DARK = 0x4e2e16;
const IRON = 0x9aa0a8;
const BRASS = 0xd8b060;

type Pt = readonly [number, number];

/** A tiny pixel-art canvas with the few shapes the placeholders need. */
class Pixels {
  readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;

  constructor() {
    this.canvas.width = GRID;
    this.canvas.height = GRID;
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("This system could not create a 2D canvas.");
    this.context = context;
  }

  px(x: number, y: number, color: number): void {
    const [ix, iy] = [Math.floor(x), Math.floor(y)];
    if (ix < 0 || iy < 0 || ix >= GRID || iy >= GRID) return;
    this.context.fillStyle = css(color);
    this.context.fillRect(ix, iy, 1, 1);
  }

  rect(x: number, y: number, width: number, height: number, color: number): void {
    for (let ty = y; ty < y + height; ty++)
      for (let tx = x; tx < x + width; tx++) this.px(tx, ty, color);
  }

  /** Fills every pixel whose center lies inside the polygon. */
  poly(
    points: readonly Pt[],
    color: number,
    where: (x: number, y: number) => boolean = always,
  ): void {
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (inside(points, x + 0.5, y + 0.5) && where(x, y)) this.px(x, y, color);
      }
    }
  }

  /** A round-tipped line `width` pixels thick. */
  line(from: Pt, to: Pt, color: number, width = 1): void {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const steps = Math.max(1, Math.ceil(length * 2));
    const radius = width / 2;
    for (let i = 0; i <= steps; i++) {
      const x = from[0] + ((to[0] - from[0]) * i) / steps;
      const y = from[1] + ((to[1] - from[1]) * i) / steps;
      if (width <= 1) {
        this.px(x, y, color);
        continue;
      }
      for (let py = Math.floor(y - radius); py <= Math.ceil(y + radius); py++) {
        for (let pxl = Math.floor(x - radius); pxl <= Math.ceil(x + radius); pxl++) {
          if (Math.hypot(pxl + 0.5 - x, py + 0.5 - y) <= radius) this.px(pxl, py, color);
        }
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, color: number, ring = false): void {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
        if (ring ? d <= 1 && d >= 0.62 : d <= 1) this.px(x, y, color);
      }
    }
  }

  /** Gives every shape a dark one-pixel outline, so it reads against any floor. */
  outline(color = OUTLINE): void {
    const image = this.context.getImageData(0, 0, GRID, GRID);
    const alpha = (x: number, y: number) =>
      x < 0 || y < 0 || x >= GRID || y >= GRID ? 0 : (image.data[(y * GRID + x) * 4 + 3] ?? 0);
    const edge: Array<[number, number]> = [];
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (alpha(x, y) > 0) continue;
        if (alpha(x - 1, y) || alpha(x + 1, y) || alpha(x, y - 1) || alpha(x, y + 1))
          edge.push([x, y]);
      }
    }
    for (const [x, y] of edge) this.px(x, y, color);
  }

  url(): string {
    return this.canvas.toDataURL("image/png");
  }
}

const always = () => true;

function inside(points: readonly Pt[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i] as Pt;
    const [xj, yj] = points[j] as Pt;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function css(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** A point along the diagonal from the lower left (t = 0) to the upper right (t ≈ 31), `o` across it. */
function diag(t: number, o: number): Pt {
  const k = Math.SQRT1_2;
  return [5 + k * (t + o), 27 + k * (o - t)];
}

/** Fixtures of a floor that aren't items: the merchant's stall and the Beacon, unlit and lit. */
export type Feature = "merchant" | "beacon" | "beacon-lit";

const FEATURE_ART = import.meta.glob<string>("../assets/sprites/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

/** The picture for a fixture: `assets/sprites/<name>.png` if it exists, else a drawn placeholder. */
export function featureArt(feature: Feature): ArtImage {
  return remember(`feature:${feature}`, () => {
    const url = FEATURE_ART[`../assets/sprites/${feature}.png`];
    if (url) return { url, placeholder: false };
    const p = new Pixels();
    if (feature === "merchant") drawMerchant(p);
    else drawBeacon(p, feature === "beacon-lit");
    p.outline();
    return { url: p.url(), placeholder: true };
  });
}

/** A hooded quartermaster behind a little stall with a lamp. */
function drawMerchant(p: Pixels): void {
  // Cloaked figure.
  p.poly(
    [
      [11, 6],
      [16, 3],
      [21, 6],
      [23, 20],
      [9, 20],
    ],
    0x4a5a7a,
  );
  p.ellipse(16, 8, 3.2, 3, 0x2a2430);
  p.px(15, 8, 0xffd88a);
  p.px(17, 8, 0xffd88a);
  // Stall counter with wares.
  p.rect(4, 19, 24, 3, 0x8a5a30);
  p.rect(4, 22, 24, 6, 0x6a4020);
  p.rect(5, 23, 22, 1, 0x8a5a30);
  p.ellipse(9, 17.5, 2, 1.6, 0xe0b86a);
  p.ellipse(13, 17.5, 1.5, 1.6, 0xd8324a);
  p.ellipse(23, 17.5, 2, 1.6, 0x8fc8ff);
  // A hanging lamp.
  p.line([27, 4], [27, 10], 0x9aa0a8);
  p.ellipse(27, 12, 2, 2, 0xffc860);
}

/** A tall brazier of brass and star-metal: cold and dark, or blazing once rekindled. */
function drawBeacon(p: Pixels, lit: boolean): void {
  p.rect(13, 22, 6, 6, 0x6a5a4a);
  p.rect(10, 27, 12, 2, 0x5a4a3a);
  p.poly(
    [
      [8, 12],
      [24, 12],
      [20, 22],
      [12, 22],
    ],
    0xb08a4a,
  );
  p.line([9, 13], [23, 13], 0xe0c080);
  p.ellipse(16, 17, 2.5, 2.5, lit ? 0xfff4c0 : 0x3a3448);
  if (lit) {
    p.poly(
      [
        [10, 12],
        [16, 1],
        [22, 12],
      ],
      0xff9a3c,
    );
    p.poly(
      [
        [12, 12],
        [16, 4],
        [20, 12],
      ],
      0xffd45a,
    );
    p.ellipse(16, 10, 2, 2.5, 0xfff4c0);
  } else {
    for (const [x, y] of [
      [13, 11],
      [16, 10],
      [19, 11],
    ] as const)
      p.px(x, y, 0x7a3a2a);
  }
}

/** A heap of gold coins. */
function drawGold(p: Pixels): void {
  p.ellipse(16, 22, 10, 5, 0xb8862a);
  p.ellipse(16, 20, 8, 4, 0xd8a838);
  p.ellipse(16, 18, 5, 3, 0xf0c850);
  for (const [x, y] of [
    [12, 19],
    [18, 17],
    [21, 21],
    [10, 22],
    [16, 15],
  ] as const) {
    p.ellipse(x, y, 2, 1.2, 0xffe08a);
    p.px(x, y, 0xfff4c0);
  }
}

function drawItem(id: LootId): string {
  const pixels = new Pixels();
  if (id === CACHE) drawCache(pixels);
  else if (id === GOLD) drawGold(pixels);
  else {
    const kind = itemKind(id);
    if (isSupply(kind)) drawSupply(pixels, kind);
    else if (kind.category === "weapon") drawWeapon(pixels, kind);
    else drawArmor(pixels, kind);
  }
  pixels.outline();
  return pixels.url();
}

/** A banded wooden crate with a brass lock. */
function drawCache(p: Pixels): void {
  p.rect(5, 10, 22, 16, 0x8a5a30);
  for (const y of [14, 18, 22]) p.line([5, y], [26, y], 0x6a4020);
  p.rect(5, 9, 22, 2, 0xb07a44);
  for (const x of [8, 23]) p.rect(x, 9, 2, 17, IRON);
  for (const x of [8, 23]) p.rect(x, 9, 2, 1, 0xd0d4dc);
  p.rect(14, 13, 4, 5, BRASS);
  p.px(15, 15, 0x3a2a10);
  p.px(16, 15, 0x3a2a10);
}

function drawSupply(p: Pixels, kind: SupplyKind): void {
  const base = kind.color;
  const light = scaleColor(base, 1.4);
  const dark = scaleColor(base, 0.55);
  switch (kind.effect.kind) {
    case "heal": {
      // A clay pot of dark salve.
      p.ellipse(16, 20, 10, 8, 0x8a6040);
      p.ellipse(16, 22, 8, 5, 0x9c7048);
      p.rect(8, 11, 16, 3, 0x6a4428);
      p.ellipse(16, 12.5, 6.5, 1.6, dark);
      p.ellipse(15, 12.2, 3, 0.8, base);
      for (const [x, y] of [
        [16, 18],
        [15, 19],
        [16, 19],
        [17, 19],
        [16, 20],
        [16, 21],
      ] as const)
        p.px(x, y, light);
      break;
    }
    case "shield": {
      // A brass disc with a glowing ward mark.
      p.ellipse(16, 16, 11, 11, 0xc8a050);
      p.ellipse(16, 16, 11, 11, 0x8a6a30, true);
      p.ellipse(16, 16, 7, 7, 0xa8843c, true);
      p.line([16, 9], [16, 23], light);
      p.line([10, 13], [22, 19], base);
      p.line([10, 19], [22, 13], base);
      p.ellipse(16, 16, 2, 2, 0xe8f6ff);
      break;
    }
    case "vigor": {
      // A round glass flask, two-thirds full of red tonic.
      p.ellipse(16, 20, 9, 8, 0x5a6878);
      p.poly(
        [
          [0, 18],
          [32, 18],
          [32, 32],
          [0, 32],
        ],
        base,
        (x, y) => ((x + 0.5 - 16) / 8) ** 2 + ((y + 0.5 - 20) / 7) ** 2 <= 1,
      );
      p.line([10, 18.5], [22, 18.5], light);
      p.rect(14, 7, 4, 6, 0x7a8898);
      p.rect(13, 4, 6, 3, WOOD);
      p.px(11, 15, 0xe8f0ff);
      p.px(12, 14, 0xe8f0ff);
      break;
    }
    case "charge": {
      p.poly(
        [
          [16, 3],
          [24, 16],
          [16, 29],
          [8, 16],
        ],
        base,
      );
      p.poly(
        [
          [16, 6],
          [20, 16],
          [16, 25],
          [12, 16],
        ],
        light,
      );
      break;
    }
    case "flare": {
      p.ellipse(16, 19, 9, 9, base);
      p.ellipse(14, 17, 3, 3, light);
      p.rect(14, 6, 4, 5, 0x7a8898);
      p.rect(13, 4, 6, 2, WOOD);
      break;
    }
    case "survey": {
      p.line([9, 25], [14, 20], WOOD, 3);
      p.ellipse(19, 13, 8, 8, BRASS);
      p.ellipse(19, 13, 6, 6, base);
      p.px(16, 10, 0xffffff);
      p.px(17, 10, 0xffffff);
      break;
    }
    case "waystone": {
      p.ellipse(16, 17, 10, 12, base);
      p.ellipse(16, 17, 10, 12, dark, true);
      p.ellipse(16, 17, 4, 4, 0xffc860, true);
      break;
    }
  }
}

function drawWeapon(p: Pixels, kind: GearKind): void {
  const base = kind.color;
  const light = mixColor(scaleColor(base, 1.5), 0xffffff, 0.25);
  const dark = scaleColor(base, 0.55);
  switch (kind.id) {
    case "iron-cleaver": {
      p.line(diag(1, 0), diag(17, 0), WOOD, 2.4);
      p.line(diag(2, 0), diag(17, 0), WOOD_DARK);
      p.poly([diag(13, -1), diag(28, -1), diag(29, -10), diag(15, -10)], base);
      p.line(diag(15, -9.5), diag(28.5, -9.5), light);
      p.ellipse(...diag(25, -4), 1, 1, dark);
      break;
    }
    case "surveyors-pick": {
      p.line(diag(1, 0), diag(21, 0), WOOD, 2.4);
      p.poly(
        [diag(18, -11), diag(23, -2), diag(23, 2), diag(18, 12), diag(20.5, 2), diag(20.5, -2)],
        base,
      );
      p.line(diag(20, -9), diag(22, -1), light);
      p.rect(...rounded(diag(21.5, 0)), 2, 2, BRASS);
      break;
    }
    case "gearbreaker-maul": {
      p.line(diag(1, 0), diag(19, 0), WOOD, 2.6);
      p.poly([diag(17, -7), diag(29, -7), diag(29, 7), diag(17, 7)], base);
      p.line(diag(19.5, -7), diag(19.5, 7), dark, 1.6);
      p.line(diag(26.5, -7), diag(26.5, 7), dark, 1.6);
      p.line(diag(17.5, -6), diag(28.5, -6), light);
      break;
    }
    case "glass-spear":
    case "prism-glaive":
    case "starsteel-halberd": {
      p.line(diag(-3, 0), diag(21, 0), WOOD, 2);
      p.ellipse(...diag(20, 0), 1.6, 1.6, BRASS);
      if (kind.id === "starsteel-halberd") {
        p.poly([diag(20, -1.4), diag(31.5, 0), diag(20, 1.4)], base);
        p.poly([diag(15, 1), diag(22, 1), diag(23, 8), diag(17, 9), diag(14, 5)], base);
        p.line(diag(15, 6), diag(22.5, 7.5), light);
      } else {
        p.poly(
          [diag(19, -1.6), diag(25, -4.5), diag(31.5, -2), diag(29, 1.8), diag(19, 1.8)],
          base,
        );
        p.line(diag(21, -2), diag(29.5, -2.2), light);
        if (kind.id === "prism-glaive")
          for (const t of [23, 26, 29]) p.px(...diag(t, -0.5), 0xffffff);
      }
      break;
    }
    default: {
      // A sword; the sabre curves.
      const curved = kind.id === "rime-sabre";
      p.line(diag(1, 0), diag(7.5, 0), WOOD_DARK, 2.4);
      p.ellipse(...diag(0, 0), 1.7, 1.7, BRASS);
      p.line(diag(8.5, -5), diag(8.5, 5), mixColor(dark, BRASS, 0.5), 2);
      p.poly(
        curved
          ? [
              diag(9, -2),
              diag(20, -2.8),
              diag(27, -1.5),
              diag(31, 1.5),
              diag(26, 2.4),
              diag(18, 2),
              diag(9, 2),
            ]
          : [diag(9, -2.2), diag(26, -2.2), diag(30.5, 0), diag(26, 2.2), diag(9, 2.2)],
        base,
      );
      p.line(diag(10, -1), diag(curved ? 25 : 26, curved ? -1.6 : -1), light);
      if (kind.id === "beacon-blade") for (const t of [13, 18, 23]) p.px(...diag(t, 0.5), 0xfff4c0);
      if (kind.id === "null-edge") p.line(diag(10, 1.2), diag(26, 1.2), 0xb090ff);
      break;
    }
  }
}

function rounded(point: Pt): [number, number] {
  return [Math.round(point[0]) - 1, Math.round(point[1]) - 1];
}

/** A torso with shoulders; the pattern on it tells the kinds of armor apart. */
const BODY: readonly Pt[] = [
  [10, 6],
  [13, 5],
  [16, 7],
  [19, 5],
  [22, 6],
  [27, 9],
  [26.5, 15],
  [23, 14],
  [23, 27],
  [9, 27],
  [9, 14],
  [5.5, 15],
  [5, 9],
];

function drawArmor(p: Pixels, kind: GearKind): void {
  const base = kind.color;
  const light = mixColor(scaleColor(base, 1.45), 0xffffff, 0.15);
  const dark = scaleColor(base, 0.55);
  const onBody = (x: number, y: number) => inside(BODY, x + 0.5, y + 0.5);
  p.poly(BODY, base);
  switch (kind.id) {
    case "padded-jerkin":
      for (let y = 10; y <= 26; y += 3)
        p.poly(
          [
            [0, y],
            [32, y],
            [32, y + 1],
            [0, y + 1],
          ],
          dark,
          onBody,
        );
      p.line([16, 8], [16, 26], dark);
      break;
    case "ring-mail":
      for (let y = 8; y < 27; y++)
        for (let x = 6; x < 27; x++)
          if ((x + y) % 2 === 0 && onBody(x, y)) p.px(x, y, y % 4 === 0 ? light : dark);
      break;
    case "scale-hauberk":
      for (let y = 9; y < 27; y += 3)
        for (let x = 6 + (y % 2) * 2; x < 27; x += 4) {
          if (!onBody(x, y)) continue;
          p.px(x, y + 1, dark);
          p.px(x + 1, y + 2, dark);
          p.px(x + 2, y + 1, dark);
          p.px(x + 1, y, light);
        }
      break;
    case "orrery-brigandine":
      p.ellipse(16, 17, 5.5, 5.5, dark, true);
      p.ellipse(16, 17, 1.5, 1.5, light);
      for (let y = 9; y < 27; y += 3)
        for (let x = 8; x < 26; x += 3) if (onBody(x, y)) p.px(x, y, light);
      break;
    case "starwoven-mail":
      for (let k = -24; k < 32; k += 3)
        p.poly(
          [
            [k, 32],
            [k + 1, 32],
            [k + 33, 0],
            [k + 32, 0],
          ],
          light,
          onBody,
        );
      for (const [x, y] of [
        [12, 12],
        [19, 17],
        [14, 22],
        [21, 10],
      ] as const)
        p.px(x, y, 0xffffff);
      break;
    case "void-carapace":
      for (let y = 11; y < 27; y += 4)
        p.poly(
          [
            [0, y],
            [32, y],
            [32, y + 1],
            [0, y + 1],
          ],
          dark,
          onBody,
        );
      for (const [x, y] of [
        [12, 13],
        [20, 17],
        [15, 21],
        [18, 25],
      ] as const)
        p.px(x, y, 0xc0a0ff);
      break;
    case "beacon-aegis":
      p.poly(
        [
          [16, 11],
          [21, 17],
          [16, 23],
          [11, 17],
        ],
        scaleColor(base, 1.3),
      );
      p.ellipse(16, 17, 2.2, 2.2, 0xfff4c0);
      for (let y = 9; y < 27; y += 6)
        p.poly(
          [
            [0, y],
            [32, y],
            [32, y + 1],
            [0, y + 1],
          ],
          dark,
          onBody,
        );
      break;
    default:
      p.line([9, 22], [23, 22], dark);
      break;
  }
  // Collar and lit shoulders.
  p.ellipse(16, 6.5, 3, 2, OUTLINE);
  p.line([6, 9], [12, 6.5], light);
  p.line([20, 6.5], [26, 9], light);
}

function drawTrap(kind: TrapKind): string {
  const p = new Pixels();
  const color = trapKind(kind).color;
  const light = mixColor(color, 0xffffff, 0.45);
  switch (kind) {
    case "ember-vent": {
      const crack: Pt[] = [
        [5, 20],
        [10, 16],
        [13, 19],
        [17, 14],
        [21, 17],
        [27, 12],
      ];
      for (let i = 1; i < crack.length; i++)
        p.line(crack[i - 1] as Pt, crack[i] as Pt, 0x1a0e0a, 3);
      for (let i = 1; i < crack.length; i++) p.line(crack[i - 1] as Pt, crack[i] as Pt, color);
      for (const [x, y] of [
        [13, 18],
        [17, 15],
        [21, 16],
      ] as const)
        p.px(x, y, 0xffe0a0);
      break;
    }
    case "alarm-glyph":
      p.ellipse(16, 16, 11, 11, color, true);
      p.ellipse(16, 16, 7, 7, scaleColor(color, 0.6), true);
      p.rect(15, 10, 2, 8, light);
      p.rect(15, 20, 2, 2, light);
      break;
    case "gloom-rune":
      p.ellipse(16, 16, 11, 11, color, true);
      p.ellipse(16, 16, 5, 5, 0x1a1430);
      for (const [x, y] of [
        [16, 3],
        [16, 28],
        [3, 16],
        [28, 16],
      ] as const)
        p.rect(x - 1, y - 1, 2, 2, light);
      break;
  }
  return p.url();
}
