import { FLOOR_COUNT } from "../../../../engine/map";
import { Rng } from "../../../../engine/rng";

/** Colors for the generated floor and wall tiles of one region of the dungeon. */
export interface FloorPalette {
  readonly id: string;
  /** Shown beside the floor number, so players notice when they enter a new region. */
  readonly name: string;
  readonly floor: {
    readonly base: string;
    readonly light: string;
    readonly dark: string;
    readonly grout: string;
    /** Optional rare bright speckles. */
    readonly glint?: string;
  };
  readonly wall: {
    readonly base: string;
    readonly light: string;
    readonly dark: string;
    readonly mortar: string;
  };
}

/** Floors share a palette in groups of this many: 1–3, 4–6, 7–9 and so on. */
export const PALETTE_GROUP_SIZE = 3;

/** Every descent opens in these colors. */
export const ORIGINAL_PALETTE: FloorPalette = {
  id: "ember-slate",
  name: "Ember Slate",
  floor: { base: "#2f2d38", light: "#3b3947", dark: "#25232c", grout: "#1b1a21" },
  wall: { base: "#5a4a42", light: "#73604f", dark: "#463a34", mortar: "#2a221f" },
};

/** Palettes later floor groups choose from. The original may come back deeper down. */
export const REGULAR_PALETTES: readonly FloorPalette[] = [
  ORIGINAL_PALETTE,
  {
    id: "mossgrown",
    name: "Mossgrown",
    floor: { base: "#29312b", light: "#34403a", dark: "#212823", grout: "#161c18" },
    wall: { base: "#4b5a40", light: "#627553", dark: "#3b4733", mortar: "#1f261a" },
  },
  {
    id: "rimefrost",
    name: "Rimefrost",
    floor: { base: "#2a313c", light: "#36404d", dark: "#222831", grout: "#171c23" },
    wall: { base: "#4d6279", light: "#6a84a0", dark: "#3d4e61", mortar: "#202a36" },
  },
  {
    id: "amethyst-hollow",
    name: "Amethyst Hollow",
    floor: { base: "#2f2939", light: "#3c3449", dark: "#262130", grout: "#1a1621" },
    wall: { base: "#5d4973", light: "#7a6194", dark: "#4a3a5c", mortar: "#261d31" },
  },
  {
    id: "rustworks",
    name: "Rustworks",
    floor: { base: "#33281f", light: "#413328", dark: "#2a2019", grout: "#1c1511" },
    wall: { base: "#74432d", light: "#91583c", dark: "#5d3524", mortar: "#2e1a11" },
  },
  {
    id: "sunken-sandstone",
    name: "Sunken Sandstone",
    floor: { base: "#39322a", light: "#463e34", dark: "#2f2922", grout: "#211c17" },
    wall: { base: "#7d6a4b", light: "#9a8560", dark: "#65553b", mortar: "#3a3022" },
  },
  {
    id: "verdigris-vault",
    name: "Verdigris Vault",
    floor: { base: "#233236", light: "#2d4045", dark: "#1c292c", grout: "#132024" },
    wall: { base: "#3f6b67", light: "#548a84", dark: "#325753", mortar: "#1b302e" },
  },
  {
    id: "ashen-halls",
    name: "Ashen Halls",
    floor: { base: "#2f2f31", light: "#3b3b3e", dark: "#262628", grout: "#1a1a1c" },
    wall: { base: "#6b6760", light: "#85807a", dark: "#57534d", mortar: "#2e2c29" },
  },
];

/** The final floor only: molten gold walls over crimson stone with glowing glints. */
export const FINAL_PALETTE: FloorPalette = {
  id: "molten-heart",
  name: "Molten Heart",
  floor: { base: "#3d1416", light: "#52191c", dark: "#2e0f11", grout: "#1a0708", glint: "#ff8a3d" },
  wall: { base: "#a66c1c", light: "#e0a73d", dark: "#7f5113", mortar: "#3d1f07" },
};

/**
 * The palette for one floor of a run. Floors 1–3 use the original palette. Each later group of
 * three picks one at random from the run's seed, never the same as the group before, so the look
 * changes at every third floor. The final floor always uses its own palette, seen nowhere else.
 *
 * This is purely visual: it uses its own random stream, so it can never change a dungeon's layout
 * or anything else in the game, and the same run always gets the same colors.
 */
export function paletteForFloor(seed: number, depth: number): FloorPalette {
  if (depth >= FLOOR_COUNT) return FINAL_PALETTE;
  const group = Math.floor((Math.max(1, depth) - 1) / PALETTE_GROUP_SIZE);
  let palette = ORIGINAL_PALETTE;
  for (let g = 1; g <= group; g++) {
    const previous = palette;
    palette = Rng.derive(seed, "palette", g).pick(REGULAR_PALETTES.filter((p) => p !== previous));
  }
  return palette;
}
