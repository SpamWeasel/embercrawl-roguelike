import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateFloor } from "../../src/engine/generate";
import { STARTING_ARMOR, STARTING_WEAPON } from "../../src/engine/items";
import { applyAction } from "../../src/engine/run";
import {
  beginDescent,
  type CharacterSave,
  newCharacter,
  normalizeCharacterName,
  parseCharacterSave,
  SAVE_VERSION,
  SaveFormatError,
  summarizeCharacter,
  updateCharacter,
} from "../../src/engine/save";

const ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";
const NOW = "2026-10-17T12:00:00.000Z";

function sample(): CharacterSave {
  return newCharacter({ id: ID, name: "  Ash   Walker ", now: NOW, seed: 1234 });
}

/** A save as it would come back from disk: plain JSON with no shared references. */
function throughJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("character saves", () => {
  it("survive a round trip through a file", () => {
    const save = sample();
    expect(parseCharacterSave(throughJson(save))).toEqual(save);
  });

  it("tidy the name and start a first descent", () => {
    const save = sample();
    expect(save.name).toBe("Ash Walker");
    expect(save.run?.depth).toBe(1);
    expect(save.record).toEqual({
      descents: 1,
      deepestFloor: 1,
      deaths: 0,
      wins: 0,
      discovered: save.run?.discovered,
      history: [],
      achievements: [],
    });
  });

  it("record the deepest floor reached", () => {
    const save = sample();
    const run = save.run;
    if (!run) throw new Error("Expected a run.");
    const deeper = { ...run, depth: 3, floors: run.floors.map((f) => ({ ...f, depth: 3 })) };
    const updated = updateCharacter(save, deeper, {
      now: "2026-10-17T13:00:00.000Z",
      playTimeMs: 5000,
    });
    expect(updated.record.deepestFloor).toBe(3);
    expect(updated.playTimeMs).toBe(5000);
    expect(updateCharacter(updated, run, { now: NOW, playTimeMs: 6000 }).record.deepestFloor).toBe(
      3,
    );
  });

  it("summarize without the floors", () => {
    expect(summarizeCharacter(sample())).toEqual({
      id: ID,
      name: "Ash Walker",
      depth: 1,
      level: 1,
      status: "active",
      difficulty: "normal",
      deepestFloor: 1,
      wins: 0,
      playTimeMs: 0,
      createdAt: NOW,
      updatedAt: NOW,
      record: sample().record,
    });
  });

  it("stay valid after play", () => {
    const save = sample();
    const run = save.run;
    if (!run) throw new Error("Expected a run.");
    const played = updateCharacter(save, applyAction(run, { type: "wait" }).run, {
      now: NOW,
      playTimeMs: 10,
    });
    expect(parseCharacterSave(throughJson(played))).toEqual(played);
  });
});

describe("parseCharacterSave", () => {
  const broken = (change: (save: Record<string, unknown>) => void) => {
    const data = throughJson(sample()) as Record<string, unknown>;
    change(data);
    return () => parseCharacterSave(data);
  };

  it("rejects files that aren't Embercrawl characters", () => {
    expect(() => parseCharacterSave(null)).toThrow(SaveFormatError);
    expect(() => parseCharacterSave({ format: "something-else" })).toThrow(/not an Embercrawl/);
  });

  it("explains that a newer game version is needed", () => {
    expect(broken((s) => (s.version = SAVE_VERSION + 1))).toThrow(/newer version/);
  });

  it("rejects damaged floors", () => {
    expect(
      broken((s) => {
        const run = s.run as { floors: Array<{ tiles: number[] }> };
        run.floors[0]?.tiles.pop();
      }),
    ).toThrow(/damaged/);
  });

  it("rejects a hero standing inside a wall", () => {
    expect(
      broken((s) => {
        const run = s.run as { hero: { x: number; y: number } };
        run.hero = { ...run.hero, x: 0, y: 0 };
      }),
    ).toThrow(/open tile/);
  });

  it("rejects ids that could be used as file paths", () => {
    expect(broken((s) => (s.id = "../../evil"))).toThrow(SaveFormatError);
  });
});

