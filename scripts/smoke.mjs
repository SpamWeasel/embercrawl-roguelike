// Launches the built game in smoke-test mode, then checks the screenshot and report it writes.
// Usage: node scripts/smoke.mjs [path\to\Embercrawl.exe]
// With no path, it runs the development Electron binary against the ./out build.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const outDir = resolve(".smoke");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const screenshot = resolve(outDir, "screenshot.png");
const reportPath = `${screenshot}.json`;

const packagedExe = process.argv[2];
const command = packagedExe ? resolve(packagedExe) : createRequire(import.meta.url)("electron");
const args = packagedExe ? [] : ["."];

const result = spawnSync(command, args, {
  env: { ...process.env, EMBERCRAWL_SMOKE_SCREENSHOT: screenshot },
  stdio: "inherit",
  timeout: 60_000,
});
if (result.error) throw result.error;

if (!existsSync(reportPath)) {
  console.error(`Smoke test failed: the game exited (code ${result.status}) without a report.`);
  process.exit(1);
}
const report = JSON.parse(readFileSync(reportPath, "utf8"));
console.log(JSON.stringify(report, null, 2));
if (result.status !== 0 || !report.ok) {
  console.error("Smoke test failed.");
  process.exit(1);
}
console.log(`Smoke test passed. Screenshot: ${screenshot}`);
