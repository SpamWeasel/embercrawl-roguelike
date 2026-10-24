// Brings the owner's art into the game: matches each image to a game id by its file name, removes
// a flat background (black, white or grey, even both), trims, centers and scales it to a
// 128 × 128 transparent PNG in src/renderer/src/assets/sprites/, where the game picks it up.
//
// Usage: pnpm exec tsx scripts/import-art.mts <folder or images…> [options]
//   --replace             overwrite art the game already has (skipped by default)
//   --only a,b            import only these ids
//   --threshold id=N      how different from the background a pixel must be to count as part of
//                         the picture (0–255, default 26); raise it if background is left over,
//                         lower it if the picture's dark or pale edges get eaten
//   --sheet <file.png>    also write a contact sheet of the results, on dark and light floors
//   --dry-run             only show which file maps to which id
//
// Needs ImageMagick (`magick`). File names like "emberdepths_monster_gear_hound_icon.jpg" map to
// "gear-hound"; words such as icon, monster, item and map are ignored.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CREATURE_IDS } from "../src/engine/creatures";
import { CACHE, GOLD, ITEM_IDS, TRAP_IDS } from "../src/engine/items";

const SPRITES = resolve("src/renderer/src/assets/sprites");
const SIZE = 128;
const MARGIN = 3;
const DEFAULT_THRESHOLD = 26;
/** How wide a break in an outline gets sealed, as a share of the image size. */
const DEFAULT_SEAL = 0.008;

/** Pictures that aren't creatures, items or traps: they live directly in sprites/. */
const FEATURES = ["hero", "stairs-up", "stairs-down", "merchant", "beacon", "beacon-lit", "camp"];
const IGNORED_WORDS = new Set([
  "emberdepths",
  "embercrawl",
  "icon",
  "monster",
  "item",
  "map",
  "final",
  "boss",
]);
const ALIASES: Record<string, string> = {
  "restorative-salve": "salve",
  "loot-cache": "cache",
  "supply-cache": "cache",
  mossjaw: "moss-jaw",
  player: "hero",
  playericon: "hero",
};

function destinationFor(id: string): string | null {
  if ((CREATURE_IDS as readonly string[]).includes(id)) return `creatures/${id}.png`;
  if ([...ITEM_IDS, CACHE, GOLD].includes(id as never)) return `items/${id}.png`;
  if ((TRAP_IDS as readonly string[]).includes(id)) return `traps/${id}.png`;
  if (FEATURES.includes(id)) return `${id}.png`;
  return null;
}

/** The game id a file name stands for, or null. */
export function idForFile(file: string): string | null {
  const words = basename(file, extname(file))
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !IGNORED_WORDS.has(word) && !/^\d+$/.test(word));
  const name = words.join("-");
  const id = ALIASES[name] ?? ALIASES[words.join("")] ?? name;
  return destinationFor(id) ? id : null;
}

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function magick(args: string[], input?: Buffer): Buffer {
  return execFileSync("magick", args, { input, maxBuffer: 512 * 1024 * 1024 });
}

/** The background colors: what the image's outer edge is made of (black, white, or both). */
function backgroundColors(pixels: Buffer, width: number, height: number): Rgb[] {
  const band = Math.max(2, Math.round(Math.min(width, height) * 0.01));
  const samples: Rgb[] = [];
  const add = (x: number, y: number) => {
    const i = (y * width + x) * 3;
    samples.push({ r: pixels[i] ?? 0, g: pixels[i + 1] ?? 0, b: pixels[i + 2] ?? 0 });
  };
  for (let x = 0; x < width; x += 2)
    for (let d = 0; d < band; d++) {
      add(x, d);
      add(x, height - 1 - d);
    }
  for (let y = 0; y < height; y += 2)
    for (let d = 0; d < band; d++) {
      add(d, y);
      add(width - 1 - d, y);
    }
  // Group edge pixels by brightness; any group making up a good share of the edge is background.
  const groups = new Map<number, Rgb[]>();
  for (const s of samples) {
    const key = Math.round((s.r + s.g + s.b) / 3 / 32);
    const group = groups.get(key);
    if (group) group.push(s);
    else groups.set(key, [s]);
  }
  const colors: Rgb[] = [];
  for (const group of groups.values()) {
    if (group.length < samples.length * 0.15) continue;
    const median = (channel: keyof Rgb) =>
      group.map((s) => s[channel]).sort((a, b) => a - b)[Math.floor(group.length / 2)] ?? 0;
    colors.push({ r: median("r"), g: median("g"), b: median("b") });
  }
  return colors;
}

