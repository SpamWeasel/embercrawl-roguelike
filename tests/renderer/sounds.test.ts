import { describe, expect, it } from "vitest";
import { CREATURES } from "../../src/engine/creatures";
import {
  ambienceMood,
  creatureVoice,
  isGuardian,
  placeSound,
  SOUND_IDS,
  SOUNDS,
  seededRandom,
  soundForFile,
  volumeGain,
} from "../../src/renderer/src/audio/sounds";

describe("sounds", () => {
  it("describe every sound", () => {
    expect(SOUND_IDS.length).toBeGreaterThan(40);
    for (const id of SOUND_IDS) expect(SOUNDS[id].description.length, id).toBeGreaterThan(5);
    expect(SOUND_IDS.filter((id) => SOUNDS[id].group === "ambience")).toContain("ambience");
  });

  it("match the player's files by name, including numbered variations", () => {
    expect(soundForFile("../assets/sounds/hit.ogg")).toBe("hit");
    expect(soundForFile("../assets/sounds/hit-2.wav")).toBe("hit");
    expect(soundForFile("C:/art/creature-die-10.MP3")).toBe("creature-die");
    expect(soundForFile("../assets/sounds/trap-ember-vent.ogg")).toBe("trap-ember-vent");
    expect(soundForFile("../assets/sounds/explosion.ogg")).toBeNull();
    expect(soundForFile("../assets/sounds/hit.flac")).toBeNull();
  });

  it("turn slider positions into gains that rise smoothly from silence to full", () => {
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(100)).toBe(1);
    expect(volumeGain(150)).toBe(1);
    expect(volumeGain(-5)).toBe(0);
    expect(volumeGain(50)).toBeCloseTo(0.25);
  });

  it("place sounds left or right of the hero, softer with distance", () => {
    const hero = { x: 20, y: 20 };
    expect(placeSound(hero, hero)).toEqual({ pan: 0, gain: 1 });
    expect(placeSound({ x: 15, y: 20 }, hero).pan).toBeLessThan(0);
    expect(placeSound({ x: 25, y: 20 }, hero).pan).toBeGreaterThan(0);
    const near = placeSound({ x: 22, y: 20 }, hero).gain;
    const far = placeSound({ x: 30, y: 20 }, hero).gain;
    expect(far).toBeLessThan(near);
    expect(placeSound({ x: 80, y: 80 }, hero).gain).toBeGreaterThanOrEqual(0.35);
    expect(Math.abs(placeSound({ x: 0, y: 20 }, hero).pan)).toBeLessThanOrEqual(0.65);
  });

  it("give guardians deep voices and every creature a voice in a sensible range", () => {
    for (const creature of CREATURES) {
      const voice = creatureVoice(creature.id);
      expect(voice, creature.id).toBeGreaterThan(0.5);
      expect(voice, creature.id).toBeLessThan(1.5);
      if (isGuardian(creature.id)) expect(voice).toBeLessThan(0.7);
    }
    expect(creatureVoice("void-tick")).toBeGreaterThan(creatureVoice("basalt-brute"));
  });

  it("make the background air deeper further down, with its own sound on floor 30", () => {
    const top = ambienceMood(1);
    const deep = ambienceMood(29);
    expect(deep.rate).toBeLessThan(top.rate);
    expect(deep.cutoff).toBeLessThan(top.cutoff);
    expect(top.rumbleEvery).toBe(0);
    expect(deep.rumbleEvery).toBeGreaterThan(0);
    expect(ambienceMood(30)).not.toEqual(ambienceMood(29));
  });

  it("render the same takes every launch (seeded)", () => {
    const a = seededRandom(5);
    const b = seededRandom(5);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
