import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseSettings, type Settings } from "../shared/settings";

/**
 * The player's settings in one small JSON file. A missing or damaged file just means defaults:
 * settings must never stop the game from starting.
 */
export class SettingsStore {
  private cached: Settings | null = null;

  constructor(readonly path: string) {}

  async load(): Promise<Settings> {
    if (this.cached) return this.cached;
    try {
      this.cached = parseSettings(JSON.parse(await readFile(this.path, "utf8")));
    } catch {
      this.cached = parseSettings({});
    }
    return this.cached;
  }

  /** Checks, stores and returns the settings (anything invalid falls back to its default). */
  async save(data: unknown): Promise<Settings> {
    const settings = parseSettings(data);
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(settings, null, 2), "utf8");
    await rename(temporary, this.path);
    this.cached = settings;
    return settings;
  }
}