/**
 * Turns an RGB image into RGBA with its background transparent. The background is everything
 * reachable from the edge without crossing a pixel that differs from a background color by more
 * than `threshold`, plus large pockets of pure background color enclosed by the picture (the gap
 * between a spider's legs). Pixels at the boundary get partial transparency, with the background
 * color taken back out of them, so no white or black fringe is left.
 */
function cutOut(
  pixels: Buffer,
  width: number,
  height: number,
  threshold: number,
  sealFraction: number,
) {
  const total = width * height;
  const colors = backgroundColors(pixels, width, height);
  const distance = new Uint8Array(total);
  const nearest = new Uint8Array(total);
  for (let p = 0; p < total; p++) {
    let best = 255;
    let which = 0;
    for (let index = 0; index < colors.length; index++) {
      const c = colors[index] as Rgb;
      const d = Math.max(
        Math.abs((pixels[p * 3] ?? 0) - c.r),
        Math.abs((pixels[p * 3 + 1] ?? 0) - c.g),
        Math.abs((pixels[p * 3 + 2] ?? 0) - c.b),
      );
      if (d < best) {
        best = d;
        which = index;
      }
    }
    distance[p] = best;
    nearest[p] = which;
  }

  // 0 = picture, 1 = background.
  const background = new Uint8Array(total);
  const stack: number[] = [];
  const flood = (start: number, limit: number, mark: Uint8Array, value: number) => {
    stack.push(start);
    mark[start] = value;
    const members: number[] = [];
    while (stack.length > 0) {
      const p = stack.pop() as number;
      members.push(p);
      const x = p % width;
      const visit = (n: number) => {
        if (mark[n] !== 0 || (distance[n] ?? 255) > limit) return;
        mark[n] = value;
        stack.push(n);
      };
      if (x + 1 < width) visit(p + 1);
      if (x > 0) visit(p - 1);
      if (p + width < total) visit(p + width);
      if (p >= width) visit(p - width);
    }
    return members;
  };
  // Seal small breaks in the picture's outline first (a dilate, then an erode), so the background
  // can't leak inside a figure whose insides are as dark (or pale) as the background itself.
  // Gaps wider than about twice the radius, like the space between legs, still clear.
  const radius = Math.max(2, Math.round(Math.min(width, height) * sealFraction));
  const subject = new Uint8Array(total);
  for (let p = 0; p < total; p++) subject[p] = (distance[p] ?? 0) > threshold ? 1 : 0;
  const sealed = squareFilter(
    squareFilter(subject, width, height, radius, "grow"),
    width,
    height,
    radius,
    "shrink",
  );
  for (let p = 0; p < total; p++) if (sealed[p]) background[p] = 4;
  for (let x = 0; x < width; x++) {
    for (const p of [x, (height - 1) * width + x])
      if (background[p] === 0 && (distance[p] ?? 255) <= threshold)
        flood(p, threshold, background, 1);
  }
  for (let y = 0; y < height; y++) {
    for (const p of [y * width, y * width + width - 1])
      if (background[p] === 0 && (distance[p] ?? 255) <= threshold)
        flood(p, threshold, background, 1);
  }

  for (let p = 0; p < total; p++) if (background[p] === 4) background[p] = 0;

  // Enclosed pockets of (nearly) pure background color, big enough not to be a highlight. Only for
  // light backgrounds: on black ones, dark parts inside the picture (a shade's body, a robe's
  // folds) look just like background and must stay.
  const lightColors = colors.map((c) => (c.r + c.g + c.b) / 3 > 128);
  const pocketLimit = Math.max(6, Math.round(threshold / 3));
  const minPocket = total * 0.0015;
  const seen = new Uint8Array(total);
  for (let p = 0; p < total; p++) seen[p] = background[p] ? 2 : 0;
  for (let p = 0; p < total; p++) {
    if (seen[p] !== 0 || (distance[p] ?? 255) > pocketLimit || !lightColors[nearest[p] ?? 0])
      continue;
    const pocket = flood(p, pocketLimit, seen, 3);
    if (pocket.length >= minPocket) for (const q of pocket) background[q] = 1;
  }

  // Tiny islands right at the image edge are leftovers (a rounded card's corner, a frame's
  // fringe), never part of the picture. Small specks elsewhere are kept: they're embers and sparks.
  const island = new Uint8Array(total);
  const margin = Math.round(Math.min(width, height) * 0.05);
  for (let p = 0; p < total; p++) island[p] = background[p] ? 1 : 0;
  const notBackground = (n: number) => island[n] === 0;
  for (let p = 0; p < total; p++) {
    if (!notBackground(p)) continue;
    const members: number[] = [];
    island[p] = 2;
    stack.push(p);
    while (stack.length > 0) {
      const q = stack.pop() as number;
      members.push(q);
      const x = q % width;
      for (const n of [
        x + 1 < width ? q + 1 : -1,
        x > 0 ? q - 1 : -1,
        q + width < total ? q + width : -1,
        q >= width ? q - width : -1,
      ]) {
        if (n >= 0 && notBackground(n)) {
          island[n] = 2;
          stack.push(n);
        }
      }
    }
    if (members.length > total * 0.0005) continue;
    const nearEdge = members.every((q) => {
      const x = q % width;
      const y = (q - x) / width;
      return x < margin || y < margin || x >= width - margin || y >= height - margin;
    });
    if (nearEdge) for (const q of members) background[q] = 1;
  }

  // Picture pixels within two pixels of the background (a square neighborhood, built in two passes).
  const across = new Uint8Array(total);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let hit = 0;
      for (let dx = -2; dx <= 2 && !hit; dx++) {
        const nx = x + dx;
        if (nx >= 0 && nx < width && background[y * width + nx]) hit = 1;
      }
      across[y * width + x] = hit;
    }
  const nearBackground = new Uint8Array(total);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let hit = 0;
      for (let dy = -2; dy <= 2 && !hit; dy++) {
        const ny = y + dy;
        if (ny >= 0 && ny < height && across[ny * width + x]) hit = 1;
      }
      nearBackground[y * width + x] = hit;
    }

  // Alpha: background clear, picture solid, and a soft edge one or two pixels deep.
  const rgba = Buffer.alloc(total * 4);
  const soft = threshold * 2.5;
  for (let p = 0; p < total; p++) {
    const r = pixels[p * 3] ?? 0;
    const g = pixels[p * 3 + 1] ?? 0;
    const b = pixels[p * 3 + 2] ?? 0;
    let alpha = 255;
    if (background[p]) alpha = 0;
    else {
      const edge = nearBackground[p] === 1;
      const d = distance[p] ?? 255;
      if (edge && d < soft)
        alpha = Math.round(255 * Math.min(1, (d - threshold * 0.5) / (soft - threshold * 0.5)));
      alpha = Math.max(0, alpha);
    }
    let out = [r, g, b];
    if (alpha > 0 && alpha < 255) {
      // Take the background color back out of a half-covered edge pixel.
      const a = alpha / 255;
      const c = colors[nearest[p] ?? 0] ?? { r: 0, g: 0, b: 0 };
      out = [(r - (1 - a) * c.r) / a, (g - (1 - a) * c.g) / a, (b - (1 - a) * c.b) / a].map((v) =>
        Math.max(0, Math.min(255, Math.round(v))),
      );
    }
    rgba[p * 4] = out[0] ?? 0;
    rgba[p * 4 + 1] = out[1] ?? 0;
    rgba[p * 4 + 2] = out[2] ?? 0;
    rgba[p * 4 + 3] = alpha;
  }
  return { rgba, colors };
}

