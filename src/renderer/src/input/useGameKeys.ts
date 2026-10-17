import { useEffect, useRef } from "react";
import { type Direction, directionFromDelta } from "../../../engine/geometry";
import {
  KEY_REPEAT_DELAY_MS as REPEAT_DELAY_MS,
  KEY_REPEAT_INTERVAL_MS as REPEAT_INTERVAL_MS,
} from "../game/timing";

export interface GameKeyHandlers {
  move(direction: Direction): void;
  wait(): void;
  /** Use whatever is underfoot: stairs, a camp, or an item to pick up. */
  interact(): void;
  toggleLight(): void;
  pulse(): void;
  menu(): void;
  /** Open the pack. */
  inventory(): void;
  /** Use (or equip) what's in a pack slot, numbered from 0. */
  itemSlot(slot: number): void;
}

/**
 * Key layout. Physical key codes are used, so WASD stays in the same place on any keyboard layout.
 * Later milestones make this remappable.
 */
const AXIS_KEYS: Readonly<Record<string, { dx: number; dy: number }>> = {
  KeyW: { dx: 0, dy: -1 },
  ArrowUp: { dx: 0, dy: -1 },
  KeyS: { dx: 0, dy: 1 },
  ArrowDown: { dx: 0, dy: 1 },
  KeyA: { dx: -1, dy: 0 },
  ArrowLeft: { dx: -1, dy: 0 },
  KeyD: { dx: 1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
};
const DIRECT_KEYS: Readonly<Record<string, Direction>> = {
  KeyQ: "nw",
  KeyE: "ne",
  KeyZ: "sw",
  KeyC: "se",
  Numpad8: "n",
  Numpad9: "ne",
  Numpad6: "e",
  Numpad3: "se",
  Numpad2: "s",
  Numpad1: "sw",
  Numpad4: "w",
  Numpad7: "nw",
};
const WAIT_KEYS = new Set(["Space", "Numpad5", "Period"]);
const INTERACT_KEYS = new Set(["Enter", "NumpadEnter"]);
const INVENTORY_KEYS = new Set(["KeyI", "Tab"]);
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
 * Keyboard controls for the dungeon. WASD/arrows combine (W+D walks north-east), Q/E/Z/C and the
 * number pad give diagonals directly, and held keys repeat at a steady walking pace.
 */
export function useGameKeys(handlers: GameKeyHandlers, enabled: boolean): void {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (!enabled) return;
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
      const axis = AXIS_KEYS[code];
      const direct = DIRECT_KEYS[code];
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
      } else if (event.key === ">" || event.key === "<" || INTERACT_KEYS.has(code)) {
        event.preventDefault();
        if (!event.repeat) latest.current.interact();
      } else if (WAIT_KEYS.has(code)) {
        event.preventDefault();
        if (!event.repeat) latest.current.wait();
      } else if (code === "KeyL") {
        event.preventDefault();
        if (!event.repeat) latest.current.toggleLight();
      } else if (code === "KeyF") {
        event.preventDefault();
        if (!event.repeat) latest.current.pulse();
      } else if (code === "Escape") {
        event.preventDefault();
        if (!event.repeat) latest.current.menu();
      } else if (INVENTORY_KEYS.has(code)) {
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
  }, [enabled]);
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}
