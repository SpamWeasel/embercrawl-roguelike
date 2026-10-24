import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CharacterSave, newCharacter, SaveFormatError } from "../../src/engine/save";
import {
  BACKUP_INTERVAL_MS,
  BACKUP_LIMIT,
  SAVE_EXTENSION,
  SaveStore,
} from "../../src/main/save-store";

const IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

function character(id: string, name: string, updatedAt: string): CharacterSave {
  return { ...newCharacter({ id, name, now: "2026-10-01T00:00:00.000Z", seed: 7 }), updatedAt };
}

describe("SaveStore", () => {
  let directory: string;
  let store: SaveStore;
  let trashed: string[];
  let clock: Date;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "embercrawl-saves-"));
    trashed = [];
    clock = new Date("2026-10-24T10:00:00.000Z");
    store = new SaveStore(join(directory, "Saves"), {
      trash: async (path) => {
        trashed.push(path);
        await rm(path, { recursive: true, force: true });
      },
      now: () => clock,
    });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("writes and loads a character, leaving no temporary files", async () => {
    const save = character(IDS[0] as string, "Cinder", "2026-10-02T00:00:00.000Z");
    await store.write(save);
    expect(await store.load(save.id)).toEqual(save);
    expect((await readdir(store.directory)).filter((f) => f !== "Backups")).toEqual([
      `${save.id}${SAVE_EXTENSION}`,
    ]);
  });

  it("lists characters newest first and flags damaged files", async () => {
    await store.write(character(IDS[0] as string, "Older", "2026-10-02T00:00:00.000Z"));
    await store.write(character(IDS[1] as string, "Newer", "2026-10-03T00:00:00.000Z"));
    await writeFile(join(store.directory, `${IDS[2]}${SAVE_EXTENSION}`), "{ not json", "utf8");
    await writeFile(join(store.directory, "notes.txt"), "ignored", "utf8");

    const listings = await store.list();
    expect(listings.map((l) => (l.status === "ok" ? l.summary.name : l.status))).toEqual([
      "Newer",
      "Older",
      "damaged",
    ]);
    const damaged = listings[2];
    expect(damaged?.status === "damaged" && damaged.id).toBe(IDS[2]);
  });

  it("returns an empty list when there are no saves yet", async () => {
    expect(await store.list()).toEqual([]);
  });

  it("keeps only the newest of many rapid saves", async () => {
    const base = character(IDS[0] as string, "Swift", "2026-10-02T00:00:00.000Z");
    const writes = Array.from({ length: 25 }, (_, i) => store.write({ ...base, playTimeMs: i }));
    await Promise.all(writes);
    expect((await store.load(base.id)).playTimeMs).toBe(24);
  });

  it("finishes queued writes before flush resolves", async () => {
    const base = character(IDS[0] as string, "Patient", "2026-10-02T00:00:00.000Z");
    void store.write({ ...base, playTimeMs: 1 });
    void store.write({ ...base, playTimeMs: 2 });
    await store.flush();
    expect((await store.load(base.id)).playTimeMs).toBe(2);
  });

  it("refuses ids that could escape the saves folder", async () => {
    await expect(store.load("../../secrets")).rejects.toThrow(SaveFormatError);
  });

  it("refuses to write data that isn't a valid character", () => {
    expect(() => store.write({ format: "embercrawl-character", version: 1 })).toThrow(
      SaveFormatError,
    );
  });

  it("renames a character, tidying the name", async () => {
    const save = character(IDS[0] as string, "Old Name", "2026-10-02T00:00:00.000Z");
    await store.write(save);
    await store.rename(save.id, "  New   Name ");
    expect((await store.load(save.id)).name).toBe("New Name");
    await expect(store.rename(save.id, "   ")).rejects.toThrow(SaveFormatError);
  });

  it("deletes by moving the file and its backups to the trash", async () => {
    const save = character(IDS[0] as string, "Gone", "2026-10-02T00:00:00.000Z");
    await store.write(save);
    await store.remove(save.id);
    expect(trashed).toEqual([
      join(store.directory, `${save.id}${SAVE_EXTENSION}`),
      store.backupDirectory(save.id),
    ]);
    expect(await store.list()).toEqual([]);
  });

  it("keeps a few rolling backups, taken on opening and every so often while playing", async () => {
    const save = character(IDS[0] as string, "Careful", "2026-10-02T00:00:00.000Z");
    await store.write(save);
    expect(await store.backups(save.id)).toHaveLength(1);
    // Another save soon after: no new backup yet.
    await store.write({ ...save, playTimeMs: 1 });
    expect(await store.backups(save.id)).toHaveLength(1);
    for (let i = 0; i < BACKUP_LIMIT + 2; i++) {
      clock = new Date(clock.getTime() + BACKUP_INTERVAL_MS);
      await store.write({ ...save, playTimeMs: 10 + i });
    }
    const backups = await store.backups(save.id);
    expect(backups).toHaveLength(BACKUP_LIMIT);
    expect(backups[0]?.status).toBe("ok");
    clock = new Date(clock.getTime() + 1000);
    await store.open(save.id);
    expect((await store.backups(save.id))[0]?.name).toContain("10-01");
  });

  it("restores a backup, keeping the current file as a backup too", async () => {
    const save = character(IDS[0] as string, "Restored", "2026-10-02T00:00:00.000Z");
    await store.write({ ...save, playTimeMs: 1 });
    const [first] = await store.backups(save.id);
    clock = new Date(clock.getTime() + 1000);
    await store.write({ ...save, playTimeMs: 999 });
    if (!first) throw new Error("Expected a backup.");
    await store.restore(save.id, first.name);
    expect((await store.load(save.id)).playTimeMs).toBe(1);
    await expect(store.restore(save.id, "nope.embercrawl")).rejects.toThrow(SaveFormatError);
  });

  it("lists damaged files with how many backups could restore them", async () => {
    const save = character(IDS[0] as string, "Broken", "2026-10-02T00:00:00.000Z");
    await store.write(save);
    await writeFile(join(store.directory, `${save.id}${SAVE_EXTENSION}`), "{ nope", "utf8");
    expect(await store.list()).toMatchObject([{ status: "damaged", id: save.id, backups: 1 }]);
  });

  it("exports and imports a character, replacing or keeping both on a clash", async () => {
    const save = character(IDS[0] as string, "Traveller", "2026-10-02T00:00:00.000Z");
    await store.write(save);
    const file = join(directory, "moved.embercrawl");
    await store.exportTo(save.id, file);

    const candidate = await store.readImport(file);
    expect(candidate.save).toEqual(save);
    expect(candidate.existing?.id).toBe(save.id);

    const copy = await store.accept(candidate.save, "copy", IDS[1] as string);
    expect(copy).toMatchObject({ id: IDS[1], name: "Traveller (copy)" });
    expect((await store.list()).map((l) => l.status === "ok" && l.summary.name).sort()).toEqual([
      "Traveller",
      "Traveller (copy)",
    ]);

    await writeFile(file, "not a character", "utf8");
    await expect(store.readImport(file)).rejects.toThrow(SaveFormatError);
  });
});