/**
 * Grows (or shrinks) a mask by a square of the given radius, in two quick passes. Outside the
 * image counts as empty when growing and as full when shrinking, so edges don't erode.
 */
function squareFilter(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
  mode: "grow" | "shrink",
): Uint8Array {
  const pass = (input: Uint8Array, horizontal: boolean) => {
    const output = new Uint8Array(input.length);
    const lines = horizontal ? height : width;
    const length = horizontal ? width : height;
    const index = (line: number, i: number) => (horizontal ? line * width + i : i * width + line);
    const sums = new Int32Array(length + 1);
    for (let line = 0; line < lines; line++) {
      for (let i = 0; i < length; i++) sums[i + 1] = (sums[i] ?? 0) + (input[index(line, i)] ?? 0);
      for (let i = 0; i < length; i++) {
        const from = Math.max(0, i - radius);
        const to = Math.min(length - 1, i + radius);
        const count = (sums[to + 1] ?? 0) - (sums[from] ?? 0);
        const outside = 2 * radius + 1 - (to - from + 1);
        output[index(line, i)] =
          mode === "grow" ? (count > 0 ? 1 : 0) : count + outside === 2 * radius + 1 ? 1 : 0;
      }
    }
    return output;
  };
  return pass(pass(mask, true), false);
}

/** The smallest box holding everything visible. */
function visibleBox(rgba: Buffer, width: number, height: number) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if ((rgba[(y * width + x) * 4 + 3] ?? 0) < 24) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  return right < 0 ? null : { left, top, width: right - left + 1, height: bottom - top + 1 };
}

