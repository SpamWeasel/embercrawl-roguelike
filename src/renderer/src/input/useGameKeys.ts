import { useEffect, useRef } from "react";
import { type Direction, directionFromDelta } from "../../../engine/geometry";
import type { KeyAction, Settings } from "../../../shared/settings";
import {
  KEY_REPEAT_DELAY_MS as REPEAT_DELAY_MS,
  KEY_REPEAT_INTERVAL_MS as REPEAT_INTERVAL_MS,
} from "../game/timing";

export interface GameKeyHandlers {
  move(direction: Direction): void;
  wait(): void;
  /** Use whatever is underfoot: stairs, a camp, a merchant, the Beacon, or an item to pick up. */
  interact(): void;
  toggleLight(): void;
  pulse(): void;
  menu(): void;
  /** Open the pack. */
  inventory(): void;
  /** Use (or equip) what's in a pack slot, numbered from 0. */
  itemSlot(slot: number): void;
  /** Show, enlarge or hide the map. */
  map(): void;
  /** Open the how-to-play card. */
  help(): void;
  /** Turn all sound off or back on. */
  mute(): void;
}

/** Directions of the four movement actions that combine into diagonals when held together. */
const AXES: ReadonlyArray<readonly [KeyAction, { dx: number; dy: number }]> = [
  ["move-n", { dx: 0, dy: -1 }],
  ["move-s", { dx: 0, dy: 1 }],
  ["move-w", { dx: -1, dy: 0 }],
  ["move-e", { dx: 1, dy: 0 }],
];
const DIAGONALS: ReadonlyArray<readonly [KeyAction, Direction]> = [
  ["move-nw", "nw"],
  ["move-ne", "ne"],
  ["move-sw", "sw"],
  ["move-se", "se"],
];

/** The player's bindings turned into lookups by key code. */
function keyMaps(keys: Settings["keys"]) {
  const codes = (action: KeyAction) => new Set(keys[action]);
  const axis = new Map<string, { dx: number; dy: number }>();
  for (const [action, step] of AXES) for (const code of keys[action]) axis.set(code, step);
  const direct = new Map<string, Direction>();
  for (const [action, direction] of DIAGONALS)
    for (const code of keys[action]) direct.set(code, direction);
  return {
    axis,
    direct,
    wait: codes("wait"),
    interact: codes("interact"),
    lantern: codes("lantern"),
    pulse: codes("pulse"),
    pack: codes("pack"),
    map: codes("map"),
    help: codes("help"),
    mute: codes("mute"),
  };
}

/** The number row uses pack slots 1–9, then 0 for the tenth. (The number pad moves.) */
const SLOT_KEYS = [
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit7",
  "Digit8",
  "Digit9",
  "Digit0",
];

/** Two direction keys pressed within this window count as one diagonal. */
const CHORD_MS = 45;

/**
 * Keyboard controls for the dungeon, from the player's key bindings (see shared/settings.ts). The
 * four straight moves combine (W+D walks north-east), the diagonal keys move diagonally directly,
 * and held keys repeat at a steady walking pace. Escape and the number row are fixed.
 */
export function useGameKeys(
  handlers: GameKeyHandlers,
  enabled: boolean,
  keys: Settings["keys"],
): void {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const bound = keyMaps(keys);
    type Axes = Map<string, { dx: number; dy: number }>;
    /** Direction keys held right now. */
    const heldAxes: Axes = new Map();
    /** Keys pressed during the chord window; kept even if released, so a quick tap still moves. */
    const chordAxes: Axes = new Map();
    let chordPending = false;
    let axisTimer: ReturnType<typeof setTimeout> | undefined;
    let directTimer: ReturnType<typeof setTimeout> | undefined;
    let directKey: string | null = null;

    const directionOf = (axes: Axes): Direction | null => {
      let dx = 0;
      let dy = 0;
      for (const axis of axes.values()) {
        dx += axis.dx;
        dy += axis.dy;
      }
      return directionFromDelta(dx, dy);
    };

    const runAxis = (delay: number, nextDelay: number) => {
      axisTimer = setTimeout(() => {
        const direction = directionOf(chordPending ? chordAxes : heldAxes);
        chordPending = false;
        chordAxes.clear();
        if (direction) latest.current.move(direction);
        if (heldAxes.size === 0) axisTimer = undefined;
        else runAxis(nextDelay, REPEAT_INTERVAL_MS);
      }, delay);
    };

    const stopAxis = () => {
      clearTimeout(axisTimer);
      axisTimer = undefined;
      chordPending = false;
      chordAxes.clear();
    };

    const runDirect = (direction: Direction, delay: number) => {
      directTimer = setTimeout(() => {
        latest.current.move(direction);
        runDirect(direction, REPEAT_INTERVAL_MS);
      }, delay);
    };

    const stopDirect = () => {
      clearTimeout(directTimer);
      directTimer = undefined;
      directKey = null;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.ctrlKey || event.altKey || event.metaKey) return;
      const { code } = event;
      const axis = bound.axis.get(code);
      const direct = bound.direct.get(code);
      if (axis) {
        event.preventDefault();
        if (event.repeat) return;
        heldAxes.set(code, axis);
        if (axisTimer === undefined) {
          // Wait briefly for a second key, so W then D quickly becomes one diagonal step.
          chordPending = true;
          chordAxes.set(code, axis);
          runAxis(CHORD_MS, REPEAT_DELAY_MS);
        } else if (chordPending) {
          chordAxes.set(code, axis);
        }
      } else if (direct) {
        event.preventDefault();
        if (event.repeat) return;
        stopDirect();
        directKey = code;
        latest.current.move(direct);
        runDirect(direct, REPEAT_DELAY_MS);
      } else if (event.key === ">" || event.key === "<" || bound.interact.has(code)) {
        event.preventDefault();
        if (!event.repeat) latest.current.interact();
      } else if (bound.wait.has(code)) {
        event.preventDefault();
        if (!event.repeat) latest.current.wait();
      } else if (bound.lantern.has(code)) {
        event.preventDefault();
        if (!event.repeat) latest.current.toggleLight();
      } else if (bound.pulse.has(code)) {
        event.preventDefault();
        if (!event.repeat) latest.current.pulse();
      } else if (code === "Escape") {
        event.preventDefault();
        if (!event.repeat) latest.current.menu();
      } else if (bound.map.has(code)) {
        event.preventDefault();
        if (!event.repeat) latest.current.map();
      } else if (bound.help.has(code)) {
        event.preventDefault();
        if (!event.repeat) latest.current.help();
      } else if (bound.mute.has(code)) {
        event.preventDefault();
        if (!event.repeat) latest.current.mute();
      } else if (bound.pack.has(code)) {
        event.preventDefault();
        if (!event.repeat) latest.current.inventory();
      } else if (SLOT_KEYS.includes(code)) {
        event.preventDefault();
        if (!event.repeat) latest.current.itemSlot(SLOT_KEYS.indexOf(code));
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      // A pending chord still fires (a quick tap must move); otherwise releasing every key stops.
      if (heldAxes.delete(event.code) && heldAxes.size === 0 && !chordPending) stopAxis();
      if (event.code === directKey) stopDirect();
    };

    const releaseAll = () => {
      heldAxes.clear();
      stopAxis();
      stopDirect();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseAll);
      releaseAll();
    };
  }, [enabled, keys]);
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}
