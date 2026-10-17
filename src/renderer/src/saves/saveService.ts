import {
  type CharacterSave,
  newCharacter,
  parseCharacterSave,
  summarizeCharacter,
} from "../../../engine/save";
import type { CharacterListing, SaveBridge } from "../../../shared/bridge";

/**
 * Where characters are stored: files on disk in the desktop app, or this browser's storage when
 * the game window runs in a plain browser for development.
 */
export const saveService: SaveBridge = window.embercrawl?.saves ?? createBrowserSaves();
export const savesAreLocalToBrowser = window.embercrawl === undefined;

const STORAGE_PREFIX = "embercrawl:character:";

function createBrowserSaves(): SaveBridge {
  const read = (id: string): CharacterSave => {
    const text = localStorage.getItem(STORAGE_PREFIX + id);
    if (text === null) throw new Error("That character no longer exists.");
    return parseCharacterSave(JSON.parse(text));
  };
  const write = async (save: CharacterSave) => {
    localStorage.setItem(STORAGE_PREFIX + save.id, JSON.stringify(parseCharacterSave(save)));
  };
  return {
    list: async () => {
      const listings: CharacterListing[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(STORAGE_PREFIX)) continue;
        const id = key.slice(STORAGE_PREFIX.length);
        try {
          listings.push({ status: "ok", summary: summarizeCharacter(read(id)) });
        } catch (error) {
          listings.push({ status: "damaged", id, problem: readableError(error) });
        }
      }
      const updated = (l: CharacterListing) => (l.status === "ok" ? l.summary.updatedAt : "");
      return listings.sort((a, b) => updated(b).localeCompare(updated(a)));
    },
    load: async (id) => read(id),
    create: async (name) => {
      const save = newCharacter({
        id: crypto.randomUUID(),
        name,
        now: new Date().toISOString(),
        seed: crypto.getRandomValues(new Uint32Array(1))[0] ?? 0,
      });
      await write(save);
      return save;
    },
    write,
  };
}

/** Turns errors (including ones relayed from the desktop shell) into a sentence for the player. */
export function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, "");
}