export function importImage(
  source: string,
  destination: string,
  threshold: number,
  sealFraction = DEFAULT_SEAL,
): string {
  const [width, height] = magick(["identify", "-format", "%w %h", `${source}[0]`])
    .toString()
    .split(" ")
    .map(Number) as [number, number];
  const pixels = magick([
    `${source}[0]`,
    "-alpha",
    "off",
    "-colorspace",
    "sRGB",
    "-depth",
    "8",
    "rgb:-",
  ]);
  const { rgba, colors } = cutOut(pixels, width, height, threshold, sealFraction);
  const box = visibleBox(rgba, width, height);
  if (!box) throw new Error("nothing was left after removing the background");
  mkdirSync(dirname(destination), { recursive: true });
  const inner = SIZE - MARGIN * 2;
  magick(
    [
      "-size",
      `${width}x${height}`,
      "-depth",
      "8",
      "rgba:-",
      "-crop",
      `${box.width}x${box.height}+${box.left}+${box.top}`,
      "+repage",
      "-filter",
      "Box",
      "-resize",
      `${inner}x${inner}`,
      "-background",
      "none",
      "-gravity",
      "center",
      "-extent",
      `${SIZE}x${SIZE}`,
      "-strip",
      "-define",
      "png:color-type=6",
      destination,
    ],
    rgba,
  );
  const hex = (c: Rgb) =>
    `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  return colors.map(hex).join(" + ");
}

function main(): void {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    const [, value] = args.splice(index, 2);
    return value;
  };
  const flag = (name: string) => {
    const index = args.indexOf(name);
    if (index >= 0) args.splice(index, 1);
    return index >= 0;
  };
  const thresholds = new Map<string, number>();
  for (let t = option("--threshold"); t; t = option("--threshold")) {
    const [id, value] = t.split("=");
    if (id && value) thresholds.set(id, Number(value));
  }
  const only = option("--only")?.split(",");
  const sheet = option("--sheet");
  const replace = flag("--replace");
  const dryRun = flag("--dry-run");
  if (args.length === 0) {
    console.error(
      "Usage: pnpm exec tsx scripts/import-art.mts <folder or images…> [--replace] [--only a,b] [--threshold id=N] [--sheet file.png] [--dry-run]",
    );
    process.exit(1);
  }

  const files = args.flatMap((arg) =>
    statSync(arg).isDirectory()
      ? readdirSync(arg)
          .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
          .map((f) => join(arg, f))
      : [arg],
  );
  const written: Array<[string, string]> = [];
  const skipped: string[] = [];
  const unmatched: string[] = [];
  for (const file of files.sort()) {
    const id = idForFile(file);
    if (!id) {
      unmatched.push(basename(file));
      continue;
    }
    if (only && !only.includes(id)) continue;
    const destination = join(SPRITES, destinationFor(id) as string);
    if (existsSync(destination) && !replace) {
      skipped.push(`${id} (from ${basename(file)})`);
      continue;
    }
    if (dryRun) {
      console.log(`${basename(file)} -> ${destinationFor(id)}`);
      continue;
    }
    const threshold = thresholds.get(id) ?? DEFAULT_THRESHOLD;
    const background = importImage(file, destination, threshold);
    console.log(`${id}: background ${background}, threshold ${threshold}`);
    written.push([id, destination]);
  }
  if (skipped.length)
    console.log(`\nAlready in the game (kept; --replace to overwrite):\n  ${skipped.join("\n  ")}`);
  if (unmatched.length)
    console.log(`\nNo game id matches (not imported):\n  ${unmatched.join("\n  ")}`);
  console.log(`\nImported ${written.length} picture(s).`);

  if (sheet && written.length > 0) {
    // Each result on a dark dungeon floor and on a light check, to spot leftover background.
    const temp = mkdtempSync(join(tmpdir(), "embercrawl-art-"));
    const labelled: string[] = [];
    written.forEach(([id, path], index) => {
      const dark = join(temp, `${index}-dark.png`);
      const light = join(temp, `${index}-light.png`);
      magick(["-size", "160x160", "xc:#2a2622", path, "-gravity", "center", "-composite", dark]);
      magick([
        "-size",
        "160x160",
        "pattern:checkerboard",
        "-fill",
        "#d8d0c0",
        "-colorize",
        "60%",
        path,
        "-gravity",
        "center",
        "-composite",
        light,
      ]);
      labelled.push("-label", id, dark, "-label", "", light);
    });
    magick([
      "montage",
      ...labelled,
      "-tile",
      "8x",
      "-geometry",
      "+4+4",
      "-background",
      "#555",
      "-pointsize",
      "14",
      sheet,
    ]);
    rmSync(temp, { recursive: true, force: true });
    console.log(`Contact sheet: ${sheet}`);
  }
}

// Run only when started as a script (tests import idForFile without importing anything).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
