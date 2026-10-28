import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACHIEVEMENT_IDS, ACHIEVEMENTS } from "../../src/engine/achievements";
import { CREATURE_IDS } from "../../src/engine/creatures";
import { applyAction, emptyStats, type RunState } from "../../src/engine/run";
import {
  type CharacterSave,
  HISTORY_LIMIT,
  newAchievements,
  newCharacter,
  parseCharacterSave,
  SAVE_VERSION,
  updateCharacter,
} from "../../src/engine/save";
import { arena, creature, packOf } from "./helpers";

const NOW = "2026-10-24T12:00:00.000Z";
const LATER = "2026-10-24T13:00:00.000Z";
const ROOM = ["##########", "#........#", "#........#", "#........#", "##########"];

function character(): CharacterSave {
  return newCharacter({
    id: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
    name: "Archivist",
    now: NOW,
    seed: 77,
  });
}

function withRun(save: CharacterSave, change: (run: RunState) => RunState): CharacterSave {
  if (!save.run) throw new Error("Expected a run.");
  return updateCharacter(save, change(save.run), { now: LATER, playTimeMs: 1 });
}

describe("achievements", () => {
  it("have unique ids and readable names", () => {
    expect(new Set(ACHIEVEMENT_IDS).size).toBe(ACHIEVEMENT_IDS.length);
    for (const a of ACHIEVEMENTS) {
      expect(a.name.length).toBeGreaterThan(2);
      expect(a.description.endsWith(".")).toBe(true);
    }
  });

  it("are earned once, when the descent first deserves them", () => {
    const save = character();
    const after = withRun(save, (run) => ({ ...run, kills: 1 }));
    expect(newAchievements(save, after)).toEqual(["first-blood"]);
    expect(after.record.achievements).toEqual([{ id: "first-blood", earnedAt: LATER }]);
    const again = updateCharacter(after, after.run, {
      now: "2026-10-25T00:00:00.000Z",
      playTimeMs: 2,
    });
    expect(again.record.achievements).toEqual(after.record.achievements);
    expect(newAchievements(after, again)).toEqual([]);
  });

  it("follow the descent's tallies", () => {
    const save = character();
    const after = withRun(save, (run) => ({
      ...run,
      depth: 10,
      status: "won",
      stats: { ...emptyStats(), guardians: ["chain-sexton"], goldSpent: 600, trapsFound: 10 },
    }));
    const earned = newAchievements(save, after);
    for (const id of [
      "into-the-deep",
      "bell-unrung",
      "keeper-of-the-beacon",
      "no-rest",
      "by-dim-light",
      "good-customer",
      "keen-eyes",
    ] as const)
      expect(earned).toContain(id);
    expect(earned).not.toContain("clockwork-stilled");
  });

  it("include the bestiary, counted across every descent", () => {
    const save = {
      ...character(),
      record: { ...character().record, discovered: [...CREATURE_IDS] },
    };
    expect(
      newAchievements(
        save,
        withRun(save, (run) => run),
      ),
    ).toContain("naturalist");
  });
});

describe("run tallies", () => {
  it("count gold spent, rests, supplies and bright turns", () => {
    let run = arena(ROOM, {
      hero: { x: 2, y: 2, hp: 1 },
      camp: { x: 2, y: 2 },
      pack: packOf(["salve", 1]),
      lantern: { bright: true },
    });
    run = applyAction(run, { type: "rest" }).run;
    run = applyAction(run, { type: "use-item", slot: 0 }).run;
    expect(run.stats).toMatchObject({ rests: 1, suppliesUsed: 1, brightTurns: 2 });

    const shop = arena(ROOM, {
      hero: { x: 2, y: 2 },
      merchant: { x: 2, y: 2 },
      stock: [{ item: "salve", price: 30, count: 1 }],
      gold: 40,
    });
    expect(applyAction(shop, { type: "buy", offer: 0 }).run.stats.goldSpent).toBe(30);
  });

  it("record guardians slain", () => {
    const sexton = creature("chain-sexton", { x: 3, y: 2 }, { hp: 1 });
    const run = arena(ROOM, { hero: { x: 2, y: 2 }, monsters: [sexton] });
    expect(applyAction(run, { type: "move", direction: "e" }).run.stats.guardians).toEqual([
      "chain-sexton",
    ]);
  });
});

describe("run history", () => {
  it("records each descent once, when it ends", () => {
    const save = character();
    const fallen = withRun(save, (run) => ({
      ...run,
      status: "dead",
      killedBy: "cinder-mite",
      kills: 9,
      gold: 33,
    }));
    expect(fallen.record.history).toEqual([
      {
        endedAt: LATER,
        difficulty: "normal",
        result: "dead",
        seed: 77,
        depth: 1,
        level: 1,
        turns: 0,
        kills: 9,
        gold: 33,
        killedBy: "cinder-mite",
      },
    ]);
    expect(
      updateCharacter(fallen, fallen.run, { now: LATER, playTimeMs: 2 }).record.history,
    ).toHaveLength(1);
    expect(parseCharacterSave(JSON.parse(JSON.stringify(fallen)))).toEqual(fallen);
  });

  it(`keeps only the newest ${HISTORY_LIMIT} descents`, () => {
    let save = character();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      const run = save.run as RunState;
      save = updateCharacter(
        { ...save, run: { ...run, status: "active" } },
        { ...run, status: "dead", depth: (i % 30) + 1 },
        {
          now: LATER,
          playTimeMs: i,
        },
      );
    }
    expect(save.record.history).toHaveLength(HISTORY_LIMIT);
    expect(save.record.history[0]?.depth).toBe(((HISTORY_LIMIT + 4) % 30) + 1);
  });
});

describe("version-4 saves", () => {
  // A real version-4 save from the milestone-5 engine: a level-6 hero on floor 7 with 336 gold,
  // played there by the balance bot.
  const v4 = JSON.parse(
    readFileSync(fileURLToPath(new URL("../fixtures/character-v4.json", import.meta.url)), "utf8"),
  );

  it("upgrade, keeping the whole descent, with fresh tallies and an empty history", () => {
    expect(v4.version).toBe(4);
    const save = parseCharacterSave(v4);
    expect(save.version).toBe(SAVE_VERSION);
    const { stats, ...rest } = save.run as RunState;
    expect(rest).toEqual({ ...v4.run, difficulty: "normal" });
    expect(stats).toEqual(emptyStats());
    expect(save.record).toEqual({ ...v4.record, history: [], achievements: [] });
  });

  it("earn what the descent already deserves on the next turn", () => {
    const save = parseCharacterSave(v4);
    const run = save.run as RunState;
    const next = updateCharacter(save, applyAction(run, { type: "wait" }).run, {
      now: LATER,
      playTimeMs: 1,
    });
    expect(next.record.achievements.map((a) => a.id)).toContain("first-blood");
  });
});
