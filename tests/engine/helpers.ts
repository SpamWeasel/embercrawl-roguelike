import { MAP_HEIGHT, MAP_SIZE, MAP_WIDTH, Tile, type TileKind } from "../../src/engine/map";

const SYMBOLS: Readonly<Record<string, TileKind>> = {
  "#": Tile.Wall,
  ".": Tile.Floor,
  ">": Tile.StairsDown,
  "<": Tile.StairsUp,
};

/**
 * Builds a full-size tile array from a small text picture placed at the top-left corner.
 * `#` wall, `.` floor, `>` down stairs, `<` up stairs; everything outside the picture is wall.
 */
export function mapFrom(rows: readonly string[]): TileKind[] {
  const tiles = new Array<TileKind>(MAP_SIZE).fill(Tile.Wall);
  rows.forEach((row, y) => {
    if (y >= MAP_HEIGHT || row.length > MAP_WIDTH) throw new Error("Test map is too large.");
    [...row].forEach((symbol, x) => {
      const kind = SYMBOLS[symbol];
      if (kind === undefined) throw new Error(`Unknown map symbol "${symbol}".`);
      tiles[y * MAP_WIDTH + x] = kind;
    });
  });
  return tiles;
}

/** Recursively freezes test data so any accidental mutation by the engine throws. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