describe("older save files", () => {
  // A real version-1 save, written by the milestone-1 engine before combat existed.
  const v1 = JSON.parse(
    readFileSync(fileURLToPath(new URL("../fixtures/character-v1.json", import.meta.url)), "utf8"),
  );

  it("upgrade from version 1, keeping where the character was", () => {
    expect(v1.version).toBe(1);
    const save = parseCharacterSave(v1);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.name).toBe("Version One");
    expect(save.run?.depth).toBe(2);
    expect(save.run?.turn).toBe(24);
    expect({ x: save.run?.hero.x, y: save.run?.hero.y }).toEqual({
      x: v1.run.hero.x,
      y: v1.run.hero.y,
    });
    expect(save.run?.floors.map((f) => f.explored)).toEqual(
      v1.run.floors.map((f: { explored: boolean[] }) => f.explored),
    );
  });

  it("give version-1 characters full health, a full lantern and empty explored floors", () => {
    const save = parseCharacterSave(v1);
    expect(save.run?.hero).toMatchObject({ hp: 30, maxHp: 30, level: 1, xp: 0, shield: 0 });
    expect(save.run?.lantern).toEqual({ charge: 100, bright: false });
    expect(save.run?.status).toBe("active");
    for (const floor of save.run?.floors ?? []) {
      expect(floor.monsters).toEqual([]);
      expect(floor.camp).toBeNull();
    }
    expect(save.record).toMatchObject({ deaths: 0, discovered: [] });
  });

  it("keep playing after the upgrade, with creatures on newly reached floors", () => {
    const save = parseCharacterSave(v1);
    const run = save.run;
    if (!run) throw new Error("Expected a run.");
    const played = applyAction(run, { type: "wait" });
    expect(played.tookTurn).toBe(true);
    expect(
      parseCharacterSave(
        throughJson(updateCharacter(save, played.run, { now: NOW, playTimeMs: 1 })),
      ).version,
    ).toBe(SAVE_VERSION);
  });

  // A real version-2 save, written by the milestone-3 engine before items existed: a wounded hero
  // on floor 2 with bright light on, three kills, and floor 1's camp already used.
  const v2 = JSON.parse(
    readFileSync(fileURLToPath(new URL("../fixtures/character-v2.json", import.meta.url)), "utf8"),
  );

  it("upgrade from version 2, keeping the hero, the lantern and every creature", () => {
    expect(v2.version).toBe(2);
    const save = parseCharacterSave(v2);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.name).toBe("Version Two");
    expect(save.run?.hero).toEqual(v2.run.hero);
    expect(save.run?.lantern).toEqual(v2.run.lantern);
    expect(save.run).toMatchObject({
      turn: v2.run.turn,
      depth: v2.run.depth,
      kills: v2.run.kills,
      discovered: v2.run.discovered,
      rng: v2.run.rng,
    });
    expect(save.run?.floors.map((f) => f.monsters)).toEqual(
      v2.run.floors.map((f: { monsters: unknown }) => f.monsters),
    );
    expect(save.run?.floors[0]?.campUsed).toBe(true);
    expect(save.record).toEqual({ ...v2.record, wins: 0, history: [], achievements: [] });
  });

  it("give version-2 characters the starting gear, an empty pack, and the floors' own items", () => {
    const save = parseCharacterSave(v2);
    const run = save.run;
    if (!run) throw new Error("Expected a run.");
    expect(run.equipment).toEqual({ weapon: STARTING_WEAPON, armor: STARTING_ARMOR });
    expect(run.pack.every((slot) => slot === null)).toBe(true);
    for (const floor of run.floors) {
      const original = generateFloor(run.seed, floor.depth);
      const standing = (p: { x: number; y: number }) =>
        floor.depth === run.depth && p.x === run.hero.x && p.y === run.hero.y;
      expect(floor.items).toEqual(original.items.filter((item) => !standing(item)));
      expect(floor.traps).toEqual(original.traps.filter((t) => !standing(t)));
    }
    expect(run.floors.some((floor) => floor.items.length > 0)).toBe(true);
  });

  it("keep playing after the version-2 upgrade", () => {
    const save = parseCharacterSave(v2);
    const run = save.run;
    if (!run) throw new Error("Expected a run.");
    const played = applyAction(run, { type: "wait" });
    expect(played.tookTurn).toBe(true);
    const again = parseCharacterSave(
      throughJson(updateCharacter(save, played.run, { now: NOW, playTimeMs: 1 })),
    );
    expect(again.run?.turn).toBe(run.turn + 1);
  });
});

describe("dying and starting over", () => {
  it("counts the death once and begins a fresh descent that keeps the bestiary", () => {
    const save = sample();
    const run = save.run;
    if (!run) throw new Error("Expected a run.");
    const dead = {
      ...run,
      status: "dead" as const,
      killedBy: "cinder-mite" as const,
      discovered: ["cinder-mite" as const],
    };
    const fallen = updateCharacter(save, dead, { now: NOW, playTimeMs: 10 });
    expect(fallen.record.deaths).toBe(1);
    expect(updateCharacter(fallen, dead, { now: NOW, playTimeMs: 11 }).record.deaths).toBe(1);
    expect(summarizeCharacter(fallen).status).toBe("dead");

    const again = beginDescent(fallen, 999, NOW);
    expect(again.run?.status).toBe("active");
    expect(again.run?.depth).toBe(1);
    expect(again.record.descents).toBe(2);
    expect(again.record.discovered).toContain("cinder-mite");
  });
});

describe("normalizeCharacterName", () => {
  it("accepts tidy names and rejects unusable ones", () => {
    expect(normalizeCharacterName("  Ember\tKnight  ")).toBe("Ember Knight");
    expect(() => normalizeCharacterName("   ")).toThrow(SaveFormatError);
    expect(() => normalizeCharacterName("x".repeat(25))).toThrow(SaveFormatError);
  });
});
