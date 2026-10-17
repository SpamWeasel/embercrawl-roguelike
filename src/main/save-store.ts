import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CHARACTER_ID_PATTERN,
  type CharacterSave,
  parseCharacterSave,
  SaveFormatError,
  summarizeCharacter,
} from "../engine/save";
import type { CharacterListing } from "../shared/bridge";

export const SAVE_EXTENSION = ".embercrawl";
/** Far above any real save; stops a runaway write from filling the disk. */
const MAX_SAVE_BYTES = 8 * 1024 * 1024;
/** Antivirus scanners and cloud-sync tools can briefly lock files on Windows. */
const RENAME_ATTEMPTS = 6;

interface WriteQueue {
  /** The newest save waiting to be written; older unwritten ones are dropped. */
  pending: CharacterSave | null;
  active: Promise<void> | null;
}

/**
 * Character save files in one folder, one `<id>.embercrawl` file per character. Plain Node.js, so
 * it can be tested without Electron.
 */
export class SaveStore {
  private readonly queues = new Map<string, WriteQueue>();

  constructor(readonly directory: string) {}

  async list(): Promise<CharacterListing[]> {
    await mkdir(this.directory, { recursive: true });
    const ids = (await readdir(this.directory))
      .filter((file) => file.endsWith(SAVE_EXTENSION))
      .map((file) => file.slice(0, -SAVE_EXTENSION.length))
      .filter((id) => CHARACTER_ID_PATTERN.test(id));

    const listings = await Promise.all(
      ids.map(async (id): Promise<CharacterListing> => {
        try {
          return { status: "ok", summary: summarizeCharacter(await this.load(id)) };
        } catch (error) {
          return { status: "damaged", id, problem: messageOf(error) };
        }
      }),
    );
    const updated = (listing: CharacterListing) =>
      listing.status === "ok" ? listing.summary.updatedAt : "";
    return listings.sort((a, b) => updated(b).localeCompare(updated(a)));
  }

  async load(id: string): Promise<CharacterSave> {
    const text = await readFile(this.pathFor(id), "utf8");
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new SaveFormatError("This character file is damaged and could not be read.");
    }
    return parseCharacterSave(data);
  }

  /**
   * Queues a save. Writes for one character happen one at a time, and if several arrive while one
   * is being written, only the newest is written next. Resolves once this save or a newer one is
   * on disk.
   */
  write(data: unknown): Promise<void> {
    const save = parseCharacterSave(data);
    const queue = this.queues.get(save.id) ?? { pending: null, active: null };
    this.queues.set(save.id, queue);
    queue.pending = save;
    queue.active ??= this.drain(queue);
    return queue.active;
  }

  /** Waits until every queued write has finished (used before the app quits). */
  async flush(): Promise<void> {
    for (;;) {
      const active = [...this.queues.values()].flatMap((q) => (q.active ? [q.active] : []));
      if (active.length === 0) return;
      await Promise.allSettled(active);
    }
  }

  private async drain(queue: WriteQueue): Promise<void> {
    try {
      while (queue.pending) {
        const next = queue.pending;
        queue.pending = null;
        await this.persist(next);
      }
    } finally {
      queue.active = null;
    }
  }

  /** Writes to a temporary file, then swaps it in, so a crash can never leave half a save. */
  private async persist(save: CharacterSave): Promise<void> {
    const json = JSON.stringify(save);
    if (Buffer.byteLength(json) > MAX_SAVE_BYTES) {
      throw new Error("This save is unexpectedly large and was not written.");
    }
    await mkdir(this.directory, { recursive: true });
    const path = this.pathFor(save.id);
    const temporary = `${path}.tmp`;
    await writeFile(temporary, json, "utf8");
    try {
      await renameWithRetry(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  private pathFor(id: string): string {
    if (!CHARACTER_ID_PATTERN.test(id))
      throw new SaveFormatError("That is not a valid character id.");
    return join(this.directory, `${id}${SAVE_EXTENSION}`);
  }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const transient = code === "EPERM" || code === "EBUSY" || code === "EACCES";
      if (!transient || attempt >= RENAME_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * attempt));
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
