import { type MouseEvent, useEffect, useRef } from "react";
import { creatureKind } from "../../../../engine/creatures";
import type { Point } from "../../../../engine/geometry";
import { indexOf, isWalkable, MAP_HEIGHT, MAP_WIDTH, pointOf, Tile } from "../../../../engine/map";
import { currentFloor, type RunState, visibleTiles } from "../../../../engine/run";
import { mixColor } from "../../render/dungeon/lighting";
import { paletteForFloor } from "../../render/dungeon/palettes";

/** How the map is shown: small, large, or tucked away. */
export type MinimapSize = "small" | "large" | "hidden";

/** Screen pixels per map tile at each size. */
const TILE_SIZE: Readonly<Record<Exclude<MinimapSize, "hidden">, number>> = { small: 5, large: 9 };

const STORAGE_KEY = "embercrawl:ui:minimap";

/** The next size when M is pressed: small → large → hidden → small. */
export function nextMinimapSize(size: MinimapSize): MinimapSize {
  return size === "small" ? "large" : size === "large" ? "hidden" : "small";
}

/** The player's last choice, remembered in this browser/PC; small if there is none. */
export function savedMinimapSize(): MinimapSize {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "large" || value === "hidden" ? value : "small";
  } catch {
    return "small";
  }
}

export function saveMinimapSize(size: MinimapSize): void {
  try {
    localStorage.setItem(STORAGE_KEY, size);
  } catch {
    // Storage can be unavailable; the map still works for this session.
  }
}

const css = (color: number) => `#${color.toString(16).padStart(6, "0")}`;
const hex = (color: string) => Number.parseInt(color.slice(1), 16);

/**
 * The floor as seen so far, in the corner of the screen: explored ground in the floor's own
 * colors (brighter where the lantern reaches now), and markers for the hero, stairs, camp,
 * merchant, Beacon, seen items, found traps and creatures in view. Click it to walk there.
 */
export function Minimap({
  run,
  size,
  onSize,
  onTileClick,
}: {
  run: RunState;
  size: MinimapSize;
  onSize(size: MinimapSize): void;
  onTileClick(tile: Point): void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tile = size === "hidden" ? 0 : TILE_SIZE[size];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || tile === 0) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = MAP_WIDTH * tile * ratio;
    canvas.height = MAP_HEIGHT * tile * ratio;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, MAP_WIDTH * tile, MAP_HEIGHT * tile);
    drawMap(context, run, tile);
  }, [run, tile]);

  if (size === "hidden") {
    return (
      <button type="button" className="minimap-show btn btn-small" onClick={() => onSize("small")}>
        Map <kbd className="kbd">M</kbd>
      </button>
    );
  }

  const onClick = (event: MouseEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = Math.floor((event.clientX - box.left) / tile);
    const y = Math.floor((event.clientY - box.top) / tile);
    if (x >= 0 && y >= 0 && x < MAP_WIDTH && y < MAP_HEIGHT) onTileClick({ x, y });
  };

  return (
    <section aria-label="Map" className="minimap group">
      <div className="minimap-controls">
        <button
          type="button"
          className="minimap-button"
          aria-label="Smaller map"
          disabled={size === "small"}
          onClick={() => onSize("small")}
        >
          −
        </button>
        <button
          type="button"
          className="minimap-button"
          aria-label="Larger map"
          disabled={size === "large"}
          onClick={() => onSize("large")}
        >
          +
        </button>
        <button
          type="button"
          className="minimap-button"
          aria-label="Hide map"
          onClick={() => onSize("hidden")}
        >
          ×
        </button>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: MAP_WIDTH * tile, height: MAP_HEIGHT * tile }}
        className="block cursor-pointer"
        onClick={onClick}
      />
    </section>
  );
}

function drawMap(context: CanvasRenderingContext2D, run: RunState, tile: number): void {
  const floor = currentFloor(run);
  const palette = paletteForFloor(run.seed, run.depth);
  const visible = visibleTiles(run);
  const ground = hex(palette.floor.light);
  const wall = hex(palette.wall.light);
  const colors = {
    groundSeen: css(mixColor(ground, 0x9a9aa8, 0.35)),
    groundLit: css(mixColor(ground, 0xffd9a0, 0.55)),
    wallSeen: css(mixColor(wall, 0x000000, 0.2)),
    wallLit: css(mixColor(wall, 0xffd9a0, 0.3)),
  };

  for (let index = 0; index < floor.tiles.length; index++) {
    if (!floor.explored[index]) continue;
    const { x, y } = pointOf(index);
    const open = isWalkable(floor.tiles[index] ?? Tile.Wall);
    const lit = visible.has(index);
    context.fillStyle = open
      ? lit
        ? colors.groundLit
        : colors.groundSeen
      : lit
        ? colors.wallLit
        : colors.wallSeen;
    context.fillRect(x * tile, y * tile, tile, tile);
  }

  /** A square marker centered in a tile, `share` of the tile wide. */
  const mark = (p: Point, color: string, share = 0.7) => {
    if (!floor.explored[indexOf(p)]) return;
    const side = Math.max(2, tile * share);
    context.fillStyle = color;
    context.fillRect((p.x + 0.5) * tile - side / 2, (p.y + 0.5) * tile - side / 2, side, side);
  };

  for (const item of floor.items) mark(item, item.item === "gold" ? "#ffd45a" : "#e8d8b0", 0.45);
  for (const trap of floor.traps) if (trap.found) mark(trap, "#d46aff", 0.45);
  if (floor.upStairs) mark(floor.upStairs, "#8fc8ff", 0.9);
  if (floor.downStairs) mark(floor.downStairs, "#ff8a3d", 0.9);
  if (floor.camp) mark(floor.camp, floor.campUsed ? "#7a5a3a" : "#ffb347", 0.8);
  if (floor.merchant) mark(floor.merchant, "#7ae08a", 0.8);
  if (floor.beacon) mark(floor.beacon, "#fff0a0", 1);
  for (const monster of floor.monsters) {
    if (!visible.has(indexOf(monster))) continue;
    mark(monster, creatureKind(monster.kind).guardian ? "#ff3b5a" : "#ff6a5a", 0.75);
  }

  // The hero, with a dark ring so it stands out on any floor color.
  const cx = (run.hero.x + 0.5) * tile;
  const cy = (run.hero.y + 0.5) * tile;
  context.beginPath();
  context.arc(cx, cy, Math.max(2.2, tile * 0.55), 0, Math.PI * 2);
  context.fillStyle = "#0a0608";
  context.fill();
  context.beginPath();
  context.arc(cx, cy, Math.max(1.6, tile * 0.38), 0, Math.PI * 2);
  context.fillStyle = "#fff4d0";
  context.fill();
}
