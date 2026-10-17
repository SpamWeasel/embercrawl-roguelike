import { clamp01, smoothstep } from "./motion";

/** Warm lantern color multiplied into lit tiles. */
export const LANTERN_TINT = 0xffe9cc;
/** Tiles seen before but not visible now: cool and dim, but still readable. */
export const REMEMBERED_TINT = 0x48526a;
/** Brightness of a visible tile at the very edge of sight. */
const EDGE_LEVEL = 0.45;
/** Tiles closer than this share of the sight radius are fully lit. */
const FULL_LIGHT_SHARE = 0.3;

/** Brightness (0..1) of a visible tile `distance` tiles from the lantern. */
export function lanternLevel(distance: number, radius: number): number {
  const fullUntil = radius * FULL_LIGHT_SHARE;
  const t = clamp01((distance - fullUntil) / (radius + 0.5 - fullUntil));
  return 1 - smoothstep(t) * (1 - EDGE_LEVEL);
}

/**
 * A slow, uneven flame flicker around 1.0 (about ±7%). `strength` scales it, e.g. 0.3 when the
 * player has asked for reduced motion.
 */
export function flicker(seconds: number, strength = 1): number {
  const wave =
    0.035 * Math.sin(seconds * 7.3) +
    0.02 * Math.sin(seconds * 13.7 + 1.3) +
    0.015 * Math.sin(seconds * 3.1 + 0.7);
  return 1 + wave * strength;
}

/** Blends two 0xRRGGBB colors. */
export function mixColor(a: number, b: number, t: number): number {
  const amount = clamp01(t);
  const channel = (shift: number) => {
    const from = (a >> shift) & 0xff;
    const to = (b >> shift) & 0xff;
    return Math.round(from + (to - from) * amount) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

/** Multiplies a color's brightness, clamped to valid values. */
export function scaleColor(color: number, level: number): number {
  const channel = (shift: number) =>
    Math.min(255, Math.round(((color >> shift) & 0xff) * level)) << shift;
  return channel(16) | channel(8) | channel(0);
}

/**
 * Final tint for a tile: `sight` (0..1) blends from the remembered look to lantern light at
 * `level` brightness, so tiles fade smoothly in and out of view.
 */
export function tileTint(sight: number, level: number): number {
  return mixColor(REMEMBERED_TINT, scaleColor(LANTERN_TINT, level), sight);
}
