// Packages the built game (out/) for Windows with electron-builder; see electron-builder.yml.
//
// The portable exe and the installer unpack the game with an older 7-Zip decoder that cannot
// read the ARM64 filter newer 7-Zip applies to ARM64 programs: the ARM64 portable exe then quit
// with exit code 1 before starting the game. Forcing the classic BCJ filter fixes both.
import { spawnSync } from "node:child_process";

const result = spawnSync("pnpm", ["exec", "electron-builder", "--win"], {
  env: { ...process.env, ELECTRON_BUILDER_7Z_FILTER: "BCJ" },
  stdio: "inherit",
  shell: true,
});
process.exit(result.status ?? 1);
