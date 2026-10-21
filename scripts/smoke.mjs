// Launches the built game once per screen in smoke-test mode, then checks each screenshot and
// report it writes. Saves go to a throwaway folder, so real characters are never touched.
// Usage: node scripts/smoke.mjs [path\to\Embercrawl.exe]
// With no path, it runs the development Electron binary against the ./out build.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// The title screen runs first: on an empty save folder it creates the character the game screen opens.
const SCENES = ["title", "game", "pack", "shop"];

const outDir = resolve(".smoke");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const userData = resolve(outDir, "user-data");

const packagedExe = process.argv[2];
const command = packagedExe ? resolve(packagedExe) : createRequire(import.meta.url)("electron");
const args = packagedExe ? [] : ["."];

let failed = false;
for (const scene of SCENES) {
  const screenshot = resolve(outDir, `${scene}.png`);
  const reportPath = `${screenshot}.json`;
  const result = spawnSync(command, args, {
    env: {
      ...process.env,
      EMBERCRAWL_SMOKE_SCREENSHOT: screenshot,
      EMBERCRAWL_SMOKE_SCENE: scene,
      EMBERCRAWL_USER_DATA: userData,
    },
    stdio: "inherit",
    timeout: 60_000,
  });
  if (result.error) throw result.error;

  if (!existsSync(reportPath)) {
    console.error(`[${scene}] failed: the game exited (code ${result.status}) without a report.`);
    failed = true;
    continue;
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  console.log(`[${scene}] ${JSON.stringify(report)}`);
  if (result.status !== 0 || !report.ok) failed = true;
  else console.log(`[${scene}] passed. Screenshot: ${screenshot}`);
}

if (failed) {
  console.error("Smoke test failed.");
  process.exit(1);
}
console.log("Smoke test passed.");
