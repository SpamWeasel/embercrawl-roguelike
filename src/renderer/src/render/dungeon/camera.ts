/**
 * Where the map should sit along one screen axis so the focus point is centered in the space
 * between `before` and `after` (room left for HUD bars), without showing past the map's edges.
 * If the whole map fits, it is centered instead. All values are in screen pixels.
 */
export function cameraOffset(
  view: number,
  mapSize: number,
  focus: number,
  before = 0,
  after = 0,
): number {
  const space = view - before - after;
  if (mapSize <= space) return before + (space - mapSize) / 2;
  const centered = before + space / 2 - focus;
  return Math.min(before, Math.max(view - after - mapSize, centered));
}

/**
 * Picks the tile scale: roughly `columns` × `rows` tiles on screen, in whole multiples of the
 * art's pixels on the physical display, so pixel art stays crisp at any size and DPI.
 * Returns the scale in CSS pixels per art pixel.
 */
export function crispScale(
  width: number,
  height: number,
  devicePixelRatio: number,
  artPixels: number,
  columns: number,
  rows: number,
): number {
  const fit = Math.min(width / columns, height / rows) / artPixels;
  const physical = Math.max(2, Math.round(fit * devicePixelRatio));
  return physical / devicePixelRatio;
}

/** Rounds a position to the physical pixel grid so tiles never shimmer while the camera moves. */
export function snapToPixel(value: number, devicePixelRatio: number): number {
  return Math.round(value * devicePixelRatio) / devicePixelRatio;
}
