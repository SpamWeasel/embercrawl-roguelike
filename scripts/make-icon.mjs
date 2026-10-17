// Builds the app icon (build/icon.png and the multi-size build/icon.ico) with ImageMagick.
// Usage: node scripts/make-icon.mjs [source.png]
// With a source image, it is centered on a transparent square and resized; without one, a
// placeholder ember is drawn.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const png = "build/icon.png";
const ico = "build/icon.ico";

function magick(args) {
  const result = spawnSync("magick", args, { stdio: "inherit" });
  if (result.error)
    throw new Error(`Could not run ImageMagick (is it installed?): ${result.error.message}`);
  if (result.status !== 0) throw new Error(`ImageMagick exited with code ${result.status}.`);
}

/** A teardrop flame centered at x=256; curve points are proportional so any size keeps its shape. */
const flame = (top, width, bottom) => {
  const c = 256;
  const h = bottom - top;
  const [y1, y2, y3, y4] = [top + 0.23 * h, top + 0.36 * h, bottom - 0.33 * h, bottom - 0.12 * h];
  return `path 'M ${c},${top} C ${c + width * 0.5},${y1} ${c + width},${y2} ${c + width * 0.9},${y3} C ${c + width * 0.75},${y4} ${c + width * 0.4},${bottom} ${c},${bottom} C ${c - width * 0.4},${bottom} ${c - width * 0.75},${y4} ${c - width * 0.9},${y3} C ${c - width},${y2} ${c - width * 0.5},${y1} ${c},${top} Z'`;
};

mkdirSync("build", { recursive: true });
const source = process.argv[2];
if (source) {
  magick([
    source,
    "-background",
    "none",
    "-gravity",
    "center",
    "-resize",
    "512x512",
    "-extent",
    "512x512",
    png,
  ]);
} else {
  magick([
    "-size",
    "512x512",
    "xc:none",
    "-fill",
    "#140d12",
    "-stroke",
    "#4a2414",
    "-strokewidth",
    "6",
    "-draw",
    "roundrectangle 16,16 495,495 96,96",
    "(",
    "-size",
    "400x400",
    "radial-gradient:rgba(255,120,40,0.6)-rgba(255,120,40,0)",
    ")",
    "-gravity",
    "center",
    "-geometry",
    "+0+30",
    "-composite",
    "+gravity",
    "-stroke",
    "none",
    "-fill",
    "#d9461a",
    "-draw",
    flame(84, 104, 440),
    "-fill",
    "#ff9a3c",
    "-draw",
    flame(190, 66, 414),
    "-fill",
    "#ffe6b0",
    "-draw",
    flame(282, 30, 400),
    png,
  ]);
}
magick([png, "-define", "icon:auto-resize=256,128,64,48,32,24,16", ico]);
console.log(`Wrote ${png} and ${ico}`);
